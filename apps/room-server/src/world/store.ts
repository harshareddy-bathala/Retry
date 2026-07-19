import type { AccessPolicy, Dir } from '@foundry/protocol';

// Persistence boundary of the world server (rooms build plan Phase 4). The hub
// never touches the database directly — it talks to this interface, so tests
// run against the in-memory implementation and production against Drizzle.

export type RoomRecord = {
  id: string;
  name: string;
  visibility: 'public' | 'private';
  accessPolicy: AccessPolicy;
  doorX: number | null;
  doorY: number | null;
  mapTemplate: string;
};

export type LastPosition = { x: number; y: number; dir: Dir };

export interface RoomStore {
  getRoom(roomId: string): Promise<RoomRecord | null>;
  listPublicRooms(): Promise<RoomRecord[]>;
  isMember(roomId: string, userId: string): Promise<boolean>;
  memberUserIds(roomId: string): Promise<string[]>;
  /**
   * The room the user's live presence last occupied — the membership row whose
   * current_map_id equals its own room id. Used for spawn resolution.
   */
  lastActiveRoomId(userId: string): Promise<string | null>;
  /** Record the user's current map ('commons' or a room id) on all their membership rows. */
  setPresence(userId: string, mapId: string): Promise<void>;
  /** Written on transition-out and disconnect only — never a movement log. */
  saveLastPosition(roomId: string, userId: string, pos: LastPosition): Promise<void>;
  lastPosition(roomId: string, userId: string): Promise<LastPosition | null>;
  createAccessRequest(roomId: string, requesterId: string): Promise<string>;
  resolveAccessRequest(
    requestId: string,
    status: 'granted' | 'denied',
    resolvedBy: string | null,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests + running without a database)
// ---------------------------------------------------------------------------

type MemberRecord = { userId: string; currentMapId: string | null };

export class InMemoryRoomStore implements RoomStore {
  private rooms = new Map<string, RoomRecord>();
  private members = new Map<string, MemberRecord[]>();
  private positions = new Map<string, LastPosition>();
  private requests = new Map<
    string,
    { roomId: string; requesterId: string; status: string; resolvedBy: string | null }
  >();
  private requestCounter = 0;

  /** Test/seed helper. */
  addRoom(room: RoomRecord, memberUserIds: string[] = []): void {
    this.rooms.set(room.id, room);
    this.members.set(
      room.id,
      memberUserIds.map((userId) => ({ userId, currentMapId: null })),
    );
  }

  /** Test/seed helper. */
  addMember(roomId: string, userId: string): void {
    const list = this.members.get(roomId) ?? [];
    if (!list.some((m) => m.userId === userId)) list.push({ userId, currentMapId: null });
    this.members.set(roomId, list);
  }

  /** Test helper: inspect a stored access request. */
  getRequest(requestId: string): { status: string; resolvedBy: string | null } | null {
    const r = this.requests.get(requestId);
    return r ? { status: r.status, resolvedBy: r.resolvedBy } : null;
  }

  async getRoom(roomId: string): Promise<RoomRecord | null> {
    return this.rooms.get(roomId) ?? null;
  }

  async listPublicRooms(): Promise<RoomRecord[]> {
    return [...this.rooms.values()].filter((r) => r.visibility === 'public');
  }

  async isMember(roomId: string, userId: string): Promise<boolean> {
    return (this.members.get(roomId) ?? []).some((m) => m.userId === userId);
  }

  async memberUserIds(roomId: string): Promise<string[]> {
    return (this.members.get(roomId) ?? []).map((m) => m.userId);
  }

  async lastActiveRoomId(userId: string): Promise<string | null> {
    for (const [roomId, list] of this.members) {
      if (list.some((m) => m.userId === userId && m.currentMapId === roomId)) return roomId;
    }
    return null;
  }

  async setPresence(userId: string, mapId: string): Promise<void> {
    for (const list of this.members.values()) {
      for (const m of list) {
        if (m.userId === userId) m.currentMapId = mapId;
      }
    }
  }

  async saveLastPosition(roomId: string, userId: string, pos: LastPosition): Promise<void> {
    this.positions.set(`${roomId}:${userId}`, pos);
  }

  async lastPosition(roomId: string, userId: string): Promise<LastPosition | null> {
    return this.positions.get(`${roomId}:${userId}`) ?? null;
  }

  async createAccessRequest(roomId: string, requesterId: string): Promise<string> {
    const id = `req-${++this.requestCounter}`;
    this.requests.set(id, { roomId, requesterId, status: 'pending', resolvedBy: null });
    return id;
  }

  async resolveAccessRequest(
    requestId: string,
    status: 'granted' | 'denied',
    resolvedBy: string | null,
  ): Promise<void> {
    const r = this.requests.get(requestId);
    if (r) {
      r.status = status;
      r.resolvedBy = resolvedBy;
    }
  }
}
