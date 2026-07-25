import type {
  AccessPolicy,
  BlueprintFieldKey,
  Dir,
  DomainTag,
  KanbanColumnKey,
  ProjectStage,
} from '@retry/protocol';

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
  /** Last touched — the weekly Done rollup counts by this. */
  updatedAt: Date;
};

export type KanbanColumnLabel = { key: KanbanColumnKey; label: string };

export type KanbanBoard = { columns: KanbanColumnLabel[]; cards: KanbanCardRecord[] };

// --- Workspace (R4) ---

export type BlueprintRecord = {
  problem: string | null;
  audience: string | null;
  existing: string | null;
};

export type JourneyKind = 'room_created' | 'blueprint_first_edit' | 'stage_change';

export type JourneyEntryRecord = {
  id: string;
  kind: JourneyKind;
  body: string;
  createdAt: Date;
};

export type WorkspaceRecord = {
  roomId: string;
  name: string;
  stage: ProjectStage;
  domainTag: DomainTag | null;
  blueprint: BlueprintRecord;
  journey: JourneyEntryRecord[];
};

export type ContextPatch = { stage?: ProjectStage; domainTag?: DomainTag | null };

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
  /**
   * Refresh the presence heartbeat for everyone still standing in a map. Called
   * on a timer so "who is here right now" stays true for the REST API without
   * anything resembling an attendance log.
   */
  touchPresence(userIds: string[]): Promise<void>;
  /** Presence ends the moment the socket does — NULL, not a timestamp. */
  clearPresence(userId: string): Promise<void>;
  /** Bump rooms.last_activity_at; drives room-list ordering (FR-ROOM-06). */
  bumpActivity(roomId: string): Promise<void>;
  /** The preset this member picked for this room, or null if they never have. */
  avatarFor(roomId: string, userId: string): Promise<string | null>;
  /** Their most recent pick anywhere — what a static map like the Commons uses. */
  lastAvatarFor(userId: string): Promise<string | null>;
  setAvatar(roomId: string, userId: string, sprite: string): Promise<void>;
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
  // Workspace (R4)
  workspace(roomId: string): Promise<WorkspaceRecord | null>;
  updateContext(roomId: string, patch: ContextPatch): Promise<void>;
  /**
   * Persists the field and appends to its edit log. Reports whether this was
   * the field's first-ever edit, which is what earns a Build Journey entry
   * (FR-ROOM-17) — every later edit is just an edit.
   */
  saveBlueprintField(
    roomId: string,
    field: BlueprintFieldKey,
    value: string,
    userId: string,
  ): Promise<{ firstEdit: boolean }>;
  addJourneyEntry(roomId: string, kind: JourneyKind, body: string): Promise<JourneyEntryRecord>;
  /** Cards sitting in Done that were last touched within the window. */
  doneSince(roomId: string, since: Date): Promise<number>;
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

type MemberRecord = { userId: string; currentMapId: string | null; presenceSeenAt: Date | null };

export class InMemoryRoomStore implements RoomStore {
  private rooms = new Map<string, RoomRecord>();
  private members = new Map<string, MemberRecord[]>();
  private positions = new Map<string, LastPosition>();
  private activity = new Map<string, Date>();
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
      memberUserIds.map((userId) => ({ userId, currentMapId: null, presenceSeenAt: null })),
    );
  }

  /** Test/seed helper. */
  addMember(roomId: string, userId: string): void {
    const list = this.members.get(roomId) ?? [];
    if (!list.some((m) => m.userId === userId)) {
      list.push({ userId, currentMapId: null, presenceSeenAt: null });
    }
    this.members.set(roomId, list);
  }

  /** Test helper: drop a membership the way the API's removeMember does. */
  removeMember(roomId: string, userId: string): void {
    const list = (this.members.get(roomId) ?? []).filter((m) => m.userId !== userId);
    this.members.set(roomId, list);
  }

  /** Test helper: how many rooms currently hold a live presence for a user. */
  presenceRowsFor(userId: string): Array<{ currentMapId: string | null; seen: Date | null }> {
    const out: Array<{ currentMapId: string | null; seen: Date | null }> = [];
    for (const list of this.members.values()) {
      for (const m of list) {
        if (m.userId === userId) out.push({ currentMapId: m.currentMapId, seen: m.presenceSeenAt });
      }
    }
    return out;
  }

  /** Test helper. */
  activityAt(roomId: string): Date | null {
    return this.activity.get(roomId) ?? null;
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
    const now = new Date();
    for (const list of this.members.values()) {
      for (const m of list) {
        if (m.userId === userId) {
          m.currentMapId = mapId;
          m.presenceSeenAt = now;
        }
      }
    }
  }

  async touchPresence(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const now = new Date();
    const wanted = new Set(userIds);
    for (const list of this.members.values()) {
      for (const m of list) {
        if (wanted.has(m.userId)) m.presenceSeenAt = now;
      }
    }
  }

  async clearPresence(userId: string): Promise<void> {
    for (const list of this.members.values()) {
      for (const m of list) {
        if (m.userId === userId) m.presenceSeenAt = null;
      }
    }
  }

  async bumpActivity(roomId: string): Promise<void> {
    this.activity.set(roomId, new Date());
  }

  private avatars = new Map<string, string>();

  async avatarFor(roomId: string, userId: string): Promise<string | null> {
    return this.avatars.get(`${roomId}:${userId}`) ?? null;
  }

  async lastAvatarFor(userId: string): Promise<string | null> {
    for (const [key, sprite] of this.avatars) {
      if (key.endsWith(`:${userId}`)) return sprite;
    }
    return null;
  }

  async setAvatar(roomId: string, userId: string, sprite: string): Promise<void> {
    this.avatars.set(`${roomId}:${userId}`, sprite);
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
      updatedAt: new Date(),
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
    card.updatedAt = new Date();
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
    card.updatedAt = new Date();
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

  // --- Workspace ---

  private context = new Map<string, { stage: ProjectStage; domainTag: DomainTag | null }>();
  private blueprints = new Map<string, BlueprintRecord>();
  private journeys = new Map<string, JourneyEntryRecord[]>();

  async workspace(roomId: string): Promise<WorkspaceRecord | null> {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const context = this.context.get(roomId) ?? { stage: 'ideation' as const, domainTag: null };
    return {
      roomId,
      name: room.name,
      stage: context.stage,
      domainTag: context.domainTag,
      blueprint: this.blueprints.get(roomId) ?? { problem: null, audience: null, existing: null },
      journey: [...(this.journeys.get(roomId) ?? [])],
    };
  }

  async updateContext(roomId: string, patch: ContextPatch): Promise<void> {
    const current = this.context.get(roomId) ?? { stage: 'ideation' as const, domainTag: null };
    this.context.set(roomId, {
      stage: patch.stage ?? current.stage,
      domainTag: patch.domainTag !== undefined ? patch.domainTag : current.domainTag,
    });
  }

  async saveBlueprintField(
    roomId: string,
    field: BlueprintFieldKey,
    value: string,
    _userId: string,
  ): Promise<{ firstEdit: boolean }> {
    const current = this.blueprints.get(roomId) ?? {
      problem: null,
      audience: null,
      existing: null,
    };
    const firstEdit = current[field] === null;
    this.blueprints.set(roomId, { ...current, [field]: value });
    return { firstEdit };
  }

  async addJourneyEntry(
    roomId: string,
    kind: JourneyKind,
    body: string,
  ): Promise<JourneyEntryRecord> {
    const entry: JourneyEntryRecord = {
      id: `journey-${++this.idCounter}`,
      kind,
      body,
      createdAt: new Date(),
    };
    const list = this.journeys.get(roomId) ?? [];
    list.push(entry);
    this.journeys.set(roomId, list);
    return entry;
  }

  async doneSince(roomId: string, since: Date): Promise<number> {
    return (this.cards.get(roomId) ?? []).filter(
      (c) => c.column === 'done' && c.updatedAt >= since,
    ).length;
  }
}
