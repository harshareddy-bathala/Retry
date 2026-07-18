import { z } from 'zod';

// The single source of truth for the Foundry Rooms movement protocol.
// Client and server import ONLY from this package — never redefine an
// event shape locally (Hard Rule 9, WEBSOCKET_EVENTS.md §"Movement protocol").

export const dirSchema = z.enum(['up', 'down', 'left', 'right']);
export type Dir = z.infer<typeof dirSchema>;

export const actorSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  sprite: z.string().min(1),
  x: z.number(),
  y: z.number(),
  dir: dirSchema,
  moving: z.boolean(),
});
export type Actor = z.infer<typeof actorSchema>;

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

// displayName/sprite are cosmetic only — identity (userId) always derives from
// the connection's JWT, never from anything a client sends.
export const joinMessageSchema = z.object({
  t: z.literal('join'),
  mapId: z.string().min(1),
  displayName: z.string().min(1).max(60).optional(),
  sprite: z.string().min(1).max(40).optional(),
});
export type JoinMessage = z.infer<typeof joinMessageSchema>;

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

export const clientMessageSchema = z.discriminatedUnion('t', [
  joinMessageSchema,
  moveMessageSchema,
  leaveMessageSchema,
  chatMessageSchema,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export const snapshotMessageSchema = z.object({
  t: z.literal('snapshot'),
  mapId: z.string().min(1),
  actors: z.array(actorSchema),
});
export type SnapshotMessage = z.infer<typeof snapshotMessageSchema>;

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

export const serverMessageSchema = z.discriminatedUnion('t', [
  snapshotMessageSchema,
  actorJoinMessageSchema,
  actorMoveMessageSchema,
  actorLeaveMessageSchema,
  errorMessageSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
