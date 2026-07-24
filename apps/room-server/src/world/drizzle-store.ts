import { and, eq, isNotNull, max } from 'drizzle-orm';
import {
  createDb,
  kanbanCards,
  kanbanColumns,
  roomAccessRequests,
  roomMembers,
  roomMessages,
  rooms,
  type Db,
  type KanbanCardRow,
} from '@foundry/db';
import { dirSchema, type KanbanColumnKey } from '@foundry/protocol';
import { z } from 'zod';
import {
  mergeColumnLabels,
  type ChatMessageRecord,
  type KanbanBoard,
  type KanbanCardPatch,
  type KanbanCardRecord,
  type LastPosition,
  type RoomRecord,
  type RoomStore,
} from './store.js';

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

  // --- Persistent panels (Phase 6) ---

  async appendMessage(roomId: string, senderId: string, body: string): Promise<ChatMessageRecord> {
    const [row] = await this.db.insert(roomMessages).values({ roomId, senderId, body }).returning();
    if (!row) throw new Error('message insert returned no row');
    return row;
  }

  async kanbanBoard(roomId: string): Promise<KanbanBoard> {
    if (!isUuid(roomId)) return { columns: mergeColumnLabels([]), cards: [] };
    const [labels, cards] = await Promise.all([
      this.db
        .select({ key: kanbanColumns.key, label: kanbanColumns.label })
        .from(kanbanColumns)
        .where(eq(kanbanColumns.roomId, roomId)),
      this.db
        .select()
        .from(kanbanCards)
        .where(eq(kanbanCards.roomId, roomId))
        .orderBy(kanbanCards.position, kanbanCards.id),
    ]);
    return { columns: mergeColumnLabels(labels), cards: cards.map(toCardRecord) };
  }

  async createCard(
    roomId: string,
    column: KanbanColumnKey,
    title: string,
  ): Promise<KanbanCardRecord> {
    const [top] = await this.db
      .select({ max: max(kanbanCards.position) })
      .from(kanbanCards)
      .where(and(eq(kanbanCards.roomId, roomId), eq(kanbanCards.column, column)));
    const [row] = await this.db
      .insert(kanbanCards)
      .values({ roomId, column, title, position: (top?.max ?? 0) + 1 })
      .returning();
    if (!row) throw new Error('card insert returned no row');
    return toCardRecord(row);
  }

  async updateCard(
    roomId: string,
    cardId: string,
    patch: KanbanCardPatch,
  ): Promise<KanbanCardRecord | null> {
    if (!isUuid(cardId)) return null;
    const [row] = await this.db
      .update(kanbanCards)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.roomId, roomId)))
      .returning();
    return row ? toCardRecord(row) : null;
  }

  async moveCard(
    roomId: string,
    cardId: string,
    column: KanbanColumnKey,
    position: number,
  ): Promise<KanbanCardRecord | null> {
    if (!isUuid(cardId)) return null;
    const [row] = await this.db
      .update(kanbanCards)
      .set({ column, position, updatedAt: new Date() })
      .where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.roomId, roomId)))
      .returning();
    return row ? toCardRecord(row) : null;
  }

  async deleteCard(roomId: string, cardId: string): Promise<boolean> {
    if (!isUuid(cardId)) return false;
    const rows = await this.db
      .delete(kanbanCards)
      .where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.roomId, roomId)))
      .returning({ id: kanbanCards.id });
    return rows.length > 0;
  }

  async renameColumn(roomId: string, key: KanbanColumnKey, label: string): Promise<void> {
    await this.db
      .insert(kanbanColumns)
      .values({ roomId, key, label })
      .onConflictDoUpdate({
        target: [kanbanColumns.roomId, kanbanColumns.key],
        set: { label },
      });
  }

  async whiteboardState(roomId: string): Promise<unknown | null> {
    if (!isUuid(roomId)) return null;
    const [row] = await this.db
      .select({ whiteboardState: rooms.whiteboardState })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);
    return row?.whiteboardState ?? null;
  }

  async saveWhiteboardState(roomId: string, doc: unknown): Promise<void> {
    if (!isUuid(roomId)) return;
    await this.db
      .update(rooms)
      .set({ whiteboardState: doc, updatedAt: new Date() })
      .where(eq(rooms.id, roomId));
  }
}

function toCardRecord(row: KanbanCardRow): KanbanCardRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    column: row.column,
    title: row.title,
    description: row.description,
    assigneeId: row.assigneeId,
    moveNote: row.moveNote,
    position: row.position,
    createdAt: row.createdAt,
  };
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
