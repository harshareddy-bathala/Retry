import type { AccessPolicy, Dir, KanbanColumnKey } from '@retry/protocol';

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

export type ChatMessageRecord = {
  id: string;
  roomId: string;
  senderId: string;
  body: string;
  createdAt: Date;
};

export type KanbanCardRecord = {
  id: string;
  roomId: string;
  column: KanbanColumnKey;
  title: string;
  description: string | null;
  assigneeId: string | null;
  moveNote: string | null;
  position: number;
  createdAt: Date;
};

export type KanbanColumnLabel = { key: KanbanColumnKey; label: string };

export type KanbanBoard = { columns: KanbanColumnLabel[]; cards: KanbanCardRecord[] };

export type KanbanCardPatch = {
  title?: string;
  description?: string | null;
  moveNote?: string | null;
};

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
  // Persistent panels (Phase 6)
  appendMessage(roomId: string, senderId: string, body: string): Promise<ChatMessageRecord>;
  kanbanBoard(roomId: string): Promise<KanbanBoard>;
  /** Appends at the end of the column (max position + 1). */
  createCard(roomId: string, column: KanbanColumnKey, title: string): Promise<KanbanCardRecord>;
  updateCard(roomId: string, cardId: string, patch: KanbanCardPatch): Promise<KanbanCardRecord | null>;
  moveCard(
    roomId: string,
    cardId: string,
    column: KanbanColumnKey,
    position: number,
  ): Promise<KanbanCardRecord | null>;
  deleteCard(roomId: string, cardId: string): Promise<boolean>;
  renameColumn(roomId: string, key: KanbanColumnKey, label: string): Promise<void>;
  whiteboardState(roomId: string): Promise<unknown | null>;
  saveWhiteboardState(roomId: string, doc: unknown): Promise<void>;
}

// Default labels (FR-ROOM-18); kanban_columns rows exist only for renames.
export const DEFAULT_KANBAN_LABELS: Record<KanbanColumnKey, string> = {
  todo: 'To Do',
  doing: 'In Progress',
  done: 'Done',
  parked: 'Parked',
};

export const KANBAN_KEYS: readonly KanbanColumnKey[] = ['todo', 'doing', 'done', 'parked'];

export function mergeColumnLabels(renames: KanbanColumnLabel[]): KanbanColumnLabel[] {
  return KANBAN_KEYS.map((key) => ({
    key,
    label: renames.find((r) => r.key === key)?.label ?? DEFAULT_KANBAN_LABELS[key],
  }));
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

  // --- Persistent panels ---

  private messages = new Map<string, ChatMessageRecord[]>();
  private cards = new Map<string, KanbanCardRecord[]>();
  private columnLabels = new Map<string, KanbanColumnLabel[]>();
  private whiteboards = new Map<string, unknown>();
  private idCounter = 0;

  async appendMessage(roomId: string, senderId: string, body: string): Promise<ChatMessageRecord> {
    const record: ChatMessageRecord = {
      id: `msg-${++this.idCounter}`,
      roomId,
      senderId,
      body,
      createdAt: new Date(),
    };
    const list = this.messages.get(roomId) ?? [];
    list.push(record);
    this.messages.set(roomId, list);
    return record;
  }

  /** Test helper. */
  messagesIn(roomId: string): ChatMessageRecord[] {
    return this.messages.get(roomId) ?? [];
  }

  async kanbanBoard(roomId: string): Promise<KanbanBoard> {
    return {
      columns: mergeColumnLabels(this.columnLabels.get(roomId) ?? []),
      cards: [...(this.cards.get(roomId) ?? [])].sort(
        (a, b) => a.position - b.position || a.id.localeCompare(b.id),
      ),
    };
  }

  async createCard(
    roomId: string,
    column: KanbanColumnKey,
    title: string,
  ): Promise<KanbanCardRecord> {
    const list = this.cards.get(roomId) ?? [];
    const max = Math.max(0, ...list.filter((c) => c.column === column).map((c) => c.position));
    const card: KanbanCardRecord = {
      id: `card-${++this.idCounter}`,
      roomId,
      column,
      title,
      description: null,
      assigneeId: null,
      moveNote: null,
      position: max + 1,
      createdAt: new Date(),
    };
    list.push(card);
    this.cards.set(roomId, list);
    return card;
  }

  async updateCard(
    roomId: string,
    cardId: string,
    patch: KanbanCardPatch,
  ): Promise<KanbanCardRecord | null> {
    const card = (this.cards.get(roomId) ?? []).find((c) => c.id === cardId);
    if (!card) return null;
    if (patch.title !== undefined) card.title = patch.title;
    if (patch.description !== undefined) card.description = patch.description;
    if (patch.moveNote !== undefined) card.moveNote = patch.moveNote;
    return card;
  }

  async moveCard(
    roomId: string,
    cardId: string,
    column: KanbanColumnKey,
    position: number,
  ): Promise<KanbanCardRecord | null> {
    const card = (this.cards.get(roomId) ?? []).find((c) => c.id === cardId);
    if (!card) return null;
    card.column = column;
    card.position = position;
    return card;
  }

  async deleteCard(roomId: string, cardId: string): Promise<boolean> {
    const list = this.cards.get(roomId) ?? [];
    const idx = list.findIndex((c) => c.id === cardId);
    if (idx < 0) return false;
    list.splice(idx, 1);
    return true;
  }

  async renameColumn(roomId: string, key: KanbanColumnKey, label: string): Promise<void> {
    const list = (this.columnLabels.get(roomId) ?? []).filter((c) => c.key !== key);
    list.push({ key, label });
    this.columnLabels.set(roomId, list);
  }

  async whiteboardState(roomId: string): Promise<unknown | null> {
    return this.whiteboards.get(roomId) ?? null;
  }

  async saveWhiteboardState(roomId: string, doc: unknown): Promise<void> {
    this.whiteboards.set(roomId, doc);
  }
}
