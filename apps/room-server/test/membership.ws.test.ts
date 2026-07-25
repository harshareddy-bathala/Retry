import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { parseServerMessage, type ServerMessage } from '@retry/protocol';
import { buildApp } from '../src/app.js';
import { InMemoryRoomStore } from '../src/world/store.js';

// R3: membership changes made by the API process reaching the live world, plus
// the presence heartbeat that makes "who is in this room right now" answerable
// without an attendance table.
//
// The internal surface takes real uuids (the API only ever sends database ids),
// so unlike the other suites these room ids are uuids rather than 'room-open'.

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const INTERNAL_SECRET = 'internal-secret-0123456789abcdef';

const ROOM_OPEN = '11111111-1111-4111-8111-111111111111';
const ROOM_PRIVATE = '22222222-2222-4222-8222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VISITOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let app: FastifyInstance;
let baseUrl: string;
let store: InMemoryRoomStore;
const openClients: Client[] = [];

beforeAll(async () => {
  store = new InMemoryRoomStore();
  store.addRoom(
    {
      id: ROOM_OPEN,
      name: 'Open Lab',
      visibility: 'public',
      accessPolicy: 'open',
      doorX: 3,
      doorY: 0,
      mapTemplate: 'studio_a',
    },
    [OWNER, MEMBER],
  );
  store.addRoom(
    {
      id: ROOM_PRIVATE,
      name: 'Secret Base',
      visibility: 'private',
      accessPolicy: 'invite_only',
      doorX: null,
      doorY: null,
      mapTemplate: 'studio_a',
    },
    [OWNER, MEMBER],
  );

  app = await buildApp({
    jwtSecret: SECRET,
    logLevel: 'silent',
    store,
    internalSecret: INTERNAL_SECRET,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no bound port');
  baseUrl = `ws://127.0.0.1:${address.port}/ws`;
});

afterEach(async () => {
  for (const c of openClients.splice(0)) c.socket.close();
  await until(() => app.hub.sessionCount === 0);
  // Re-seed anything a test removed so suites stay order-independent.
  store.addMember(ROOM_OPEN, MEMBER);
  store.addMember(ROOM_PRIVATE, MEMBER);
});

afterAll(async () => {
  await app.close();
});

type Client = {
  socket: WebSocket;
  messages: ServerMessage[];
  send: (msg: unknown) => void;
};

async function connect(userId: string, role = 'student'): Promise<Client> {
  const token = await new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(SECRET));
  const socket = new WebSocket(`${baseUrl}?token=${token}`);
  const messages: ServerMessage[] = [];
  socket.on('message', (data) => {
    const parsed = parseServerMessage(String(data));
    if (parsed.ok) messages.push(parsed.message);
  });
  socket.on('error', () => undefined);
  const client: Client = { socket, messages, send: (msg) => socket.send(JSON.stringify(msg)) };
  openClients.push(client);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return client;
}

async function connectAndJoin(userId: string, mapId?: string): Promise<Client> {
  const client = await connect(userId);
  client.send({ t: 'join', ...(mapId ? { mapId } : {}), displayName: userId, sprite: 'default' });
  await until(() => ofType(client, 'snapshot').length > 0);
  return client;
}

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function ofType<T extends ServerMessage['t']>(client: Client, t: T) {
  return client.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
}

async function evict(body: Record<string, unknown>, secret: string | null = INTERNAL_SECRET) {
  return await app.inject({
    method: 'POST',
    url: '/internal/evict',
    payload: body,
    headers: secret === null ? {} : { 'x-internal-secret': secret },
  });
}

describe('internal eviction API', () => {
  it('rejects a missing, wrong, or truncated secret', async () => {
    const body = { roomId: ROOM_OPEN, reason: 'removed', userIds: [MEMBER] };
    expect((await evict(body, null)).statusCode).toBe(401);
    expect((await evict(body, 'wrong-secret-of-the-same-len')).statusCode).toBe(401);
    // A prefix of the real secret must not pass a length-tolerant comparison.
    expect((await evict(body, INTERNAL_SECRET.slice(0, 8))).statusCode).toBe(401);
  });

  it('is not mounted at all when no secret is configured', async () => {
    const bare = await buildApp({ jwtSecret: SECRET, logLevel: 'silent', store });
    const res = await bare.inject({
      method: 'POST',
      url: '/internal/evict',
      payload: { roomId: ROOM_OPEN, reason: 'removed' },
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    expect(res.statusCode).toBe(404);
    await bare.close();
  });

  it('walks a removed member out to the Commons and tells the room they left', async () => {
    const owner = await connectAndJoin(OWNER, ROOM_PRIVATE);
    const member = await connectAndJoin(MEMBER, ROOM_PRIVATE);
    await until(() => ofType(owner, 'actorJoin').length === 1);

    store.removeMember(ROOM_PRIVATE, MEMBER);
    const res = await evict({ roomId: ROOM_PRIVATE, reason: 'removed', userIds: [MEMBER] });
    expect(res.json()).toEqual({ evicted: 1 });

    // The evicted client is told WHY before the map changes under it.
    await until(() => ofType(member, 'evicted').length === 1);
    expect(ofType(member, 'evicted')[0]).toMatchObject({
      roomId: ROOM_PRIVATE,
      reason: 'removed',
    });
    await until(() => ofType(member, 'snapshot').length === 2);
    expect(ofType(member, 'snapshot')[1]?.mapId).toBe('commons');
    expect(member.socket.readyState).toBe(WebSocket.OPEN);

    // And the people still inside see an ordinary departure.
    await until(() => ofType(owner, 'actorLeave').length === 1);
    expect(ofType(owner, 'actorLeave')[0]?.userId).toBe(MEMBER);
  });

  it('a deleted room empties completely', async () => {
    const owner = await connectAndJoin(OWNER, ROOM_PRIVATE);
    const member = await connectAndJoin(MEMBER, ROOM_PRIVATE);
    await until(() => ofType(owner, 'actorJoin').length === 1);

    const res = await evict({ roomId: ROOM_PRIVATE, reason: 'roomDeleted' });
    expect(res.json()).toEqual({ evicted: 2 });

    for (const client of [owner, member]) {
      await until(() => ofType(client, 'evicted').length === 1);
      expect(ofType(client, 'evicted')[0]?.reason).toBe('roomDeleted');
      await until(() => ofType(client, 'snapshot').length === 2);
      expect(ofType(client, 'snapshot')[1]?.mapId).toBe('commons');
    }
    expect(app.hub.actorsIn(ROOM_PRIVATE)).toHaveLength(0);
  });

  it('a room turning private keeps its members and drops only the visitors', async () => {
    const member = await connectAndJoin(MEMBER, ROOM_OPEN);
    const visitor = await connectAndJoin(VISITOR, ROOM_OPEN);
    await until(() => ofType(member, 'actorJoin').length === 1);

    const res = await evict({ roomId: ROOM_OPEN, reason: 'removed', except: [OWNER, MEMBER] });
    expect(res.json()).toEqual({ evicted: 1 });

    await until(() => ofType(visitor, 'evicted').length === 1);
    expect(ofType(member, 'evicted')).toHaveLength(0);
    expect(app.hub.actorsIn(ROOM_OPEN).map((a) => a.userId)).toEqual([MEMBER]);
  });

  it('revokes the knock grant, so an evicted visitor cannot walk straight back in', async () => {
    // Admitted the legitimate way, then removed: the session-scoped grant must
    // die with the eviction or the door is decorative.
    const visitor = await connectAndJoin(VISITOR, ROOM_OPEN);
    await evict({ roomId: ROOM_OPEN, reason: 'removed', userIds: [VISITOR] });
    await until(() => ofType(visitor, 'evicted').length === 1);

    // Same socket tries the room again — now a private one.
    visitor.send({ t: 'transition', toMapId: ROOM_PRIVATE });
    await until(() => ofType(visitor, 'error').length === 1);
    expect(ofType(visitor, 'error')[0]?.code).toBe('ROOM_ACCESS_DENIED');
  });

  it('evicting someone who is not in the room disturbs nobody', async () => {
    const member = await connectAndJoin(MEMBER, ROOM_OPEN);
    const res = await evict({ roomId: ROOM_OPEN, reason: 'removed', userIds: [VISITOR] });
    expect(res.json()).toEqual({ evicted: 0 });
    expect(ofType(member, 'evicted')).toHaveLength(0);
    expect(app.hub.actorsIn(ROOM_OPEN).map((a) => a.userId)).toEqual([MEMBER]);
  });

  it('rejects a malformed body rather than guessing', async () => {
    // 'commons' is a map id, not a room id — only rooms have memberships.
    const res = await evict({ roomId: 'commons', reason: 'removed' });
    expect(res.statusCode).toBe(400);
  });

  it('doors-changed pushes fresh plaques to everyone in the Commons', async () => {
    const idler = await connectAndJoin(VISITOR, 'commons');
    const before = ofType(idler, 'doors').length;

    const res = await app.inject({
      method: 'POST',
      url: '/internal/doors-changed',
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    expect(res.json()).toEqual({ ok: true });
    await until(() => ofType(idler, 'doors').length > before);
    expect(ofType(idler, 'doors').at(-1)?.doors.some((d) => d.room?.roomId === ROOM_OPEN)).toBe(
      true,
    );
  });
});

describe('presence', () => {
  it('marks a member present in the room they entered and clears it when the socket dies', async () => {
    const member = await connectAndJoin(MEMBER, ROOM_OPEN);
    await until(() => store.presenceRowsFor(MEMBER).some((r) => r.currentMapId === ROOM_OPEN));
    expect(store.presenceRowsFor(MEMBER).every((r) => r.seen !== null)).toBe(true);

    member.socket.close();
    // NULL, not a stale timestamp: presence ends with the connection.
    await until(() => store.presenceRowsFor(MEMBER).every((r) => r.seen === null));
  });

  it('follows a member through a door instead of leaving them in two rooms', async () => {
    const member = await connectAndJoin(MEMBER, ROOM_OPEN);
    await until(() => store.presenceRowsFor(MEMBER).some((r) => r.currentMapId === ROOM_OPEN));

    member.send({ t: 'transition', toMapId: 'commons' });
    await until(() => ofType(member, 'snapshot').length === 2);
    await until(() => store.presenceRowsFor(MEMBER).every((r) => r.currentMapId === 'commons'));
  });
});

describe('room activity', () => {
  it('a chat message marks the room as recently worked in', async () => {
    const member = await connectAndJoin(MEMBER, ROOM_OPEN);
    expect(store.activityAt(ROOM_OPEN)).toBeNull();

    member.send({ t: 'chat', body: 'anyone around?' });
    await until(() => store.activityAt(ROOM_OPEN) !== null);
  });

  it('a board mutation counts as activity, a rejected one does not', async () => {
    const stranger = await connectAndJoin(VISITOR, ROOM_OPEN);
    stranger.send({ t: 'kanbanCreate', column: 'todo', title: 'not mine to add' });
    await until(() => ofType(stranger, 'error').length === 1);
    expect(ofType(stranger, 'error')[0]?.code).toBe('FORBIDDEN');
    expect(store.activityAt(ROOM_PRIVATE)).toBeNull();

    const member = await connectAndJoin(MEMBER, ROOM_PRIVATE);
    member.send({ t: 'kanbanCreate', column: 'todo', title: 'ship R3' });
    await until(() => store.activityAt(ROOM_PRIVATE) !== null);
  });
});
