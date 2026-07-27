// Phase 0 tables (users + auth tokens) plus the rooms Phase 4 world tables.
// The rest of DATABASE.md lands with its own phase (posts/lineage in Phase 1,
// the rooms workspace columns — blueprint, whiteboard_state, … — with the main
// rooms phase) so migrations stay reviewable.
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['student', 'faculty', 'alumni', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: userRole('role').notNull().default('student'),
  department: text('department'),
  batchYear: text('batch_year'),
  semester: integer('semester'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  // The world character, as @retry/maps' canonical layer-selection string
  // (e.g. 'body_03|eyes_02|outfit_07|hair_04_04|acc_11'). Per USER, not per
  // room membership — a person's character is theirs everywhere (migration
  // 0006 moved it off room_members). NULL = never chosen; the creator opens.
  avatarSprite: text('avatar_sprite'),
  // null = inactive account (FR-AUTH-02)
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // FR-AUTH-04: set once the onboarding form is submitted
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  isSuspended: boolean('is_suspended').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Opaque refresh tokens, hashed at rest, rotated on every use (SECURITY.md §1).
// family_id groups a rotation chain: reuse of a rotated token revokes the family.
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId), index('refresh_tokens_family_idx').on(t.familyId)],
);

export const emailTokenPurpose = pgEnum('email_token_purpose', ['verify_email', 'reset_password']);

// Single-use, 1 h TTL, hashed at rest (SECURITY.md §1) — verification + reset links.
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: emailTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_tokens_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Rooms multi-map world (rooms build plan Phase 4)
// ---------------------------------------------------------------------------

// Canonical definitions live in packages/protocol/src/events.ts (the wire
// contract); these mirror them, exactly as kanbanColumnKey already does.
export const projectStage = pgEnum('project_stage', [
  'ideation',
  'planning',
  'building',
  'testing',
  'complete',
]);
export const domainTag = pgEnum('domain_tag', [
  'Education',
  'Healthcare',
  'Fintech',
  'Logistics',
  'Government',
  'Social',
  'Productivity',
  'Other',
]);

export const roomVisibility = pgEnum('room_visibility', ['public', 'private']);
export const roomAccessPolicy = pgEnum('room_access_policy', ['open', 'knock', 'invite_only']);
export const roomMemberRole = pgEnum('room_member_role', ['owner', 'member']);
export const roomAccessRequestStatus = pgEnum('room_access_request_status', [
  'pending',
  'granted',
  'denied',
]);

// Minimal rooms table for the multi-map world. Workspace columns (blueprint_*,
// whiteboard_state, project context…) arrive with the main-app rooms phase.
// door_x/door_y: the room's Commons door slot position in TILE coords —
// assigned from the lowest free slot when a public room is created, NULL for
// private rooms (privacy by absence: no door is ever rendered).
export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  visibility: roomVisibility('visibility').notNull().default('private'),
  accessPolicy: roomAccessPolicy('access_policy').notNull().default('invite_only'),
  doorX: integer('door_x'),
  doorY: integer('door_y'),
  mapTemplate: text('map_template').notNull().default('studio_a'),
  // Project context header (FR-ROOM-09). The room's own `name` doubles as the
  // project name — two editable names for one thing would only ever disagree.
  projectStage: projectStage('project_stage').notNull().default('ideation'),
  domainTag: domainTag('domain_tag'),
  // tldraw document (FR-ROOM-38), written by the whiteboard sync server only.
  whiteboardState: jsonb('whiteboard_state'),
  // Denormalised "something happened in here" clock for the room list ordering
  // (FR-ROOM-06). Bumped by chat/kanban/whiteboard writes; deliberately NOT
  // updated_at, which moves on every row edit including whiteboard autosaves.
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// current_map_id: the room's id while the member's live-space presence is in
// this room; doubles as "last-active room" for spawn resolution (cleared only
// when the user enters a DIFFERENT room, not on disconnect). last_position:
// {x, y, dir} in tile units, written on transition-out/disconnect only — no
// attendance or session history is ever stored (CLAUDE.md room rules).
export const roomMembers = pgTable(
  'room_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roomMemberRole('role').notNull().default('member'),
    currentMapId: text('current_map_id'),
    lastPosition: jsonb('last_position').$type<{ x: number; y: number; dir: string }>(),
    // Heartbeat of live presence, NULL when the socket closes. Combined with
    // current_map_id this answers "who is in this room right now" (FR-ROOM-07/08)
    // without a sessions table — which SRS line 301 forbids. It is a single
    // mutable cell per membership, never an append-only attendance history.
    presenceSeenAt: timestamp('presence_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('room_members_room_user_idx').on(t.roomId, t.userId),
    index('room_members_user_idx').on(t.userId),
  ],
);

// Knock flow (access_policy = 'knock'). A granted request admits the requester
// for that live session only — it is an audit row, not a standing permission.
export const roomAccessRequests = pgTable(
  'room_access_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: roomAccessRequestStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id),
  },
  (t) => [index('room_access_requests_room_idx').on(t.roomId)],
);

// ---------------------------------------------------------------------------
// Room lifecycle & membership (R3)
// ---------------------------------------------------------------------------

export const roomInviteStatus = pgEnum('room_invite_status', ['pending', 'accepted', 'declined']);

// FR-ROOM-04. Declined invites are kept (the invitee's own record) but are never
// surfaced to the room — see the service: a decline notifies nobody.
export const roomInvites = pgTable(
  'room_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteeId: uuid('invitee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: roomInviteStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    // One live invite per person per room; re-inviting after a decline is fine,
    // so the constraint is partial rather than on the pair outright.
    uniqueIndex('room_invites_pending_idx')
      .on(t.roomId, t.inviteeId)
      .where(sql`status = 'pending'`),
    index('room_invites_invitee_idx').on(t.inviteeId, t.status),
  ],
);

// Generic notification feed. `kind` is text rather than an enum on purpose:
// posts, grading and the Idea Hub all reuse this table, and each new kind
// would otherwise need an ALTER TYPE that Drizzle cannot run inside a
// migration transaction. The union below is the type-level contract.
export type NotificationKind =
  | 'room_invite'
  | 'room_invite_accepted'
  | 'room_member_removed'
  | 'room_deleted'
  | 'room_ownership_transferred';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<NotificationKind>().notNull(),
    payload: jsonb('payload').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_created_idx').on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Workspace (R4)
// ---------------------------------------------------------------------------

// One row per room, created on first edit. Kept off `rooms` deliberately: that
// row is read on every join and door-plaque rebuild, and blueprint prose is
// neither small nor needed there.
export const roomBlueprint = pgTable('room_blueprint', {
  roomId: uuid('room_id')
    .primaryKey()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  // FR-ROOM-11: all three optional, never validated, empty is a real answer.
  problem: text('problem'),
  audience: text('audience'),
  existing: text('existing'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const blueprintField = pgEnum('blueprint_field', ['problem', 'audience', 'existing']);

// FR-ROOM-12: "how our thinking evolved", for the team's own reference only —
// never shown to faculty and never an input to grading.
export const roomBlueprintEdits = pgTable(
  'room_blueprint_edits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    field: blueprintField('field').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('room_blueprint_edits_room_idx').on(t.roomId, t.createdAt)],
);

export const journeyKind = pgEnum('journey_kind', [
  'room_created',
  'blueprint_first_edit',
  'stage_change',
]);

// FR-ROOM-17. Append-only and server-generated — a member can never write one
// directly. The weekly "Done" rollup is NOT stored: it is computed from the
// board at read time, so it stays true when cards move afterwards.
export const roomJourneyEntries = pgTable(
  'room_journey_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    kind: journeyKind('kind').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('room_journey_entries_room_idx').on(t.roomId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Persistent panels (rooms build plan Phase 6)
// ---------------------------------------------------------------------------

// Plain text only (FR-ROOM-35), stored indefinitely, deleted only via room
// deletion cascade (FR-ROOM-36).
export const roomMessages = pgTable(
  'room_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('room_messages_room_created_idx').on(t.roomId, t.createdAt)],
);

export const kanbanColumnKey = pgEnum('kanban_column', ['todo', 'doing', 'done', 'parked']);

// Stores RENAMED column labels only (FR-ROOM-18); absence = default label.
export const kanbanColumns = pgTable(
  'kanban_columns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    key: kanbanColumnKey('key').notNull(),
    label: text('label').notNull(),
  },
  (t) => [uniqueIndex('kanban_columns_room_key_idx').on(t.roomId, t.key)],
);

// position is fractional (real): a drag writes ONE row, never reindexes the
// column — integer reindexing races when two members drag simultaneously.
export const kanbanCards = pgTable(
  'kanban_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    column: kanbanColumnKey('column').notNull().default('todo'),
    title: text('title').notNull(),
    description: text('description'),
    assigneeId: uuid('assignee_id').references(() => users.id),
    // FR-ROOM-21 (P2): optional one-line note when moved to done/parked.
    moveNote: text('move_note'),
    position: real('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('kanban_cards_room_idx').on(t.roomId)],
);

export type RoomRow = typeof rooms.$inferSelect;
export type NewRoomRow = typeof rooms.$inferInsert;
export type RoomMemberRow = typeof roomMembers.$inferSelect;
export type RoomAccessRequestRow = typeof roomAccessRequests.$inferSelect;
export type RoomInviteRow = typeof roomInvites.$inferSelect;
export type RoomBlueprintRow = typeof roomBlueprint.$inferSelect;
export type RoomJourneyEntryRow = typeof roomJourneyEntries.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type RoomMessageRow = typeof roomMessages.$inferSelect;
export type KanbanCardRow = typeof kanbanCards.$inferSelect;
export type KanbanColumnRow = typeof kanbanColumns.$inferSelect;

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type EmailTokenRow = typeof emailTokens.$inferSelect;
