import { z } from 'zod';

// Rooms multi-map world (rooms build plan Phase 4). Only the world/access
// fields exist yet — the workspace shapes (blueprint, kanban, …) land with the
// main-app rooms phase.

export const ROOM_VISIBILITIES = ['public', 'private'] as const;
export type RoomVisibility = (typeof ROOM_VISIBILITIES)[number];

export const ROOM_ACCESS_POLICIES = ['open', 'knock', 'invite_only'] as const;
export type RoomAccessPolicy = (typeof ROOM_ACCESS_POLICIES)[number];

export const ROOM_MEMBER_ROLES = ['owner', 'member'] as const;
export type RoomMemberRole = (typeof ROOM_MEMBER_ROLES)[number];

export const createRoomSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
    visibility: z.enum(ROOM_VISIBILITIES).default('private'),
    // Ignored for private rooms — privacy by absence means they are always
    // effectively invite_only; the service coerces.
    accessPolicy: z.enum(ROOM_ACCESS_POLICIES).default('invite_only'),
  })
  .strict();
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

// What room lists return. memberRole is null for public rooms the caller has
// not joined. Door coordinates are intentionally not exposed here — the world
// server owns door state.
export type RoomSummary = {
  id: string;
  name: string;
  description: string | null;
  visibility: RoomVisibility;
  accessPolicy: RoomAccessPolicy;
  mapTemplate: string;
  ownerId: string;
  memberRole: RoomMemberRole | null;
  createdAt: string;
};

export type ListRoomsResponse = {
  mine: RoomSummary[];
  discover: RoomSummary[];
};

// --- Persistent panels (rooms build plan Phase 6) ---

export const chatHistoryQuerySchema = z
  .object({
    // Opaque cursor: the createdAt ISO of the oldest message already loaded.
    before: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type ChatHistoryQuery = z.infer<typeof chatHistoryQuerySchema>;

export type RoomMessageDto = {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
};

export type ChatHistoryResponse = {
  /** Oldest→newest within the page. */
  messages: RoomMessageDto[];
  /** Pass as ?before= to load the previous page; null when history is exhausted. */
  nextBefore: string | null;
};

export type RoomMemberDto = {
  userId: string;
  name: string;
  role: RoomMemberRole;
};

export type RoomMembersResponse = { members: RoomMemberDto[] };
