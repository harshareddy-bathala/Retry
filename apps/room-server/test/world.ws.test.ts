import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { parseServerMessage, type ServerMessage } from '@retry/protocol';
import { buildApp } from '../src/app.js';
import { COMMONS_DOOR_SLOTS } from '../src/world/maps.js';
import { InMemoryRoomStore } from '../src/world/store.js';

// Phase 4 acceptance: one socket across doors, server-side access policy,
// knock flow, doors state, map-scoped proximity, position restore.

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const KNOCK_TIMEOUT_MS = 300;

// studio_a spawn; commons spawn is (14, 9).
const SPAWN = { x: 10.5, y: 7.5 };

let app: FastifyInstance;
let baseUrl: string;
let store: InMemoryRoomStore;
const openClients: Client[] = [];

beforeAll(async () => {
  store = new InMemoryRoomStore();
  store.addRoom(
    {
      id: 'room-open',
      name: 'Open Lab',
      visibility: 'public',
      accessPolicy: 'open',
      // Taken from the map, not written down. Door slots move whenever the
      // Commons is re-authored, and a fixture holding last year's coordinates
      // silently drops its room off the wall — the same failure the API's
      // boot-time reconcileDoors exists to heal in production.
      doorX: COMMONS_DOOR_SLOTS[0]?.x ?? 2,
      doorY: COMMONS_DOOR_SLOTS[0]?.y ?? 1,
      mapTemplate: 'studio_a',
    },
    ['owner-open'],
  );
  store.addRoom(
    {
      id: 'room-knock',
      name: 'Knock Studio',
      visibility: 'public',
      accessPolicy: 'knock',
      doorX: COMMONS_DOOR_SLOTS[1]?.x ?? 5,
      doorY: COMMONS_DOOR_SLOTS[1]?.y ?? 1,
      mapTemplate: 'studio_a',
    },
    ['member-a'],
  );
  store.addRoom(
    {
      id: 'room-private',
      name: 'Secret Base',
      visibility: 'private',
      accessPolicy: 'invite_only',
      doorX: null,
      doorY: null,
      mapTemplate: 'studio_a',
    },
    ['member-a'],
  );

  app = await buildApp({
    jwtSecret: SECRET,
    logLevel: 'silent',
    store,
    knockTimeoutMs: KNOCK_TIMEOUT_MS,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no bound port');
  baseUrl = `ws://127.0.0.1:${address.port}/ws`;
});

afterEach(async () => {
  for (const c of openClients.splice(0)) c.socket.close();
  await until(() => app.hub.sessionCount === 0);
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

async function connectAndJoin(userId: string, mapId?: string, role = 'student'): Promise<Client> {
  const client = await connect(userId, role);
  client.send({ t: 'join', ...(mapId ? { mapId } : {}), displayName: userId, sprite: 'maker' });
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

describe('multi-map world', () => {
  it('transitions room → commons → room over ONE socket, with actorLeave/actorJoin on each side', async () => {
    const owner = await connectAndJoin('owner-open', 'room-open');
    const watcher = await connectAndJoin('watcher', 'commons');

    expect(ofType(owner, 'snapshot')[0]).toMatchObject({ mapId: 'room-open', template: 'studio_a' });

    // Same socket walks through the exit into the Commons.
    owner.send({ t: 'transition', toMapId: 'commons' });
    await until(() => ofType(owner, 'snapshot').length === 2);
    expect(ofType(owner, 'snapshot')[1]).toMatchObject({ mapId: 'commons', template: 'commons' });
    await until(() => ofType(watcher, 'actorJoin').length === 1);
    expect(ofType(watcher, 'actorJoin')[0]?.actor.userId).toBe('owner-open');
    expect(owner.socket.readyState).toBe(WebSocket.OPEN);

    // And back into the room; the commons watcher sees the departure.
    owner.send({ t: 'transition', toMapId: 'room-open' });
    await until(() => ofType(owner, 'snapshot').length === 3);
    expect(ofType(owner, 'snapshot')[2]).toMatchObject({ mapId: 'room-open' });
    await until(() => ofType(watcher, 'actorLeave').length === 1);
    expect(ofType(watcher, 'actorLeave')[0]?.userId).toBe('owner-open');
  });

  it('any student may enter an open room; position in a room is restored after a round trip', async () => {
    const visitor = await connectAndJoin('visitor-1', 'room-open');
    // Walk one legal step away from spawn, then leave and come back.
    visitor.send({ t: 'move', x: SPAWN.x - 1, y: SPAWN.y, dir: 'left', moving: false });
    visitor.send({ t: 'transition', toMapId: 'commons' });
    await until(() => ofType(visitor, 'snapshot').length === 2);
    visitor.send({ t: 'transition', toMapId: 'room-open' });
    await until(() => ofType(visitor, 'snapshot').length === 3);
    const self = ofType(visitor, 'snapshot')[2]?.actors.find((a) => a.userId === 'visitor-1');
    expect(self).toMatchObject({ x: SPAWN.x - 1, y: SPAWN.y });
  });

  it('rejects a crafted transition to an invite_only room server-side', async () => {
    const intruder = await connectAndJoin('intruder', 'commons');
    intruder.send({ t: 'transition', toMapId: 'room-private' });
    await until(() => ofType(intruder, 'error').length > 0);
    expect(ofType(intruder, 'error')[0]?.code).toBe('ROOM_ACCESS_DENIED');
    // Never entered: no snapshot of the private room arrived.
    expect(ofType(intruder, 'snapshot').every((s) => s.mapId === 'commons')).toBe(true);
    // Members bypass the policy.
    const member = await connectAndJoin('member-a', 'room-private');
    expect(ofType(member, 'snapshot')[0]).toMatchObject({ mapId: 'room-private' });
  });

  it('rejects faculty and alumni from the whole live space', async () => {
    for (const role of ['faculty', 'alumni']) {
      const outsider = await connect(`${role}-1`, role);
      outsider.send({ t: 'join', mapId: 'commons' });
      await until(() => ofType(outsider, 'error').length > 0);
      expect(ofType(outsider, 'error')[0]?.code).toBe('FORBIDDEN');
      expect(ofType(outsider, 'snapshot').length).toBe(0);
    }
  });

  it('doors: private rooms absent, occupancy live-updates for commons occupants', async () => {
    const watcher = await connectAndJoin('watcher', 'commons');
    await until(() => ofType(watcher, 'doors').length > 0);
    const doors = ofType(watcher, 'doors')[0]?.doors ?? [];
    // Read the count from the map: the Commons is re-authored from time to
    // time and a literal here only ever records how many doors it had once.
    expect(doors).toHaveLength(COMMONS_DOOR_SLOTS.length);
    const named = doors.filter((d) => d.room);
    expect(named.map((d) => d.room?.roomName).sort()).toEqual(['Knock Studio', 'Open Lab']);
    expect(doors.some((d) => d.room?.roomId === 'room-private')).toBe(false);
    expect(named.find((d) => d.room?.roomId === 'room-open')?.room?.occupancy).toBe(0);

    // Someone enters the open room → plaque count updates live.
    await connectAndJoin('visitor-2', 'room-open');
    await until(() =>
      ofType(watcher, 'doors').some(
        (m) => m.doors.find((d) => d.room?.roomId === 'room-open')?.room?.occupancy === 1,
      ),
    );
  });

  it('knock: member grants → requester is admitted for this session and walked in', async () => {
    const member = await connectAndJoin('member-a', 'room-knock');
    const requester = await connectAndJoin('requester-1', 'commons');

    requester.send({ t: 'transition', toMapId: 'room-knock' });
    await until(() => ofType(member, 'knock').length > 0);
    const knock = ofType(member, 'knock')[0];
    expect(knock).toMatchObject({ roomId: 'room-knock', requesterName: 'requester-1' });
    // The requester got an ack carrying the same requestId (drives cancel + waiting UI).
    await until(() => ofType(requester, 'knockPending').length > 0);
    expect(ofType(requester, 'knockPending')[0]).toMatchObject({
      requestId: knock?.requestId,
      roomName: 'Knock Studio',
    });

    member.send({ t: 'knockRespond', requestId: knock?.requestId, grant: true });
    await until(() => ofType(requester, 'snapshot').some((s) => s.mapId === 'room-knock'));
    expect(ofType(requester, 'knockResult')[0]?.status).toBe('granted');
    expect(store.getRequest(knock?.requestId ?? '')).toMatchObject({
      status: 'granted',
      resolvedBy: 'member-a',
    });

    // Admission is session-only: leaving and re-entering works on THIS socket…
    requester.send({ t: 'transition', toMapId: 'commons' });
    await until(() => ofType(requester, 'snapshot').length === 3);
    requester.send({ t: 'transition', toMapId: 'room-knock' });
    await until(() => ofType(requester, 'snapshot').length === 4);
    expect(ofType(requester, 'knock').length).toBe(0);
  });

  it('knock: deny leaves the requester where they are with a clean result', async () => {
    const member = await connectAndJoin('member-a', 'room-knock');
    const requester = await connectAndJoin('requester-2', 'commons');
    requester.send({ t: 'transition', toMapId: 'room-knock' });
    await until(() => ofType(member, 'knock').length > 0);
    member.send({ t: 'knockRespond', requestId: ofType(member, 'knock')[0]?.requestId, grant: false });
    await until(() => ofType(requester, 'knockResult').length > 0);
    expect(ofType(requester, 'knockResult')[0]?.status).toBe('denied');
    expect(ofType(requester, 'snapshot').every((s) => s.mapId === 'commons')).toBe(true);
  });

  it('knock: zero members online → clean timeout', async () => {
    const requester = await connectAndJoin('requester-3', 'commons');
    requester.send({ t: 'transition', toMapId: 'room-knock' });
    await until(() => ofType(requester, 'knockResult').length > 0, KNOCK_TIMEOUT_MS + 2000);
    expect(ofType(requester, 'knockResult')[0]?.status).toBe('timeout');
  });

  it('knock: requester can cancel', async () => {
    const member = await connectAndJoin('member-a', 'room-knock');
    const requester = await connectAndJoin('requester-4', 'commons');
    requester.send({ t: 'transition', toMapId: 'room-knock' });
    await until(() => ofType(member, 'knock').length > 0);
    requester.send({ t: 'knockCancel', requestId: ofType(member, 'knock')[0]?.requestId });
    await until(() => ofType(requester, 'knockResult').length > 0);
    expect(ofType(requester, 'knockResult')[0]?.status).toBe('cancelled');
    // The member's toast dismisses too.
    await until(() => ofType(member, 'knockResult').length > 0);
  });

  it('a non-member joining an invite_only room directly lands in the Commons with a message', async () => {
    const outsider = await connect('outsider-1');
    outsider.send({ t: 'join', mapId: 'room-private', displayName: 'outsider-1' });
    await until(() => ofType(outsider, 'snapshot').length > 0);
    expect(ofType(outsider, 'snapshot')[0]?.mapId).toBe('commons');
    await until(() => ofType(outsider, 'error').length > 0);
    expect(ofType(outsider, 'error')[0]?.code).toBe('ROOM_ACCESS_DENIED');
  });

  it('proximity never leaks across maps, even at identical tile coordinates', async () => {
    // Same template, same spawn tile — but different map instances.
    const inRoom = await connectAndJoin('member-a', 'room-private');
    const inSandbox = await connectAndJoin('sandbox-user', 'studio_a');
    // Two users who ARE together (sanity check that proximity still fires).
    const pairA = await connectAndJoin('visitor-3', 'room-open');
    const pairB = await connectAndJoin('visitor-4', 'room-open');
    await until(() => ofType(pairA, 'proximity').length > 0);
    await new Promise((r) => setTimeout(r, 400));
    expect(ofType(pairA, 'proximity')[0]?.pairs).toEqual([{ userId: 'visitor-4', zone: 'close' }]);
    expect(ofType(pairB, 'proximity')[0]?.pairs).toEqual([{ userId: 'visitor-3', zone: 'close' }]);
    // The lone occupants sharing those exact tile coordinates hear nothing.
    expect(ofType(inRoom, 'proximity').length).toBe(0);
    expect(ofType(inSandbox, 'proximity').length).toBe(0);
  });

  it('a bare join spawns the user in their last-active room, else the Commons', async () => {
    // Presence lives on membership rows, so only members get "last-active".
    const first = await connectAndJoin('owner-open', 'room-open');
    expect(ofType(first, 'snapshot')[0]?.mapId).toBe('room-open');
    first.socket.close();
    await until(() => app.hub.sessionCount === 0);

    const second = await connect('owner-open');
    second.send({ t: 'join', displayName: 'owner-open' });
    await until(() => ofType(second, 'snapshot').length > 0);
    expect(ofType(second, 'snapshot')[0]?.mapId).toBe('room-open');
    second.socket.close();
    await until(() => app.hub.sessionCount === 0);

    // A user with no memberships and no history lands in the Commons.
    const fresh = await connect('fresh-user');
    fresh.send({ t: 'join', displayName: 'fresh-user' });
    await until(() => ofType(fresh, 'snapshot').length > 0);
    expect(ofType(fresh, 'snapshot')[0]?.mapId).toBe('commons');
  });
});

describe('character selections (R5 → creator)', () => {
  const VALID = 'body_01|eyes_01|outfit_01|hair_01_01|acc_03';
  const VALID_NO_EXTRAS = 'body_02|eyes_02|outfit_02||';

  it('first entry: avatarState says not chosen, with the default character', async () => {
    const fresh = await connectAndJoin('avatar-fresh', 'commons');
    const state = ofType(fresh, 'avatarState')[0];
    expect(state).toBeDefined();
    expect(state?.chosen).toBe(false);
    // The default is itself a valid canonical selection string.
    expect(state?.sprite.split('|')).toHaveLength(5);
  });

  it('a built character persists per USER: chosen in one session, present in the next', async () => {
    const first = await connectAndJoin('avatar-keeper', 'commons');
    first.send({ t: 'avatar', sprite: VALID });
    await until(() => ofType(first, 'avatarState').some((m) => m.chosen));
    first.socket.close();
    await until(() => app.hub.sessionCount === 0);

    const second = await connectAndJoin('avatar-keeper', 'commons');
    const state = ofType(second, 'avatarState')[0];
    expect(state?.chosen).toBe(true);
    expect(state?.sprite).toBe(VALID);
  });

  it('hair and accessory are optional; the empty segments round-trip', async () => {
    const bald = await connectAndJoin('avatar-bald', 'commons');
    bald.send({ t: 'avatar', sprite: VALID_NO_EXTRAS });
    await until(() => ofType(bald, 'avatarState').some((m) => m.chosen));
    expect(ofType(bald, 'avatarState').at(-1)?.sprite).toBe(VALID_NO_EXTRAS);
  });

  // The scene and creator mount lazily and can subscribe after the join's
  // avatarState has passed — a resync must repeat it or a reload renders the
  // default character forever (found by the phase-2 browser drive).
  it('a resync re-sends avatarState with the cached choice', async () => {
    const client = await connectAndJoin('avatar-resync', 'commons');
    client.send({ t: 'avatar', sprite: VALID });
    await until(() => ofType(client, 'avatarState').some((m) => m.chosen));
    const before = ofType(client, 'avatarState').length;
    client.send({ t: 'join' }); // bare join while joined = resync request
    await until(() => ofType(client, 'avatarState').length > before);
    const repeated = ofType(client, 'avatarState').at(-1);
    expect(repeated?.sprite).toBe(VALID);
    expect(repeated?.chosen).toBe(true);
  });

  it('an invented layer id is refused: no confirmation, peers never see it', async () => {
    const peer = await connectAndJoin('avatar-peer', 'commons');
    const forger = await connectAndJoin('avatar-forger', 'commons');
    const before = ofType(forger, 'avatarState').length;
    forger.send({ t: 'avatar', sprite: 'body_99|eyes_01|outfit_01||' });
    forger.send({ t: 'avatar', sprite: 'totally-made-up' });
    // A valid one afterwards proves the socket survived the junk.
    forger.send({ t: 'avatar', sprite: VALID });
    await until(() => ofType(forger, 'avatarState').length > before);
    const states = ofType(forger, 'avatarState').slice(before);
    expect(states).toHaveLength(1);
    expect(states[0]?.sprite).toBe(VALID);
    // The peer heard exactly one re-announce, for the valid change.
    await until(() =>
      ofType(peer, 'actorJoin').some((m) => m.actor.userId === 'avatar-forger' && m.actor.sprite === VALID),
    );
    const junkSeen = ofType(peer, 'actorJoin').some(
      (m) => m.actor.sprite.includes('99') || m.actor.sprite === 'totally-made-up',
    );
    expect(junkSeen).toBe(false);
  });
});
