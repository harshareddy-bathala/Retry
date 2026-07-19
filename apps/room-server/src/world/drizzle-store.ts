import { and, eq, isNotNull } from 'drizzle-orm';
import { createDb, roomAccessRequests, roomMembers, rooms, type Db } from '@foundry/db';
import { dirSchema } from '@foundry/protocol';
import { z } from 'zod';
import type { LastPosition, RoomRecord, RoomStore } from './store.js';

// Production RoomStore backed by Postgres via Drizzle (Hard Rule 7). The room
// server holds its own small pool — it must keep serving live traffic even if
// the API process is down.

const lastPositionSchema = z.object({ x: z.number(), y: z.number(), dir: dirSchema });

export class DrizzleRoomStore implements RoomStore {
  private db: Db;
  private pool: { end: () => Promise<void> };

  constructor(connectionString: string) {
    const { db, pool } = createDb({ connectionString, poolMax: 5 });
    this.db = db;
    this.pool = pool;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getRoom(roomId: string): Promise<RoomRecord | null> {
    if (!isUuid(roomId)) return null;
    const [row] = await this.db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
    return row ? toRecord(row) : null;
  }

  async listPublicRooms(): Promise<RoomRecord[]> {
    const rows = await this.db.select().from(rooms).where(eq(rooms.visibility, 'public'));
    return rows.map(toRecord);
  }

  async isMember(roomId: string, userId: string): Promise<boolean> {
    if (!isUuid(roomId) || !isUuid(userId)) return false;
    const rows = await this.db
      .select({ id: roomMembers.id })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
      .limit(1);
    return rows.length > 0;
  }

  async memberUserIds(roomId: string): Promise<string[]> {
    if (!isUuid(roomId)) return [];
    const rows = await this.db
      .select({ userId: roomMembers.userId })
      .from(roomMembers)
      .where(eq(roomMembers.roomId, roomId));
    return rows.map((r) => r.userId);
  }

  async lastActiveRoomId(userId: string): Promise<string | null> {
    if (!isUuid(userId)) return null;
    // Small result set (a user's memberships); compared in JS to keep the
    // query inside Drizzle's typed builders (Hard Rule 7).
    const rows = await this.db
      .select({ roomId: roomMembers.roomId, currentMapId: roomMembers.currentMapId })
      .from(roomMembers)
      .where(and(eq(roomMembers.userId, userId), isNotNull(roomMembers.currentMapId)));
    return rows.find((r) => r.currentMapId === r.roomId)?.roomId ?? null;
  }

  async setPresence(userId: string, mapId: string): Promise<void> {
    if (!isUuid(userId)) return;
    await this.db
      .update(roomMembers)
      .set({ currentMapId: mapId })
      .where(eq(roomMembers.userId, userId));
  }

  async saveLastPosition(roomId: string, userId: string, pos: LastPosition): Promise<void> {
    if (!isUuid(roomId) || !isUuid(userId)) return;
    await this.db
      .update(roomMembers)
      .set({ lastPosition: pos })
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)));
  }

  async lastPosition(roomId: string, userId: string): Promise<LastPosition | null> {
    if (!isUuid(roomId) || !isUuid(userId)) return null;
    const [row] = await this.db
      .select({ lastPosition: roomMembers.lastPosition })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
      .limit(1);
    const parsed = lastPositionSchema.safeParse(row?.lastPosition);
    return parsed.success ? parsed.data : null;
  }

  async createAccessRequest(roomId: string, requesterId: string): Promise<string> {
    const [row] = await this.db
      .insert(roomAccessRequests)
      .values({ roomId, requesterId })
      .returning({ id: roomAccessRequests.id });
    if (!row) throw new Error('access request insert returned no row');
    return row.id;
  }

  async resolveAccessRequest(
    requestId: string,
    status: 'granted' | 'denied',
    resolvedBy: string | null,
  ): Promise<void> {
    if (!isUuid(requestId)) return;
    await this.db
      .update(roomAccessRequests)
      .set({ status, resolvedAt: new Date(), resolvedBy })
      .where(eq(roomAccessRequests.id, requestId));
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Guard before querying: map ids arrive from the wire as arbitrary strings
// ('commons', 'studio_a', junk) and Postgres would error casting them to uuid.
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function toRecord(row: typeof rooms.$inferSelect): RoomRecord {
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    accessPolicy: row.accessPolicy,
    doorX: row.doorX,
    doorY: row.doorY,
    mapTemplate: row.mapTemplate,
  };
}
