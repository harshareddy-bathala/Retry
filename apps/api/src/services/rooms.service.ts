import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import commonsMap from '@foundry/maps/commons.json';
import { extractDoorSlots, validateMap, type DoorSlot } from '@foundry/maps';
import { roomMembers, rooms, type Db, type RoomRow } from '@foundry/db';
import type {
  CreateRoomInput,
  ListRoomsResponse,
  RoomMemberRole,
  RoomSummary,
} from '@foundry/types';
import { AppError } from '../lib/errors.js';

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

  /** Membership check used by tests and future routes; not exposed over HTTP yet. */
  async function isMember(roomId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ id: roomMembers.id })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), inArray(roomMembers.userId, [userId])))
      .limit(1);
    return rows.length > 0;
  }

  return { createRoom, listRooms, isMember };
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
