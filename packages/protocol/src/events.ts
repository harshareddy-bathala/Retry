import { z } from 'zod';

// The single source of truth for the Foundry Rooms movement protocol.
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

export const mediaMessageSchema = z.object({
  t: z.literal('media'),
  audio: z.boolean(),
  video: z.boolean(),
});
export type MediaMessage = z.infer<typeof mediaMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion('t', [
  joinMessageSchema,
  moveMessageSchema,
  leaveMessageSchema,
  chatMessageSchema,
  mediaMessageSchema,
  transitionMessageSchema,
  knockRespondMessageSchema,
  knockCancelMessageSchema,
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
  errorMessageSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
