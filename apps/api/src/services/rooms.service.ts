import { and, asc, count, desc, eq, gt, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import commonsMap from '@retry/maps/commons.json';
import { extractDoorSlots, validateMap, type DoorSlot } from '@retry/maps';
import {
  notifications,
  roomInvites,
  roomMembers,
  roomMessages,
  rooms,
  users,
  type Db,
  type NotificationKind,
  type RoomRow,
} from '@retry/db';
import type {
  ChatHistoryResponse,
  CreateInviteInput,
  CreateRoomInput,
  InvitesResponse,
  ListRoomsResponse,
  NotificationDto,
  NotificationsResponse,
  RoomMemberRole,
  RoomMembersResponse,
  RoomPresenceDto,
  RoomSummary,
  UpdateRoomInput,
} from '@retry/types';
import { AppError } from '../lib/errors.js';
import type { RoomServerClient } from '../lib/room-server.js';

const CHAT_PAGE_SIZE = 50;
const NOTIFICATION_PAGE_SIZE = 30;

/**
 * How long presence survives without a heartbeat (NFR-REL-02). The room server
 * touches presence_seen_at every 20s for everyone standing in a map and NULLs
 * it on socket close, so this window only matters for sockets that died without
 * a close frame.
 */
const PRESENCE_WINDOW_MS = 30_000;

// Rooms world API (rooms build plan Phase 4): create + list only. The room
// server owns everything live (doors state, occupancy, transitions, knocks).

const commonsResult = validateMap(commonsMap);
if (!commonsResult.ok) {
  throw new Error(`commons map violates the map contract: ${commonsResult.errors.join('; ')}`);
}
const COMMONS_DOOR_SLOTS: readonly DoorSlot[] = extractDoorSlots(commonsResult.map);

export type RoomsServiceDeps = {
  db: Db;
  /** Live-world side effects (evictions, door refresh). Best-effort by design. */
  roomServer: RoomServerClient;
};

export function createRoomsService({ db, roomServer }: RoomsServiceDeps) {
  async function createRoom(ownerId: string, input: CreateRoomInput): Promise<RoomSummary> {
    // Private rooms are unlisted and door-less; whatever policy was sent, they
    // behave as invite_only (privacy by absence — build plan Phase 4).
    const accessPolicy = input.visibility === 'private' ? 'invite_only' : input.accessPolicy;

    // Public rooms take the lowest free Commons door slot at creation time.
    const door = input.visibility === 'public' ? await claimDoorSlot(null) : null;

    const row = await db.transaction(async (tx) => {
      const [room] = await tx
        .insert(rooms)
        .values({
          name: input.name,
          description: input.description ?? null,
          ownerId,
          visibility: input.visibility,
          accessPolicy,
          doorX: door?.x ?? null,
          doorY: door?.y ?? null,
        })
        .returning();
      if (!room) throw new Error('insert returned no room row');
      await tx.insert(roomMembers).values({ roomId: room.id, userId: ownerId, role: 'owner' });
      return room;
    });

    return toSummary(row, 'owner', emptyStats());
  }

  /**
   * The lowest free Commons door slot, or a 409 when they are all taken.
   * `exceptRoomId` lets a room keep its own slot while being updated.
   */
  async function claimDoorSlot(exceptRoomId: string | null): Promise<DoorSlot> {
    const conditions = [eq(rooms.visibility, 'public'), isNotNull(rooms.doorX)];
    if (exceptRoomId) conditions.push(ne(rooms.id, exceptRoomId));
    const taken = await db
      .select({ doorX: rooms.doorX, doorY: rooms.doorY })
      .from(rooms)
      .where(and(...conditions));
    const takenKeys = new Set(taken.map((r) => `${r.doorX},${r.doorY}`));
    const door = COMMONS_DOOR_SLOTS.find((s) => !takenKeys.has(`${s.x},${s.y}`));
    if (!door) {
      throw new AppError(
        'NO_FREE_DOOR_SLOT',
        409,
        'The Commons has no free doors left. Keep the room private, or try later.',
      );
    }
    return door;
  }

  /**
   * Member counts and live presence for a set of rooms, in two queries
   * regardless of how many rooms are listed.
   */
  async function statsFor(roomIds: string[]): Promise<Map<string, RoomStats>> {
    const stats = new Map<string, RoomStats>();
    if (roomIds.length === 0) return stats;
    for (const id of roomIds) stats.set(id, emptyStats());

    const counts = await db
      .select({ roomId: roomMembers.roomId, n: count() })
      .from(roomMembers)
      .where(inArray(roomMembers.roomId, roomIds))
      .groupBy(roomMembers.roomId);
    for (const row of counts) {
      const entry = stats.get(row.roomId);
      if (entry) entry.memberCount = row.n;
    }

    // Presence = a fresh heartbeat AND current_map_id pointing at this very
    // room. The last comparison is column-to-column across text/uuid, so it is
    // done in JS (same reasoning as DrizzleRoomStore.lastActiveRoomId) over a
    // result set bounded by "recently active members of these rooms".
    const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS);
    const live = await db
      .select({
        roomId: roomMembers.roomId,
        userId: roomMembers.userId,
        name: users.name,
        currentMapId: roomMembers.currentMapId,
      })
      .from(roomMembers)
      .innerJoin(users, eq(roomMembers.userId, users.id))
      .where(
        and(inArray(roomMembers.roomId, roomIds), gt(roomMembers.presenceSeenAt, cutoff)),
      );
    for (const row of live) {
      if (row.currentMapId !== row.roomId) continue;
      stats.get(row.roomId)?.presentMembers.push({ userId: row.userId, name: row.name });
    }
    return stats;
  }

  async function listRooms(userId: string): Promise<ListRoomsResponse> {
    const memberships = await db
      .select({ room: rooms, role: roomMembers.role })
      .from(roomMembers)
      .innerJoin(rooms, eq(roomMembers.roomId, rooms.id))
      .where(eq(roomMembers.userId, userId))
      .orderBy(desc(rooms.lastActivityAt));
    const mineIds = memberships.map((m) => m.room.id);

    const publicRows = await db
      .select()
      .from(rooms)
      .where(eq(rooms.visibility, 'public'))
      .orderBy(desc(rooms.lastActivityAt));
    const discoverRows = publicRows.filter((r) => !mineIds.includes(r.id));

    const stats = await statsFor([...mineIds, ...discoverRows.map((r) => r.id)]);
    return {
      mine: memberships.map((m) => toSummary(m.room, m.role, stats.get(m.room.id))),
      discover: discoverRows.map((r) => toSummary(r, null, stats.get(r.id))),
    };
  }

  /** Room detail (the Workspace shell): members-only for private rooms. */
  async function getRoom(roomId: string, userId: string): Promise<{ room: RoomSummary }> {
    const row = await loadRoom(roomId);
    const role = await memberRole(roomId, userId);
    if (!role && row.visibility === 'private') {
      throw new AppError('NOT_FOUND', 404, 'No such room.');
    }
    const stats = await statsFor([roomId]);
    return { room: toSummary(row, role, stats.get(roomId)) };
  }

  async function loadRoom(roomId: string): Promise<RoomRow> {
    const [row] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
    if (!row) throw new AppError('NOT_FOUND', 404, 'No such room.');
    return row;
  }

  async function memberRole(roomId: string, userId: string): Promise<RoomMemberRole | null> {
    const [row] = await db
      .select({ role: roomMembers.role })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
      .limit(1);
    return row?.role ?? null;
  }

  /** Owner-gated actions. Ownership is a room-level fact, not an RBAC role. */
  async function requireOwner(roomId: string, userId: string): Promise<RoomRow> {
    const row = await loadRoom(roomId);
    if (row.ownerId !== userId) {
      throw new AppError('NOT_ROOM_OWNER', 403, 'Only the room owner can do that.');
    }
    return row;
  }

  async function notify(
    userId: string,
    kind: NotificationKind,
    payload: Record<string, string>,
  ): Promise<void> {
    await db.insert(notifications).values({ userId, kind, payload });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle (FR-ROOM-03)
  // ---------------------------------------------------------------------------

  async function updateRoom(
    roomId: string,
    userId: string,
    input: UpdateRoomInput,
  ): Promise<{ room: RoomSummary }> {
    const current = await requireOwner(roomId, userId);
    const visibility = input.visibility ?? current.visibility;

    // Private rooms are always effectively invite_only and door-less (privacy
    // by absence) — the same coercion createRoom applies.
    const accessPolicy =
      visibility === 'private' ? 'invite_only' : (input.accessPolicy ?? current.accessPolicy);

    let doorX = current.doorX;
    let doorY = current.doorY;
    let doorsChanged = false;
    if (visibility === 'public' && current.doorX === null) {
      const slot = await claimDoorSlot(roomId);
      doorX = slot.x;
      doorY = slot.y;
      doorsChanged = true;
    } else if (visibility === 'private' && current.doorX !== null) {
      doorX = null;
      doorY = null;
      doorsChanged = true;
    }

    const [row] = await db
      .update(rooms)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        visibility,
        accessPolicy,
        doorX,
        doorY,
        updatedAt: new Date(),
      })
      .where(eq(rooms.id, roomId))
      .returning();
    if (!row) throw new AppError('NOT_FOUND', 404, 'No such room.');

    // A room going private keeps its members but loses its door: anyone inside
    // who is not a member has to go, or privacy-by-absence is cosmetic.
    if (doorsChanged) {
      if (visibility === 'private') {
        const memberIds = await db
          .select({ userId: roomMembers.userId })
          .from(roomMembers)
          .where(eq(roomMembers.roomId, roomId));
        await roomServer.evict(roomId, { except: memberIds.map((m) => m.userId) }, 'removed');
      }
      await roomServer.doorsChanged();
    }

    const stats = await statsFor([roomId]);
    return { room: toSummary(row, 'owner', stats.get(roomId)) };
  }

  /**
   * Deleting a room takes its chat, board and whiteboard with it (FR-ROOM-36) —
   * every child table cascades. Members are told, then walked out to the
   * Commons so nobody is left standing in a map that no longer exists.
   */
  async function deleteRoom(roomId: string, userId: string): Promise<void> {
    const room = await requireOwner(roomId, userId);
    const others = await db
      .select({ userId: roomMembers.userId })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), ne(roomMembers.userId, userId)));

    await db.delete(rooms).where(eq(rooms.id, roomId));

    for (const m of others) {
      await notify(m.userId, 'room_deleted', { roomId, roomName: room.name });
    }
    await roomServer.evict(roomId, 'all', 'roomDeleted');
    if (room.doorX !== null) await roomServer.doorsChanged();
  }

  // ---------------------------------------------------------------------------
  // Invites (FR-ROOM-04)
  // ---------------------------------------------------------------------------

  async function createInvite(
    roomId: string,
    inviterId: string,
    input: CreateInviteInput,
  ): Promise<{ inviteId: string }> {
    const room = await requireOwner(roomId, inviterId);

    const [invitee] = await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(
        'email' in input
          ? // Emails are stored as entered; match case-insensitively so an
            // invite typed as Firstname@… still finds the account.
            sql`lower(${users.email}) = ${input.email.toLowerCase()}`
          : eq(users.id, input.userId),
      )
      .limit(1);
    if (!invitee) {
      throw new AppError('NOT_FOUND', 404, 'No Retry account with that email.');
    }
    if (invitee.role !== 'student') {
      throw new AppError('FORBIDDEN', 403, 'Rooms are a student space — only students can join.');
    }
    if (invitee.id === inviterId) {
      throw new AppError('ALREADY_A_MEMBER', 409, 'You are already in this room.');
    }
    if (await memberRole(roomId, invitee.id)) {
      throw new AppError('ALREADY_A_MEMBER', 409, `${invitee.name} is already a member.`);
    }

    const [existing] = await db
      .select({ id: roomInvites.id })
      .from(roomInvites)
      .where(
        and(
          eq(roomInvites.roomId, roomId),
          eq(roomInvites.inviteeId, invitee.id),
          eq(roomInvites.status, 'pending'),
        ),
      )
      .limit(1);
    if (existing) {
      throw new AppError('INVITE_ALREADY_PENDING', 409, `${invitee.name} already has an invite.`);
    }

    const [inviter] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, inviterId))
      .limit(1);

    const [invite] = await db
      .insert(roomInvites)
      .values({ roomId, inviterId, inviteeId: invitee.id })
      .returning({ id: roomInvites.id });
    if (!invite) throw new Error('invite insert returned no row');

    await notify(invitee.id, 'room_invite', {
      roomId,
      roomName: room.name,
      actorName: inviter?.name ?? 'A student',
      inviteId: invite.id,
    });
    return { inviteId: invite.id };
  }

  /** The invitee's own pending invites — never visible to anyone else. */
  async function listInvites(userId: string): Promise<InvitesResponse> {
    const rows = await db
      .select({
        id: roomInvites.id,
        roomId: roomInvites.roomId,
        roomName: rooms.name,
        // users is joined once, on the inviter.
        inviterName: users.name,
        createdAt: roomInvites.createdAt,
      })
      .from(roomInvites)
      .innerJoin(rooms, eq(roomInvites.roomId, rooms.id))
      .innerJoin(users, eq(roomInvites.inviterId, users.id))
      .where(and(eq(roomInvites.inviteeId, userId), eq(roomInvites.status, 'pending')))
      .orderBy(desc(roomInvites.createdAt));
    return {
      invites: rows.map((r) => ({
        id: r.id,
        roomId: r.roomId,
        roomName: r.roomName,
        inviterName: r.inviterName,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Accept or decline. A decline is deliberately silent: the room learns
   * nothing, so saying no costs a student nothing socially (FR-ROOM-04).
   */
  async function respondToInvite(
    inviteId: string,
    userId: string,
    action: 'accept' | 'decline',
  ): Promise<{ roomId: string }> {
    const [invite] = await db
      .select()
      .from(roomInvites)
      .where(eq(roomInvites.id, inviteId))
      .limit(1);
    // A stranger must not be able to tell an invite apart from a typo.
    if (!invite || invite.inviteeId !== userId) {
      throw new AppError('NOT_FOUND', 404, 'No such invite.');
    }
    if (invite.status !== 'pending') {
      throw new AppError('INVITE_NOT_PENDING', 409, 'That invite has already been answered.');
    }

    if (action === 'decline') {
      await db
        .update(roomInvites)
        .set({ status: 'declined', respondedAt: new Date() })
        .where(eq(roomInvites.id, inviteId));
      return { roomId: invite.roomId };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(roomInvites)
        .set({ status: 'accepted', respondedAt: new Date() })
        .where(eq(roomInvites.id, inviteId));
      await tx
        .insert(roomMembers)
        .values({ roomId: invite.roomId, userId, role: 'member' })
        .onConflictDoNothing();
      await tx.update(rooms).set({ lastActivityAt: new Date() }).where(eq(rooms.id, invite.roomId));
    });

    const [room] = await db
      .select({ name: rooms.name, doorX: rooms.doorX })
      .from(rooms)
      .where(eq(rooms.id, invite.roomId))
      .limit(1);
    const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    await notify(invite.inviterId, 'room_invite_accepted', {
      roomId: invite.roomId,
      roomName: room?.name ?? 'a room',
      actorName: me?.name ?? 'A student',
    });
    // Commons plaques show member counts, so a new member changes one.
    if (room && room.doorX !== null) await roomServer.doorsChanged();
    return { roomId: invite.roomId };
  }

  // ---------------------------------------------------------------------------
  // Membership (FR-ROOM-05)
  // ---------------------------------------------------------------------------

  /**
   * One route, two meanings: the owner removing someone, or anyone removing
   * themselves (leaving). An owner who leaves hands the room to the
   * longest-standing member rather than orphaning it.
   */
  async function removeMember(
    roomId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    const room = await loadRoom(roomId);
    const leaving = actorId === targetUserId;
    if (!leaving && room.ownerId !== actorId) {
      throw new AppError('NOT_ROOM_OWNER', 403, 'Only the room owner can remove members.');
    }
    if (!(await memberRole(roomId, targetUserId))) {
      throw new AppError('NOT_FOUND', 404, 'They are not a member of this room.');
    }
    if (!leaving && targetUserId === room.ownerId) {
      throw new AppError('NOT_ROOM_OWNER', 403, 'The owner cannot be removed from their own room.');
    }

    let promotedId: string | null = null;
    if (leaving && room.ownerId === actorId) {
      const [next] = await db
        .select({ userId: roomMembers.userId })
        .from(roomMembers)
        .where(and(eq(roomMembers.roomId, roomId), ne(roomMembers.userId, actorId)))
        .orderBy(asc(roomMembers.createdAt))
        .limit(1);
      if (!next) {
        // Never auto-delete a room (CLAUDE.md): leaving as the last member
        // would destroy its chat and board as a side effect of a button that
        // does not say "delete".
        throw new AppError(
          'SOLE_OWNER',
          409,
          'You are the only member. Delete the room instead of leaving it.',
        );
      }
      promotedId = next.userId;
    }

    await db.transaction(async (tx) => {
      if (promotedId) {
        await tx.update(rooms).set({ ownerId: promotedId }).where(eq(rooms.id, roomId));
        await tx
          .update(roomMembers)
          .set({ role: 'owner' })
          .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, promotedId)));
      }
      await tx
        .delete(roomMembers)
        .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, targetUserId)));
    });

    if (promotedId) {
      await notify(promotedId, 'room_ownership_transferred', {
        roomId,
        roomName: room.name,
      });
    }
    if (!leaving) {
      await notify(targetUserId, 'room_member_removed', { roomId, roomName: room.name });
    }
    // A private room they can no longer re-enter: get them out now, not when
    // they next happen to walk through a door.
    if (room.visibility === 'private' || room.accessPolicy !== 'open') {
      await roomServer.evict(roomId, { userIds: [targetUserId] }, 'removed');
    }
    if (room.doorX !== null) await roomServer.doorsChanged();
  }

  async function transferOwnership(
    roomId: string,
    ownerId: string,
    targetUserId: string,
  ): Promise<void> {
    const room = await requireOwner(roomId, ownerId);
    if (targetUserId === ownerId) return;
    if (!(await memberRole(roomId, targetUserId))) {
      throw new AppError('NOT_FOUND', 404, 'They are not a member of this room.');
    }

    await db.transaction(async (tx) => {
      await tx.update(rooms).set({ ownerId: targetUserId }).where(eq(rooms.id, roomId));
      await tx
        .update(roomMembers)
        .set({ role: 'owner' })
        .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, targetUserId)));
      await tx
        .update(roomMembers)
        .set({ role: 'member' })
        .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, ownerId)));
    });

    await notify(targetUserId, 'room_ownership_transferred', { roomId, roomName: room.name });
  }

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------

  async function listNotifications(userId: string): Promise<NotificationsResponse> {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(NOTIFICATION_PAGE_SIZE);
    return {
      notifications: rows.map(toNotificationDto),
      unreadCount: rows.filter((r) => r.readAt === null).length,
    };
  }

  async function markNotificationsRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), sql`${notifications.readAt} is null`));
  }

  async function isMember(roomId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ id: roomMembers.id })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), inArray(roomMembers.userId, [userId])))
      .limit(1);
    return rows.length > 0;
  }

  async function requireMember(roomId: string, userId: string): Promise<void> {
    if (!(await isMember(roomId, userId))) {
      throw new AppError('FORBIDDEN', 403, 'Only room members can access this.');
    }
  }

  /**
   * Chat history (FR-ROOM-34): full history for any member, including members
   * added after the messages were sent. Newest page first, 50 per page,
   * ?before= cursor for scroll-up loading; each page returned oldest→newest.
   */
  async function listMessages(
    roomId: string,
    userId: string,
    before?: string,
  ): Promise<ChatHistoryResponse> {
    await requireMember(roomId, userId);
    const conditions = [eq(roomMessages.roomId, roomId)];
    if (before) conditions.push(lt(roomMessages.createdAt, new Date(before)));
    const rows = await db
      .select({
        id: roomMessages.id,
        senderId: roomMessages.senderId,
        senderName: users.name,
        body: roomMessages.body,
        createdAt: roomMessages.createdAt,
      })
      .from(roomMessages)
      .innerJoin(users, eq(roomMessages.senderId, users.id))
      .where(and(...conditions))
      .orderBy(desc(roomMessages.createdAt), desc(roomMessages.id))
      .limit(CHAT_PAGE_SIZE);
    const page = rows.reverse().map((r) => ({
      id: r.id,
      senderId: r.senderId,
      senderName: r.senderName,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
    }));
    return {
      messages: page,
      nextBefore: rows.length === CHAT_PAGE_SIZE ? (page[0]?.createdAt ?? null) : null,
    };
  }

  async function listMembers(roomId: string, userId: string): Promise<RoomMembersResponse> {
    await requireMember(roomId, userId);
    const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS);
    const rows = await db
      .select({
        userId: roomMembers.userId,
        name: users.name,
        role: roomMembers.role,
        currentMapId: roomMembers.currentMapId,
        presenceSeenAt: roomMembers.presenceSeenAt,
        joinedAt: roomMembers.createdAt,
      })
      .from(roomMembers)
      .innerJoin(users, eq(roomMembers.userId, users.id))
      .where(eq(roomMembers.roomId, roomId))
      .orderBy(roomMembers.createdAt);
    return {
      members: rows.map((r) => ({
        userId: r.userId,
        name: r.name,
        role: r.role,
        present:
          r.currentMapId === roomId && r.presenceSeenAt !== null && r.presenceSeenAt > cutoff,
        joinedAt: r.joinedAt.toISOString(),
      })),
    };
  }

  return {
    createRoom,
    listRooms,
    getRoom,
    updateRoom,
    deleteRoom,
    isMember,
    listMessages,
    listMembers,
    createInvite,
    listInvites,
    respondToInvite,
    removeMember,
    transferOwnership,
    listNotifications,
    markNotificationsRead,
  };
}

export type RoomsService = ReturnType<typeof createRoomsService>;

type RoomStats = { memberCount: number; presentMembers: RoomPresenceDto[] };

function emptyStats(): RoomStats {
  return { memberCount: 1, presentMembers: [] };
}

function toSummary(
  row: RoomRow,
  memberRole: RoomMemberRole | null,
  stats: RoomStats = emptyStats(),
): RoomSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    accessPolicy: row.accessPolicy,
    mapTemplate: row.mapTemplate,
    ownerId: row.ownerId,
    memberRole,
    memberCount: stats.memberCount,
    lastActivityAt: row.lastActivityAt.toISOString(),
    presentMembers: stats.presentMembers,
    createdAt: row.createdAt.toISOString(),
  };
}

// payload is jsonb — unknown at the type level until it is checked.
function toNotificationDto(row: {
  id: string;
  kind: NotificationKind;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  const raw: Record<string, unknown> =
    typeof row.payload === 'object' && row.payload !== null
      ? (row.payload as Record<string, unknown>)
      : {};
  const str = (key: string): string | undefined =>
    typeof raw[key] === 'string' ? raw[key] : undefined;
  return {
    id: row.id,
    kind: row.kind,
    payload: {
      ...(str('roomId') !== undefined ? { roomId: str('roomId') } : {}),
      ...(str('roomName') !== undefined ? { roomName: str('roomName') } : {}),
      ...(str('actorName') !== undefined ? { actorName: str('actorName') } : {}),
      ...(str('inviteId') !== undefined ? { inviteId: str('inviteId') } : {}),
    },
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
