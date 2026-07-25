import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, hasTestDb, type TestContext } from '../helpers.js';

// R3: room lifecycle and membership. Until this landed a private room was a
// room of one forever — there was no way to add a second person to it.

describe.skipIf(!hasTestDb)('room membership API', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    if (ctx) await ctx.close();
    ctx = await buildTestApp();
    await ctx.resetDb();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  const createRoom = async (token: string, body: Record<string, unknown> = {}) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: as(token),
      payload: { name: 'Test Room', visibility: 'private', ...body },
    });
    return res.json<{ room: { id: string } }>().room.id;
  };

  const invite = (token: string, roomId: string, target: Record<string, string>) =>
    ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/invites`,
      headers: as(token),
      payload: target,
    });

  const listInvites = async (token: string) =>
    (
      await ctx.app.inject({ method: 'GET', url: '/api/invites', headers: as(token) })
    ).json<{ invites: Array<{ id: string; roomName: string; inviterName: string }> }>();

  const listNotifications = async (token: string) =>
    (
      await ctx.app.inject({ method: 'GET', url: '/api/notifications', headers: as(token) })
    ).json<{
      notifications: Array<{ kind: string; payload: Record<string, string>; readAt: string | null }>;
      unreadCount: number;
    }>();

  const members = async (token: string, roomId: string) =>
    (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/members`,
        headers: as(token),
      })
    ).json<{ members: Array<{ userId: string; role: string; present: boolean }> }>();

  // --- Invites -------------------------------------------------------------

  it('invite → accept is the only way into a private room', async () => {
    const owner = await ctx.seedUser('student');
    const guest = await ctx.seedUser('student');
    const roomId = await createRoom(owner.token, { name: 'Secret Base' });

    // The invitee cannot even see the room before accepting.
    const before = await ctx.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}`,
      headers: as(guest.token),
    });
    expect(before.statusCode).toBe(404);

    const created = await invite(owner.token, roomId, { email: guest.email });
    expect(created.statusCode).toBe(201);

    const pending = await listInvites(guest.token);
    expect(pending.invites).toHaveLength(1);
    expect(pending.invites[0]).toMatchObject({ roomName: 'Secret Base' });

    const accept = await ctx.app.inject({
      method: 'POST',
      url: `/api/invites/${pending.invites[0]?.id}/accept`,
      headers: as(guest.token),
    });
    expect(accept.statusCode).toBe(200);

    const roster = await members(guest.token, roomId);
    expect(roster.members.map((m) => m.role)).toEqual(['owner', 'member']);
    expect((await listInvites(guest.token)).invites).toHaveLength(0);
  });

  it('addresses invitees case-insensitively and rejects everything else', async () => {
    const owner = await ctx.seedUser('student');
    const guest = await ctx.seedUser('student');
    const faculty = await ctx.seedUser('faculty');
    const roomId = await createRoom(owner.token);

    expect((await invite(owner.token, roomId, { email: guest.email.toUpperCase() })).statusCode).toBe(201);
    // A second live invite to the same person is a mistake, not a nudge.
    expect((await invite(owner.token, roomId, { email: guest.email })).statusCode).toBe(409);
    expect((await invite(owner.token, roomId, { email: 'nobody@nttf.co.in' })).statusCode).toBe(404);
    expect((await invite(owner.token, roomId, { email: faculty.email })).statusCode).toBe(403);
    expect((await invite(owner.token, roomId, { email: owner.email })).statusCode).toBe(409);
  });

  it('only the owner may invite, and only the invitee may answer', async () => {
    const owner = await ctx.seedUser('student');
    const member = await ctx.seedUser('student');
    const outsider = await ctx.seedUser('student');
    const roomId = await createRoom(owner.token);

    await invite(owner.token, roomId, { email: member.email });
    const inviteId = (await listInvites(member.token)).invites[0]?.id;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/invites/${inviteId}/accept`,
      headers: as(member.token),
    });

    // A member is not an owner.
    const byMember = await invite(member.token, roomId, { email: outsider.email });
    expect(byMember.statusCode).toBe(403);
    expect(byMember.json<{ error: { code: string } }>().error.code).toBe('NOT_ROOM_OWNER');

    // Someone else's invite is indistinguishable from one that never existed.
    await invite(owner.token, roomId, { email: outsider.email });
    const theirs = (await listInvites(outsider.token)).invites[0]?.id;
    const stolen = await ctx.app.inject({
      method: 'POST',
      url: `/api/invites/${theirs}/accept`,
      headers: as(member.token),
    });
    expect(stolen.statusCode).toBe(404);
  });

  it('a decline is silent: the room is never told', async () => {
    const owner = await ctx.seedUser('student');
    const guest = await ctx.seedUser('student');
    const roomId = await createRoom(owner.token);
    await invite(owner.token, roomId, { email: guest.email });
    const inviteId = (await listInvites(guest.token)).invites[0]?.id;

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/invites/${inviteId}/decline`,
      headers: as(guest.token),
    });
    expect(res.statusCode).toBe(204);

    expect((await listInvites(guest.token)).invites).toHaveLength(0);
    expect((await members(owner.token, roomId)).members).toHaveLength(1);
    // The owner has no notification at all — not even a read one.
    expect((await listNotifications(owner.token)).notifications).toHaveLength(0);

    // Answering twice is a conflict, not a silent no-op.
    const again = await ctx.app.inject({
      method: 'POST',
      url: `/api/invites/${inviteId}/accept`,
      headers: as(guest.token),
    });
    expect(again.statusCode).toBe(409);
  });

  it('an accept notifies the inviter; the bell can be cleared', async () => {
    const owner = await ctx.seedUser('student');
    const guest = await ctx.seedUser('student');
    const roomId = await createRoom(owner.token, { name: 'Robotics' });
    await invite(owner.token, roomId, { email: guest.email });
    const inviteId = (await listInvites(guest.token)).invites[0]?.id;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/invites/${inviteId}/accept`,
      headers: as(guest.token),
    });

    const feed = await listNotifications(owner.token);
    expect(feed.unreadCount).toBe(1);
    expect(feed.notifications[0]).toMatchObject({
      kind: 'room_invite_accepted',
      payload: { roomId, roomName: 'Robotics' },
    });

    await ctx.app.inject({ method: 'POST', url: '/api/notifications/read', headers: as(owner.token) });
    expect((await listNotifications(owner.token)).unreadCount).toBe(0);
  });

  // --- Membership ----------------------------------------------------------

  const seedRoomWithMember = async () => {
    const owner = await ctx.seedUser('student');
    const member = await ctx.seedUser('student');
    const roomId = await createRoom(owner.token, { name: 'Shared' });
    await invite(owner.token, roomId, { email: member.email });
    const inviteId = (await listInvites(member.token)).invites[0]?.id;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/invites/${inviteId}/accept`,
      headers: as(member.token),
    });
    ctx.roomServer.evictions.length = 0;
    return { owner, member, roomId };
  };

  it('the owner removes a member, who is told and walked out of the live map', async () => {
    const { owner, member, roomId } = await seedRoomWithMember();

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/members/${member.id}`,
      headers: as(owner.token),
    });
    expect(res.statusCode).toBe(204);

    expect((await members(owner.token, roomId)).members).toHaveLength(1);
    expect((await listNotifications(member.token)).notifications[0]).toMatchObject({
      kind: 'room_member_removed',
      payload: { roomId },
    });
    // The eviction is what stops them standing in a room they were removed from.
    expect(ctx.roomServer.evictions).toEqual([
      { roomId, target: { userIds: [member.id] }, reason: 'removed' },
    ]);
  });

  it('a member can remove themselves but nobody else', async () => {
    const { owner, member, roomId } = await seedRoomWithMember();

    const other = await ctx.seedUser('student');
    const notMine = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/members/${owner.id}`,
      headers: as(member.token),
    });
    expect(notMine.statusCode).toBe(403);

    const notEvenAMember = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/members/${other.id}`,
      headers: as(owner.token),
    });
    expect(notEvenAMember.statusCode).toBe(404);

    const leave = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/members/${member.id}`,
      headers: as(member.token),
    });
    expect(leave.statusCode).toBe(204);
    // Leaving of your own accord is not something you get notified about (the
    // one notification they hold is the invite that got them in here).
    const kinds = (await listNotifications(member.token)).notifications.map((n) => n.kind);
    expect(kinds).toEqual(['room_invite']);
  });

  it('an owner who leaves hands the room to the longest-standing member', async () => {
    const { owner, member, roomId } = await seedRoomWithMember();

    // A later joiner must not jump the queue.
    const late = await ctx.seedUser('student');
    await invite(owner.token, roomId, { email: late.email });
    const lateInvite = (await listInvites(late.token)).invites[0]?.id;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/invites/${lateInvite}/accept`,
      headers: as(late.token),
    });

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/members/${owner.id}`,
      headers: as(owner.token),
    });
    expect(res.statusCode).toBe(204);

    const roster = await members(member.token, roomId);
    expect(roster.members.find((m) => m.userId === member.id)?.role).toBe('owner');
    expect(roster.members.find((m) => m.userId === late.id)?.role).toBe('member');
    expect((await listNotifications(member.token)).notifications[0]?.kind).toBe(
      'room_ownership_transferred',
    );
  });

  it('a sole owner cannot leave — that would delete the room by accident', async () => {
    const owner = await ctx.seedUser('student');
    const roomId = await createRoom(owner.token);

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}/members/${owner.id}`,
      headers: as(owner.token),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('SOLE_OWNER');
    expect((await members(owner.token, roomId)).members).toHaveLength(1);
  });

  it('ownership transfers to a chosen member, demoting the old owner', async () => {
    const { owner, member, roomId } = await seedRoomWithMember();

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/transfer`,
      headers: as(owner.token),
      payload: { userId: member.id },
    });
    expect(res.statusCode).toBe(204);

    const roster = await members(owner.token, roomId);
    expect(roster.members.find((m) => m.userId === member.id)?.role).toBe('owner');
    expect(roster.members.find((m) => m.userId === owner.id)?.role).toBe('member');

    // The former owner has lost owner powers immediately.
    const retry = await ctx.app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/transfer`,
      headers: as(owner.token),
      payload: { userId: owner.id },
    });
    expect(retry.statusCode).toBe(403);
  });

  // --- Rename, visibility, deletion ---------------------------------------

  it('renames a room and flips visibility, claiming and releasing the door slot', async () => {
    const owner = await ctx.seedUser('student');
    const roomId = await createRoom(owner.token, { name: 'Quiet Corner' });

    const toPublic = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}`,
      headers: as(owner.token),
      payload: { name: 'Loud Corner', visibility: 'public', accessPolicy: 'knock' },
    });
    expect(toPublic.statusCode).toBe(200);
    expect(toPublic.json<{ room: { name: string; accessPolicy: string } }>().room).toMatchObject({
      name: 'Loud Corner',
      accessPolicy: 'knock',
    });
    let rows = (await ctx.db.execute(`SELECT door_x FROM rooms WHERE id = '${roomId}'`)).rows;
    expect(rows[0]?.door_x).not.toBeNull();

    const toPrivate = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/rooms/${roomId}`,
      headers: as(owner.token),
      payload: { visibility: 'private' },
    });
    // Going private forces invite_only and gives the door slot back.
    expect(toPrivate.json<{ room: { accessPolicy: string } }>().room.accessPolicy).toBe('invite_only');
    rows = (await ctx.db.execute(`SELECT door_x FROM rooms WHERE id = '${roomId}'`)).rows;
    expect(rows[0]?.door_x).toBeNull();

    // Visitors standing inside a room that just went private are shown out;
    // members are spared.
    expect(ctx.roomServer.evictions.at(-1)).toEqual({
      roomId,
      target: { except: [owner.id] },
      reason: 'removed',
    });
    expect(ctx.roomServer.doorRefreshes).toBeGreaterThanOrEqual(2);
  });

  it('deleting a room takes its content with it and empties the map', async () => {
    const { owner, member, roomId } = await seedRoomWithMember();
    await ctx.db.execute(
      `INSERT INTO room_messages (room_id, sender_id, body) VALUES ('${roomId}', '${owner.id}', 'bye')`,
    );

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/rooms/${roomId}`,
      headers: as(owner.token),
    });
    expect(res.statusCode).toBe(204);

    const left = await ctx.db.execute(`SELECT count(*)::int AS n FROM room_messages`);
    expect(left.rows[0]?.n).toBe(0);
    expect((await listNotifications(member.token)).notifications[0]?.kind).toBe('room_deleted');
    expect(ctx.roomServer.evictions).toEqual([
      { roomId, target: 'all', reason: 'roomDeleted' },
    ]);
  });

  it('non-owners cannot rename or delete', async () => {
    const { member, roomId } = await seedRoomWithMember();
    for (const [method, url] of [
      ['PATCH', `/api/rooms/${roomId}`],
      ['DELETE', `/api/rooms/${roomId}`],
    ] as const) {
      const res = await ctx.app.inject({
        method,
        url,
        headers: as(member.token),
        payload: { name: 'Mine now' },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  // --- Enriched listing ----------------------------------------------------

  it('the room list carries member counts and who is in there right now', async () => {
    const { owner, member, roomId } = await seedRoomWithMember();

    // The room server writes these two columns; here we stand `member` inside.
    await ctx.db.execute(
      `UPDATE room_members SET current_map_id = '${roomId}', presence_seen_at = now()
       WHERE room_id = '${roomId}' AND user_id = '${member.id}'`,
    );

    const list = await ctx.app.inject({ method: 'GET', url: '/api/rooms', headers: as(owner.token) });
    const room = list.json<{
      mine: Array<{ id: string; memberCount: number; presentMembers: Array<{ userId: string }> }>;
    }>().mine[0];
    expect(room?.memberCount).toBe(2);
    expect(room?.presentMembers.map((p) => p.userId)).toEqual([member.id]);

    // Stale presence is not presence (NFR-REL-02: 30 seconds).
    await ctx.db.execute(
      `UPDATE room_members SET presence_seen_at = now() - interval '2 minutes'
       WHERE room_id = '${roomId}' AND user_id = '${member.id}'`,
    );
    const later = await ctx.app.inject({ method: 'GET', url: '/api/rooms', headers: as(owner.token) });
    expect(later.json<{ mine: Array<{ presentMembers: unknown[] }> }>().mine[0]?.presentMembers).toEqual([]);
  });
});
