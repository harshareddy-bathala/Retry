import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import commonsMap from '@foundry/maps/commons.json';
import { extractDoorSlots, validateMap, type DoorSlot } from '@foundry/maps';
import { roomMembers, roomMessages, rooms, users, type Db, type RoomRow } from '@foundry/db';
import type {
  ChatHistoryResponse,
  CreateRoomInput,
  ListRoomsResponse,
  RoomMemberRole,
  RoomMembersResponse,
  RoomSummary,
} from '@foundry/types';
import { AppError } from '../lib/errors.js';

const CHAT_PAGE_SIZE = 50;

// Rooms world API (rooms build plan Phase 4): create + list only. The room
// server owns everything live (doors state, occupancy, transitions, knocks).

const commonsResult = validateMap(commonsMap);
if (!commonsResult.ok) {
  throw new Error(`commons map violates the map contract: ${commonsResult.errors.join('; ')}`);
}
const COMMONS_DOOR_SLOTS: readonly DoorSlot[] = extractDoorSlots(commonsResult.map);

export type RoomsServiceDeps = {
  db: Db;
};

export function createRoomsService({ db }: RoomsServiceDeps) {
  async function createRoom(ownerId: string, input: CreateRoomInput): Promise<RoomSummary> {
    // Private rooms are unlisted and door-less; whatever policy was sent, they
    // behave as invite_only (privacy by absence — build plan Phase 4).
    const accessPolicy = input.visibility === 'private' ? 'invite_only' : input.accessPolicy;

    // Public rooms take the lowest free Commons door slot at creation time.
    let door: DoorSlot | null = null;
    if (input.visibility === 'public') {
      const taken = await db
        .select({ doorX: rooms.doorX, doorY: rooms.doorY })
        .from(rooms)
        .where(and(eq(rooms.visibility, 'public'), isNotNull(rooms.doorX)));
      const takenKeys = new Set(taken.map((r) => `${r.doorX},${r.doorY}`));
      door = COMMONS_DOOR_SLOTS.find((s) => !takenKeys.has(`${s.x},${s.y}`)) ?? null;
      if (!door) {
        throw new AppError(
          'NO_FREE_DOOR_SLOT',
          409,
          'The Commons has no free doors left. Create the room as private, or try later.',
        );
      }
    }

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

    return toSummary(row, 'owner');
  }

  async function listRooms(userId: string): Promise<ListRoomsResponse> {
    const memberships = await db
      .select({ room: rooms, role: roomMembers.role })
      .from(roomMembers)
      .innerJoin(rooms, eq(roomMembers.roomId, rooms.id))
      .where(eq(roomMembers.userId, userId))
      .orderBy(desc(rooms.updatedAt));
    const mine = memberships.map((m) => toSummary(m.room, m.role));
    const mineIds = mine.map((r) => r.id);

    const publicRows = await db
      .select()
      .from(rooms)
      .where(eq(rooms.visibility, 'public'))
      .orderBy(desc(rooms.updatedAt));
    const discover = publicRows
      .filter((r) => !mineIds.includes(r.id))
      .map((r) => toSummary(r, null));

    return { mine, discover };
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
    const rows = await db
      .select({ userId: roomMembers.userId, name: users.name, role: roomMembers.role })
      .from(roomMembers)
      .innerJoin(users, eq(roomMembers.userId, users.id))
      .where(eq(roomMembers.roomId, roomId))
      .orderBy(roomMembers.createdAt);
    return { members: rows };
  }

  return { createRoom, listRooms, isMember, listMessages, listMembers };
}

export type RoomsService = ReturnType<typeof createRoomsService>;

function toSummary(row: RoomRow, memberRole: RoomMemberRole | null): RoomSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    accessPolicy: row.accessPolicy,
    mapTemplate: row.mapTemplate,
    ownerId: row.ownerId,
    memberRole,
    createdAt: row.createdAt.toISOString(),
  };
}
