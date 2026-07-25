import type { FastifyBaseLogger } from 'fastify';

// Daily.co orchestration (rooms build plan Phase 5). One Daily room per map
// instance, created lazily on first use and cached for the process lifetime.
// Tokens are minted HERE and only here — per room, per user, per session,
// short-lived (SECURITY.md: 2 h, SRS NFR-SEC-02). The API key never leaves
// this module. No recordings: disabled at the Daily domain level (FR-ROOM-32)
// and never requested by any token minted here.

export const TOKEN_TTL_SECONDS = 2 * 60 * 60;

export type AvGrant = { roomUrl: string; token: string };

/** What the hub needs from Daily; tests inject a fake. */
export interface AvProvider {
  /** Room + token for one user's session in one map. Throws on Daily API failure. */
  grantFor(mapId: string, userId: string, userName: string): Promise<AvGrant>;
}

const DAILY_API = 'https://api.daily.co/v1';

type DailyRoom = { name: string; url: string };

export class DailyAvProvider implements AvProvider {
  private rooms = new Map<string, Promise<DailyRoom>>();

  constructor(
    private apiKey: string,
    private log: FastifyBaseLogger,
  ) {}

  async grantFor(mapId: string, userId: string, userName: string): Promise<AvGrant> {
    const room = await this.ensureRoom(mapId);
    const token = await this.mintToken(room.name, userId, userName);
    return { roomUrl: room.url, token };
  }

  /** Lazily create (or fetch) the Daily room backing a map instance. */
  private ensureRoom(mapId: string): Promise<DailyRoom> {
    let pending = this.rooms.get(mapId);
    if (!pending) {
      pending = this.createOrFetchRoom(mapId).catch((err: unknown) => {
        // A failed creation must not poison the cache forever.
        this.rooms.delete(mapId);
        throw err;
      });
      this.rooms.set(mapId, pending);
    }
    return pending;
  }

  private async createOrFetchRoom(mapId: string): Promise<DailyRoom> {
    const name = `retry-${mapId}`;
    const created = await this.request('POST', '/rooms', {
      name,
      privacy: 'private',
      properties: {
        start_audio_off: true,
        start_video_off: true,
        enable_people_ui: false,
        enable_prejoin_ui: false,
      },
    });
    if (created.ok) return created.body as DailyRoom;
    // 400 with a "already exists" error means another process (or a previous
    // run) created it — fetch it instead.
    const fetched = await this.request('GET', `/rooms/${name}`);
    if (fetched.ok) return fetched.body as DailyRoom;
    throw new Error(`Daily room '${name}' could not be created or fetched (${created.status}/${fetched.status})`);
  }

  private async mintToken(roomName: string, userId: string, userName: string): Promise<string> {
    const res = await this.request('POST', '/meeting-tokens', {
      properties: {
        room_name: roomName,
        user_id: userId,
        user_name: userName,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
        eject_at_token_exp: true,
      },
    });
    if (!res.ok) throw new Error(`Daily token mint failed (${res.status})`);
    const body = res.body as { token?: string };
    if (!body.token) throw new Error('Daily token response had no token');
    return body.token;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const res = await fetch(`${DAILY_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      this.log.warn({ path, status: res.status }, 'daily API returned non-JSON body');
    }
    return { ok: res.ok, status: res.status, body: parsed };
  }
}
