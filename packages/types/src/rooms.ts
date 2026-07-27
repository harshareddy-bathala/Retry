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

/**
 * The Tiled templates a room can be created from — the room's permanent look.
 * Mirrors the `templates` map in apps/room-server/src/world/maps.ts, which owns
 * the geometry; adding a template means editing both. `studio_a` stays first so
 * it remains the default for anything that omits a choice (and for every room
 * created before templates were selectable).
 */
export const ROOM_MAP_TEMPLATES = ['studio_a', 'classroom', 'lounge', 'conference'] as const;
export type RoomMapTemplate = (typeof ROOM_MAP_TEMPLATES)[number];

/** What a student is actually choosing between, for the create form. */
export const ROOM_MAP_TEMPLATE_LABELS: Record<RoomMapTemplate, { name: string; blurb: string }> = {
  studio_a: { name: 'Studio', blurb: 'Desks with PCs facing a whiteboard. The default build room.' },
  classroom: { name: 'Classroom', blurb: 'Rows of desks and a blackboard — for crits and study groups.' },
  lounge: { name: 'Lounge', blurb: 'Coffee bar, sofas, a fireplace. For talking rather than typing.' },
  conference: { name: 'Conference', blurb: 'Projection screen, podium and a big table. For rehearsing a demo.' },
};

// Mirrors packages/protocol (the wire contract owns the canonical list); the
// REST layer only ever reads these.
export const PROJECT_STAGES = ['ideation', 'planning', 'building', 'testing', 'complete'] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const createRoomSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
    visibility: z.enum(ROOM_VISIBILITIES).default('private'),
    // Ignored for private rooms — privacy by absence means they are always
    // effectively invite_only; the service coerces.
    accessPolicy: z.enum(ROOM_ACCESS_POLICIES).default('invite_only'),
    // Which room the team walks into. Permanent: the world's geometry (and so
    // every stored last_position) belongs to the template.
    mapTemplate: z.enum(ROOM_MAP_TEMPLATES).default('studio_a'),
  })
  .strict();
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

// Owner-only edits (FR-ROOM-03). Every field optional; an empty body is a
// no-op rather than an error. Flipping visibility claims or releases the
// room's Commons door slot — see rooms.service.
export const updateRoomSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    // null clears the description; omitted leaves it alone.
    description: z.string().trim().max(500).nullable().optional(),
    visibility: z.enum(ROOM_VISIBILITIES).optional(),
    accessPolicy: z.enum(ROOM_ACCESS_POLICIES).optional(),
  })
  .strict();
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

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
  /** Project context (FR-ROOM-09); edited live over the WS, read here. */
  projectStage: ProjectStage;
  domainTag: string | null;
  memberCount: number;
  /** ISO; drives room-list ordering (FR-ROOM-06). */
  lastActivityAt: string;
  /** Members whose live presence is in this room right now (FR-ROOM-08). */
  presentMembers: RoomPresenceDto[];
  createdAt: string;
};

export type RoomPresenceDto = { userId: string; name: string };

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
  /** Live presence, from presence_seen_at — not an attendance record. */
  present: boolean;
  joinedAt: string;
};

export type RoomMembersResponse = { members: RoomMemberDto[] };

// --- Invites, membership and notifications (R3) ---

// Invite by college email (deterministic) or by user id (from a picker). Names
// are ambiguous across 4000+ students, so they are not an addressing mode.
export const createInviteSchema = z
  .union([
    z.object({ email: z.string().trim().email().max(200) }).strict(),
    z.object({ userId: z.string().uuid() }).strict(),
  ])
  .describe('invite target');
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const transferOwnershipSchema = z.object({ userId: z.string().uuid() }).strict();
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

export type RoomInviteDto = {
  id: string;
  roomId: string;
  roomName: string;
  inviterName: string;
  createdAt: string;
};

export type InvitesResponse = { invites: RoomInviteDto[] };

export const NOTIFICATION_KINDS = [
  'room_invite',
  'room_invite_accepted',
  'room_member_removed',
  'room_deleted',
  'room_ownership_transferred',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationDto = {
  id: string;
  kind: NotificationKind;
  /** Kind-specific; the bell reads roomName/actorName/inviteId when present. */
  payload: {
    roomId?: string;
    roomName?: string;
    actorName?: string;
    inviteId?: string;
  };
  readAt: string | null;
  createdAt: string;
};

export type NotificationsResponse = {
  notifications: NotificationDto[];
  unreadCount: number;
};
