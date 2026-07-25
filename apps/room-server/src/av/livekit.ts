import { AccessToken } from 'livekit-server-sdk';

// LiveKit orchestration (rooms Phase 5, migrated from Daily.co in R2 — see
// DECISIONS.md ADR-012). One LiveKit room per map instance. Unlike Daily,
// rooms are created implicitly on first join, so a grant is pure local JWT
// signing: no REST round-trip, nothing to cache, and no third-party outage in
// the entry path at all.
//
// Tokens are minted HERE and only here — per room, per user, short-lived
// (SECURITY.md: 2 h, SRS NFR-SEC-02). The API secret never leaves this module
// and is never sent to a client. No recordings: `roomRecord` is denied on
// every token and no egress is configured (FR-ROOM-32).

export const TOKEN_TTL_SECONDS = 2 * 60 * 60;

export type AvGrant = { serverUrl: string; room: string; token: string };

/** What the hub needs from the AV provider; tests inject a fake. */
export interface AvProvider {
  /** Server URL + room name + token for one user's session in one map. */
  grantFor(mapId: string, userId: string, userName: string): Promise<AvGrant>;
}

export type LiveKitConfig = {
  /** wss:// URL of the self-hosted LiveKit server. */
  url: string;
  apiKey: string;
  apiSecret: string;
};

export class LiveKitAvProvider implements AvProvider {
  constructor(private config: LiveKitConfig) {}

  async grantFor(mapId: string, userId: string, userName: string): Promise<AvGrant> {
    const room = roomNameFor(mapId);
    const at = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      // Identity is the Retry userId: the client can then map a LiveKit
      // participant straight onto an actor without a side-channel lookup.
      identity: userId,
      name: userName,
      ttl: TOKEN_TTL_SECONDS,
    });
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      // Proximity, presence and chat all ride our own socket; LiveKit carries
      // media only. Denying data channels keeps it that way.
      canPublishData: false,
      // No recording, ever (FR-ROOM-32).
      roomRecord: false,
      roomAdmin: false,
      roomCreate: false,
    });
    return { serverUrl: this.config.url, room, token: await at.toJwt() };
  }
}

/** Namespaced so one LiveKit deployment can host more than this app. */
export function roomNameFor(mapId: string): string {
  return `retry-${mapId}`;
}
