import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import commonsMap from '@retry/maps/commons.json';
import { extractDoorSlots, validateMap } from '@retry/maps';
import { buildTestApp, hasTestDb, type TestContext } from '../helpers.js';

/** Read the slot count from the map rather than hard-coding six — the Commons
 *  is re-authored from time to time and a literal here would rot silently. */
function commonsDoorSlotCount(): number {
  const result = validateMap(commonsMap);
  if (!result.ok) throw new Error('commons map is invalid');
  return extractDoorSlots(result.map).length;
}

// Rooms world API (rooms build plan Phase 4): creation with door-slot
// assignment, listing, and the student-only RBAC wall.

describe.skipIf(!hasTestDb)('rooms API', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    if (ctx) await ctx.close();
    ctx = await buildTestApp();
    await ctx.resetDb();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const createRoom = async (token: string, body: Record<string, unknown>) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });

  it('creates a public room: owner membership + lowest free door slot', async () => {
    const student = await ctx.seedUser('student');
    const res = await createRoom(student.token, {
      name: 'Robotics Lab',
      visibility: 'public',
      accessPolicy: 'open',
    });
    expect(res.statusCode).toBe(201);
    const { room } = res.json<{ room: { id: string; memberRole: string; accessPolicy: string } }>();
    expect(room.memberRole).toBe('owner');
    expect(room.accessPolicy).toBe('open');

    // Second public room gets a different slot (no door collisions).
    const res2 = await createRoom(student.token, {
      name: 'Second Room',
      visibility: 'public',
      accessPolicy: 'knock',
    });
    expect(res2.statusCode).toBe(201);

    const { rows } = await ctx.db.execute(
      `SELECT door_x, door_y FROM rooms ORDER BY created_at`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.door_x).not.toBeNull();
    expect(`${rows[0]?.door_x},${rows[0]?.door_y}`).not.toBe(`${rows[1]?.door_x},${rows[1]?.door_y}`);
  });

  it('private rooms get no door and are coerced to invite_only', async () => {
    const student = await ctx.seedUser('student');
    const res = await createRoom(student.token, {
      name: 'Secret Base',
      visibility: 'private',
      accessPolicy: 'open',
    });
    expect(res.statusCode).toBe(201);
    const { room } = res.json<{ room: { accessPolicy: string } }>();
    expect(room.accessPolicy).toBe('invite_only');
    const { rows } = await ctx.db.execute(`SELECT door_x, door_y FROM rooms`);
    expect(rows[0]?.door_x).toBeNull();
    expect(rows[0]?.door_y).toBeNull();
  });

  it('a full Commons yields doorless public rooms, not a refusal', async () => {
    const student = await ctx.seedUser('student');
    // One more room than the Commons has door slots. Every one of them must be
    // created: a door is a shortcut into a room, not permission to exist.
    const slots = commonsDoorSlotCount();
    for (let i = 0; i <= slots; i++) {
      const res = await createRoom(student.token, {
        name: `Room ${i}`,
        visibility: 'public',
        accessPolicy: 'open',
      });
      expect(res.statusCode).toBe(201);
    }

    const { rows } = await ctx.db.execute(
      `SELECT name, door_x FROM rooms ORDER BY created_at`,
    );
    expect(rows).toHaveLength(slots + 1);
    expect(rows.filter((r) => r.door_x !== null)).toHaveLength(slots);
    // The overflow room is the one without a door, and it says so on the wire.
    const last = rows.at(-1);
    expect(last?.door_x).toBeNull();

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/rooms',
      headers: { authorization: `Bearer ${student.token}` },
    });
    const mine = list.json<{ mine: Array<{ name: string; hasDoor: boolean }> }>().mine;
    expect(mine.find((r) => r.name === `Room ${slots}`)?.hasDoor).toBe(false);
    expect(mine.find((r) => r.name === 'Room 0')?.hasDoor).toBe(true);
  });

  it('a deleted room hands its door to the longest-waiting doorless room', async () => {
    const student = await ctx.seedUser('student');
    const slots = commonsDoorSlotCount();
    const ids: string[] = [];
    for (let i = 0; i <= slots; i++) {
      const res = await createRoom(student.token, {
        name: `Room ${i}`,
        visibility: 'public',
        accessPolicy: 'open',
      });
      ids.push(res.json<{ room: { id: string } }>().room.id);
    }
    const overflowId = ids.at(-1);

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/rooms/${ids[0]}`,
      headers: { authorization: `Bearer ${student.token}` },
      payload: { name: 'Room 0' },
    });
    expect(deleted.statusCode).toBe(204);

    const { rows } = await ctx.db.execute(
      `SELECT door_x FROM rooms WHERE id = '${overflowId}'`,
    );
    expect(rows[0]?.door_x).not.toBeNull();
  });

  it('lists mine vs discover; private rooms of others never appear', async () => {
    const a = await ctx.seedUser('student');
    const b = await ctx.seedUser('student');
    await createRoom(a.token, { name: 'A public', visibility: 'public', accessPolicy: 'open' });
    await createRoom(a.token, { name: 'A private', visibility: 'private' });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/rooms',
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ mine: unknown[]; discover: Array<{ name: string }> }>();
    expect(body.mine).toHaveLength(0);
    expect(body.discover.map((r) => r.name)).toEqual(['A public']);
  });

  it('chat history: member-only, paginated at 50, oldest-first pages (FR-ROOM-34)', async () => {
    const owner = await ctx.seedUser('student');
    const outsider = await ctx.seedUser('student');
    const created = await createRoom(owner.token, { name: 'Chatty', visibility: 'public', accessPolicy: 'open' });
    const roomId = created.json<{ room: { id: string } }>().room.id;

    // Seed 60 messages directly (the WS path owns writes in production).
    for (let i = 0; i < 60; i++) {
      await ctx.db.execute(
        `INSERT INTO room_messages (room_id, sender_id, body, created_at)
         VALUES ('${roomId}', (SELECT id FROM users LIMIT 1), 'msg ${i}',
                 now() - interval '${60 - i} seconds')`,
      );
    }

    const history = (token: string, before?: string) =>
      ctx.app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
        headers: { authorization: `Bearer ${token}` },
      });

    const page1 = await history(owner.token);
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json<{ messages: Array<{ body: string }>; nextBefore: string | null }>();
    expect(body1.messages).toHaveLength(50);
    expect(body1.messages.at(-1)?.body).toBe('msg 59');
    expect(body1.nextBefore).not.toBeNull();

    const page2 = await history(owner.token, body1.nextBefore ?? undefined);
    const body2 = page2.json<{ messages: Array<{ body: string }>; nextBefore: string | null }>();
    expect(body2.messages).toHaveLength(10);
    expect(body2.messages[0]?.body).toBe('msg 0');
    expect(body2.nextBefore).toBeNull();

    // Non-members get nothing — not even for a public room.
    expect((await history(outsider.token)).statusCode).toBe(403);
  });

  it('members endpoint lists roster for members only', async () => {
    const owner = await ctx.seedUser('student');
    const outsider = await ctx.seedUser('student');
    const created = await createRoom(owner.token, { name: 'Roster', visibility: 'private' });
    const roomId = created.json<{ room: { id: string } }>().room.id;

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/members`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(res.statusCode).toBe(200);
    const { members } = res.json<{ members: Array<{ userId: string; role: string }> }>();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: owner.id, role: 'owner' });

    const denied = await ctx.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/members`,
      headers: { authorization: `Bearer ${outsider.token}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('rejects faculty, alumni and admin (SRS §3.2/§3.3)', async () => {
    for (const role of ['faculty', 'alumni', 'admin'] as const) {
      const user = await ctx.seedUser(role);
      const res = await createRoom(user.token, { name: 'Nope', visibility: 'public' });
      expect(res.statusCode).toBe(403);
      const list = await ctx.app.inject({
        method: 'GET',
        url: '/api/rooms',
        headers: { authorization: `Bearer ${user.token}` },
      });
      expect(list.statusCode).toBe(403);
    }
  });
});
