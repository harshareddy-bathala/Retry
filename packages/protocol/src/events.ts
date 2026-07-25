import { z } from 'zod';

// The single source of truth for the Retry Rooms movement protocol.
// Client and server import ONLY from this package — never redefine an
// event shape locally (Hard Rule 9, WEBSOCKET_EVENTS.md §"Movement protocol").

export const dirSchema = z.enum(['up', 'down', 'left', 'right']);
export type Dir = z.infer<typeof dirSchema>;

// Proximity zones, SRS Appendix 11.4: distance ≤ 2 tiles → close, ≤ 5 → near.
export const zoneSchema = z.enum(['close', 'near', 'out']);
export type Zone = z.infer<typeof zoneSchema>;

// Room door policy (rooms build plan Phase 4). Mirrors the `room_access_policy`
// pg enum — the wire carries it so the Commons can render lock glyphs and the
// client can route a rejected transition to the right UX (knock vs. plain no).
export const accessPolicySchema = z.enum(['open', 'knock', 'invite_only']);
export type AccessPolicy = z.infer<typeof accessPolicySchema>;

export const actorSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  sprite: z.string().min(1),
  x: z.number(),
  y: z.number(),
  dir: dirSchema,
  moving: z.boolean(),
  audio: z.boolean(),
  video: z.boolean(),
});
export type Actor = z.infer<typeof actorSchema>;

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

// displayName/sprite are cosmetic only — identity (userId) always derives from
// the connection's JWT, never from anything a client sends.
// mapId omitted = "spawn me": the server resolves the user's last-active room,
// falling back to the Commons (Phase 4). While already joined, a bare join is a
// resync request for the current map.
export const joinMessageSchema = z.object({
  t: z.literal('join'),
  mapId: z.string().min(1).optional(),
  displayName: z.string().min(1).max(60).optional(),
  sprite: z.string().min(1).max(40).optional(),
});
export type JoinMessage = z.infer<typeof joinMessageSchema>;

// Walking through a door (Phase 4). The socket is never torn down: the server
// moves the SAME connection between map registries and answers with a snapshot
// of the destination. Access policy is enforced server-side on every call.
export const transitionMessageSchema = z.object({
  t: z.literal('transition'),
  toMapId: z.string().min(1),
});
export type TransitionMessage = z.infer<typeof transitionMessageSchema>;

// A member answering someone's knock. Any member may respond; first response wins.
export const knockRespondMessageSchema = z.object({
  t: z.literal('knockRespond'),
  requestId: z.string().min(1),
  grant: z.boolean(),
});
export type KnockRespondMessage = z.infer<typeof knockRespondMessageSchema>;

// The requester withdrawing their own pending knock.
export const knockCancelMessageSchema = z.object({
  t: z.literal('knockCancel'),
  requestId: z.string().min(1),
});
export type KnockCancelMessage = z.infer<typeof knockCancelMessageSchema>;

export const moveMessageSchema = z.object({
  t: z.literal('move'),
  x: z.number(),
  y: z.number(),
  dir: dirSchema,
  moving: z.boolean(),
});
export type MoveMessage = z.infer<typeof moveMessageSchema>;

export const leaveMessageSchema = z.object({
  t: z.literal('leave'),
});
export type LeaveMessage = z.infer<typeof leaveMessageSchema>;

export const chatMessageSchema = z.object({
  t: z.literal('chat'),
  body: z.string().min(1).max(2000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Kanban (rooms build plan Phase 6, FR-ROOM-18..21). Mutations ride the same
// socket; the server persists and broadcasts so every member stays in sync.
export const kanbanColumnKeySchema = z.enum(['todo', 'doing', 'done', 'parked']);
export type KanbanColumnKey = z.infer<typeof kanbanColumnKeySchema>;

export const kanbanCreateMessageSchema = z.object({
  t: z.literal('kanbanCreate'),
  column: kanbanColumnKeySchema,
  title: z.string().min(1).max(200),
});
export type KanbanCreateMessage = z.infer<typeof kanbanCreateMessageSchema>;

export const kanbanUpdateMessageSchema = z.object({
  t: z.literal('kanbanUpdate'),
  cardId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  moveNote: z.string().max(200).nullable().optional(),
});
export type KanbanUpdateMessage = z.infer<typeof kanbanUpdateMessageSchema>;

// position is FRACTIONAL — a drag writes one card, never reindexes a column
// (integer reindexing races between two simultaneous draggers).
export const kanbanMoveMessageSchema = z.object({
  t: z.literal('kanbanMove'),
  cardId: z.string().min(1),
  column: kanbanColumnKeySchema,
  position: z.number().finite(),
});
export type KanbanMoveMessage = z.infer<typeof kanbanMoveMessageSchema>;

export const kanbanDeleteMessageSchema = z.object({
  t: z.literal('kanbanDelete'),
  cardId: z.string().min(1),
});
export type KanbanDeleteMessage = z.infer<typeof kanbanDeleteMessageSchema>;

export const kanbanRenameColumnMessageSchema = z.object({
  t: z.literal('kanbanRenameColumn'),
  column: kanbanColumnKeySchema,
  label: z.string().min(1).max(40),
});
export type KanbanRenameColumnMessage = z.infer<typeof kanbanRenameColumnMessageSchema>;

export const mediaMessageSchema = z.object({
  t: z.literal('media'),
  audio: z.boolean(),
  video: z.boolean(),
});
export type MediaMessage = z.infer<typeof mediaMessageSchema>;

// ---------------------------------------------------------------------------
// Workspace (R4): the half of a room that works when nobody else is online
// ---------------------------------------------------------------------------

// `watch` subscribes a MEMBER to a room's panel channel with no actor, no
// proximity and no AV — the Workspace view. It is how chat, the board and the
// Blueprint stay live for someone who is not walking around the map, over the
// same socket rather than a second transport (FR-ROOM-33, FR-ROOM-10).
export const watchMessageSchema = z.object({
  t: z.literal('watch'),
  roomId: z.string().uuid(),
  /**
   * Cosmetic, exactly as on `join`: identity always comes from the token. A
   * watcher can chat, so without this their messages would be attributed to
   * the "Anonymous" default the session starts with.
   */
  displayName: z.string().min(1).max(60).optional(),
});
export type WatchMessage = z.infer<typeof watchMessageSchema>;

export const unwatchMessageSchema = z.object({ t: z.literal('unwatch') });
export type UnwatchMessage = z.infer<typeof unwatchMessageSchema>;

// FR-ROOM-09's dropdown values, and FR-POST-02's domain list — the same list is
// used for post domain tags and feed filters. Mirrored as pgEnums in
// packages/db/src/schema.ts; this is the canonical definition (same
// arrangement as kanbanColumnKey).
export const projectStageSchema = z.enum([
  'ideation',
  'planning',
  'building',
  'testing',
  'complete',
]);
export type ProjectStage = z.infer<typeof projectStageSchema>;

export const DOMAIN_TAGS = [
  'Education',
  'Healthcare',
  'Fintech',
  'Logistics',
  'Government',
  'Social',
  'Productivity',
  'Other',
] as const;
export const domainTagSchema = z.enum(DOMAIN_TAGS);
export type DomainTag = z.infer<typeof domainTagSchema>;

export const contextUpdateMessageSchema = z.object({
  t: z.literal('contextUpdate'),
  stage: projectStageSchema.optional(),
  /** null clears the tag; omitted leaves it alone. */
  domainTag: domainTagSchema.nullable().optional(),
});
export type ContextUpdateMessage = z.infer<typeof contextUpdateMessageSchema>;

export const blueprintFieldKeySchema = z.enum(['problem', 'audience', 'existing']);
export type BlueprintFieldKey = z.infer<typeof blueprintFieldKeySchema>;

// All three Blueprint fields are optional and never validated (FR-ROOM-11) —
// an empty string is a legitimate value, meaning "we cleared this".
export const blueprintUpdateMessageSchema = z.object({
  t: z.literal('blueprintUpdate'),
  field: blueprintFieldKeySchema,
  value: z.string().max(4000),
});
export type BlueprintUpdateMessage = z.infer<typeof blueprintUpdateMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion('t', [
  joinMessageSchema,
  moveMessageSchema,
  leaveMessageSchema,
  chatMessageSchema,
  mediaMessageSchema,
  transitionMessageSchema,
  knockRespondMessageSchema,
  knockCancelMessageSchema,
  kanbanCreateMessageSchema,
  kanbanUpdateMessageSchema,
  kanbanMoveMessageSchema,
  kanbanDeleteMessageSchema,
  kanbanRenameColumnMessageSchema,
  watchMessageSchema,
  unwatchMessageSchema,
  contextUpdateMessageSchema,
  blueprintUpdateMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

// `template` names the Tiled map file to render (mapId alone is not enough:
// room instances have uuid mapIds but share e.g. the 'studio_a' template).
export const snapshotMessageSchema = z.object({
  t: z.literal('snapshot'),
  mapId: z.string().min(1),
  template: z.string().min(1),
  actors: z.array(actorSchema),
});
export type SnapshotMessage = z.infer<typeof snapshotMessageSchema>;

// One Commons door slot. `room` is absent for unassigned slots, which render
// as a plain closed door with no plaque. x/y are TILE coordinates in commons.
export const doorInfoSchema = z.object({
  slot: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  room: z
    .object({
      roomId: z.string().min(1),
      roomName: z.string().min(1),
      accessPolicy: accessPolicySchema,
      occupancy: z.number().int().nonnegative(),
    })
    .optional(),
});
export type DoorInfo = z.infer<typeof doorInfoSchema>;

// Full door state of the Commons — sent on commons entry and re-broadcast to
// commons occupants whenever assignments or occupancy change. Private rooms
// never appear here (privacy by absence).
export const doorsMessageSchema = z.object({
  t: z.literal('doors'),
  doors: z.array(doorInfoSchema),
});
export type DoorsMessage = z.infer<typeof doorsMessageSchema>;

// Live prompt to every online member of a knocked room: "X wants to join".
export const knockMessageSchema = z.object({
  t: z.literal('knock'),
  requestId: z.string().min(1),
  roomId: z.string().min(1),
  roomName: z.string().min(1),
  requesterName: z.string().min(1),
});
export type KnockMessage = z.infer<typeof knockMessageSchema>;

// Ack to the REQUESTER that their knock is pending — carries the requestId
// they need to cancel, and drives the waiting UI.
export const knockPendingMessageSchema = z.object({
  t: z.literal('knockPending'),
  requestId: z.string().min(1),
  roomId: z.string().min(1),
  roomName: z.string().min(1),
});
export type KnockPendingMessage = z.infer<typeof knockPendingMessageSchema>;

// Outcome of a knock, sent to the requester (and, as 'granted'/'denied', to
// members so their toasts can dismiss once someone answered).
export const knockResultMessageSchema = z.object({
  t: z.literal('knockResult'),
  requestId: z.string().min(1),
  status: z.enum(['granted', 'denied', 'timeout', 'cancelled']),
});
export type KnockResultMessage = z.infer<typeof knockResultMessageSchema>;

export const actorJoinMessageSchema = z.object({
  t: z.literal('actorJoin'),
  actor: actorSchema,
});
export type ActorJoinMessage = z.infer<typeof actorJoinMessageSchema>;

export const actorMoveMessageSchema = z.object({
  t: z.literal('actorMove'),
  userId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  dir: dirSchema,
  moving: z.boolean(),
});
export type ActorMoveMessage = z.infer<typeof actorMoveMessageSchema>;

export const actorLeaveMessageSchema = z.object({
  t: z.literal('actorLeave'),
  userId: z.string().min(1),
});
export type ActorLeaveMessage = z.infer<typeof actorLeaveMessageSchema>;

export const errorMessageSchema = z.object({
  t: z.literal('error'),
  code: z.string().min(1),
  message: z.string(),
});
export type ErrorMessage = z.infer<typeof errorMessageSchema>;

// Sent to a client only when ITS OWN pair states change — the full adjacency
// map is never broadcast.
export const proximityMessageSchema = z.object({
  t: z.literal('proximity'),
  pairs: z.array(z.object({ userId: z.string().min(1), zone: zoneSchema })).min(1),
});
export type ProximityMessage = z.infer<typeof proximityMessageSchema>;

export const mediaStateMessageSchema = z.object({
  t: z.literal('mediaState'),
  userId: z.string().min(1),
  audio: z.boolean(),
  video: z.boolean(),
});
export type MediaStateMessage = z.infer<typeof mediaStateMessageSchema>;

// A persisted chat line (rooms Phase 6, FR-ROOM-33..36) — broadcast to every
// connection in the room's map, INCLUDING the sender (clients render only
// what the server persisted; there is no local echo).
export const chatBroadcastMessageSchema = z.object({
  t: z.literal('chatMessage'),
  id: z.string().min(1),
  userId: z.string().min(1),
  displayName: z.string().min(1),
  body: z.string().min(1),
  createdAt: z.string().min(1),
});
export type ChatBroadcastMessage = z.infer<typeof chatBroadcastMessageSchema>;

export const kanbanCardSchema = z.object({
  id: z.string().min(1),
  column: kanbanColumnKeySchema,
  title: z.string().min(1),
  description: z.string().nullable(),
  assigneeId: z.string().nullable(),
  moveNote: z.string().nullable(),
  position: z.number(),
  createdAt: z.string().min(1),
});
export type KanbanCard = z.infer<typeof kanbanCardSchema>;

// Full board, sent to each connection when it enters a room's map.
export const kanbanStateMessageSchema = z.object({
  t: z.literal('kanbanState'),
  columns: z.array(z.object({ key: kanbanColumnKeySchema, label: z.string().min(1) })),
  cards: z.array(kanbanCardSchema),
});
export type KanbanStateMessage = z.infer<typeof kanbanStateMessageSchema>;

export const kanbanCardBroadcastSchema = z.object({
  t: z.literal('kanbanCard'),
  card: kanbanCardSchema,
});
export type KanbanCardBroadcast = z.infer<typeof kanbanCardBroadcastSchema>;

export const kanbanCardRemovedSchema = z.object({
  t: z.literal('kanbanCardRemoved'),
  cardId: z.string().min(1),
});
export type KanbanCardRemoved = z.infer<typeof kanbanCardRemovedSchema>;

export const kanbanColumnBroadcastSchema = z.object({
  t: z.literal('kanbanColumn'),
  column: z.object({ key: kanbanColumnKeySchema, label: z.string().min(1) }),
});
export type KanbanColumnBroadcast = z.infer<typeof kanbanColumnBroadcastSchema>;

// LiveKit credentials for the CURRENT map's call (rooms Phase 5). Minted
// server-side per room, per user, with a short TTL (SRS NFR-SEC-02) — the
// LiveKit API secret never reaches a client. Pushed after the snapshot on
// every map entry; absent entirely when AV is not configured, which is the
// supported "no AV yet" state, not an error.
export const avTokenMessageSchema = z.object({
  t: z.literal('avToken'),
  mapId: z.string().min(1),
  /** wss:// URL of the self-hosted LiveKit server. */
  serverUrl: z.string().url(),
  /** LiveKit room name backing this map instance. */
  room: z.string().min(1),
  token: z.string().min(1),
});
export type AvTokenMessage = z.infer<typeof avTokenMessageSchema>;

// --- Workspace state (R4) ---

// Auto-generated only — never user-authored (FR-ROOM-17). `weekly_done` is
// computed at read time from the board rather than stored, so it stays true
// when cards move after the fact.
export const journeyEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['room_created', 'blueprint_first_edit', 'stage_change', 'weekly_done']),
  body: z.string(),
  createdAt: z.string(),
});
export type JourneyEntry = z.infer<typeof journeyEntrySchema>;

export const blueprintSchema = z.object({
  problem: z.string().nullable(),
  audience: z.string().nullable(),
  existing: z.string().nullable(),
});
export type Blueprint = z.infer<typeof blueprintSchema>;

/** Everything the Workspace needs, sent once in reply to `watch`. */
export const workspaceStateMessageSchema = z.object({
  t: z.literal('workspaceState'),
  roomId: z.string().min(1),
  name: z.string(),
  stage: projectStageSchema,
  domainTag: domainTagSchema.nullable(),
  blueprint: blueprintSchema,
  journey: z.array(journeyEntrySchema),
  /** Members currently in the room's live map — the Workspace shows who to go find. */
  present: z.array(z.object({ userId: z.string(), displayName: z.string() })),
});
export type WorkspaceStateMessage = z.infer<typeof workspaceStateMessageSchema>;

export const contextStateMessageSchema = z.object({
  t: z.literal('contextState'),
  roomId: z.string().min(1),
  stage: projectStageSchema,
  domainTag: domainTagSchema.nullable(),
});
export type ContextStateMessage = z.infer<typeof contextStateMessageSchema>;

export const blueprintFieldMessageSchema = z.object({
  t: z.literal('blueprintField'),
  field: blueprintFieldKeySchema,
  value: z.string(),
  editedBy: z.string(),
  editedByName: z.string(),
  at: z.string(),
});
export type BlueprintFieldMessage = z.infer<typeof blueprintFieldMessageSchema>;

export const journeyEntryMessageSchema = z.object({
  t: z.literal('journeyEntry'),
  entry: journeyEntrySchema,
});
export type JourneyEntryMessage = z.infer<typeof journeyEntryMessageSchema>;

// You are no longer in this room (R3). Sent immediately before the server
// walks the session out to the Commons, so the client can say why rather than
// making the teleport look like a bug. `removed` = the owner removed you (or
// the room went private while you were visiting); `roomDeleted` = it is gone.
export const evictedMessageSchema = z.object({
  t: z.literal('evicted'),
  roomId: z.string().min(1),
  reason: z.enum(['removed', 'roomDeleted']),
});
export type EvictedMessage = z.infer<typeof evictedMessageSchema>;
export type EvictReason = EvictedMessage['reason'];

export const serverMessageSchema = z.discriminatedUnion('t', [
  snapshotMessageSchema,
  actorJoinMessageSchema,
  actorMoveMessageSchema,
  actorLeaveMessageSchema,
  proximityMessageSchema,
  mediaStateMessageSchema,
  doorsMessageSchema,
  knockMessageSchema,
  knockPendingMessageSchema,
  knockResultMessageSchema,
  avTokenMessageSchema,
  chatBroadcastMessageSchema,
  kanbanStateMessageSchema,
  kanbanCardBroadcastSchema,
  kanbanCardRemovedSchema,
  kanbanColumnBroadcastSchema,
  workspaceStateMessageSchema,
  contextStateMessageSchema,
  blueprintFieldMessageSchema,
  journeyEntryMessageSchema,
  evictedMessageSchema,
  errorMessageSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
