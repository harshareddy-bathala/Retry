import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { parseServerMessage, type ServerMessage } from '@retry/protocol';
import { buildApp } from '../src/app.js';
import { InMemoryRoomStore } from '../src/world/store.js';

// R4: the Workspace — a room that works when nobody else is online. `watch`
// subscribes a member to a room's panel channel with no actor, no proximity
// and no AV, over the SAME socket the Live Space uses.

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const INTERNAL_SECRET = 'internal-secret-0123456789abcdef';

const ROOM = '33333333-3333-4333-8333-333333333333';
const OTHER_ROOM = '44444444-4444-4444-8444-444444444444';
const ALICE = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb';
const CAROL = 'dddddddd-1111-4ddd-8ddd-dddddddddddd';
const STRANGER = 'cccccccc-1111-4ccc-8ccc-cccccccccccc';

let app: FastifyInstance;
let baseUrl: string;
let store: InMemoryRoomStore;
const openClients: Client[] = [];

beforeAll(async () => {
  store = new InMemoryRoomStore();
  for (const id of [ROOM, OTHER_ROOM]) {
    store.addRoom(
      {
        id,
        name: id === ROOM ? 'Solar Tracker' : 'Second Room',
        visibility: 'private',
        accessPolicy: 'invite_only',
        doorX: null,
        doorY: null,
        mapTemplate: 'studio_a',
      },
      [ALICE, BOB, CAROL],
    );
  }

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

/** A Workspace session: connected, watching, never joined a map. */
async function watch(userId: string, roomId = ROOM): Promise<Client> {
  const client = await connect(userId);
  client.send({ t: 'watch', roomId, displayName: `Name ${userId.slice(0, 4)}` });
  await until(() => ofType(client, 'workspaceState').length > 0 || ofType(client, 'error').length > 0);
  return client;
}

/** A Live Space session: joined the room's map, with an avatar. */
async function join(userId: string, mapId = ROOM): Promise<Client> {
  const client = await connect(userId);
  client.send({ t: 'join', mapId, displayName: userId, sprite: 'default' });
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

describe('workspace watch mode', () => {
  it('gives a member the whole room state without putting them on the map', async () => {
    const alice = await watch(ALICE);

    const state = ofType(alice, 'workspaceState')[0];
    expect(state).toMatchObject({
      roomId: ROOM,
      name: 'Solar Tracker',
      stage: 'ideation',
      domainTag: null,
      blueprint: { problem: null, audience: null, existing: null },
    });
    // The board arrives too — the Workspace reuses the Live Space's panels.
    await until(() => ofType(alice, 'kanbanState').length > 0);

    // No avatar anywhere: watching is not standing in the room.
    expect(app.hub.actorsIn(ROOM)).toHaveLength(0);
    expect(ofType(alice, 'snapshot')).toHaveLength(0);
  });

  it('refuses a non-member, with nothing leaked about the room', async () => {
    const stranger = await watch(STRANGER);
    expect(ofType(stranger, 'workspaceState')).toHaveLength(0);
    expect(ofType(stranger, 'error')[0]).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('carries chat both ways between the Workspace and the Live Space', async () => {
    const alice = await watch(ALICE);
    const bob = await join(BOB);

    bob.send({ t: 'chat', body: 'anyone reading this from the workspace?' });
    await until(() => ofType(alice, 'chatMessage').length === 1);
    expect(ofType(alice, 'chatMessage')[0]?.body).toContain('workspace');

    // And back — a watcher can talk without ever entering the map (FR-ROOM-33).
    alice.send({ t: 'chat', body: 'reading you' });
    await until(() => ofType(bob, 'chatMessage').length === 2);
    expect(ofType(bob, 'chatMessage')[1]).toMatchObject({
      userId: ALICE,
      // A watcher who never joined a map still has a name on their messages.
      displayName: `Name ${ALICE.slice(0, 4)}`,
    });
  });

  it('carries blueprint edits both ways', async () => {
    const alice = await watch(ALICE);
    const bob = await join(BOB);

    alice.send({ t: 'blueprintUpdate', field: 'problem', value: 'Panels are cleaned blind' });
    await until(() => ofType(bob, 'blueprintField').length === 1);
    expect(ofType(bob, 'blueprintField')[0]).toMatchObject({
      field: 'problem',
      value: 'Panels are cleaned blind',
      editedBy: ALICE,
    });

    bob.send({ t: 'blueprintUpdate', field: 'audience', value: 'Rooftop installers' });
    await until(() => ofType(alice, 'blueprintField').length === 2);

    // Both edits survive as state, not just as events.
    const fresh = await watch(BOB);
    expect(ofType(fresh, 'workspaceState')[0]?.blueprint).toMatchObject({
      problem: 'Panels are cleaned blind',
      audience: 'Rooftop installers',
    });
  });

  it("logs each field's FIRST edit on the journey and nothing after", async () => {
    const alice = await watch(ALICE);
    alice.send({ t: 'blueprintUpdate', field: 'existing', value: 'Manual checklists' });
    await until(() => ofType(alice, 'journeyEntry').length === 1);
    expect(ofType(alice, 'journeyEntry')[0]?.entry).toMatchObject({
      kind: 'blueprint_first_edit',
    });

    // Rewriting the same field is an edit, not a milestone (FR-ROOM-17).
    alice.send({ t: 'blueprintUpdate', field: 'existing', value: 'Manual checklists and a WhatsApp group' });
    await until(() => ofType(alice, 'blueprintField').length === 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(ofType(alice, 'journeyEntry')).toHaveLength(1);
  });

  it('logs a stage change but not a domain tag', async () => {
    const alice = await watch(ALICE);
    const before = ofType(alice, 'journeyEntry').length;

    alice.send({ t: 'contextUpdate', domainTag: 'Education' });
    await until(() => ofType(alice, 'contextState').length === 1);
    expect(ofType(alice, 'contextState')[0]?.domainTag).toBe('Education');
    await new Promise((r) => setTimeout(r, 150));
    expect(ofType(alice, 'journeyEntry')).toHaveLength(before);

    alice.send({ t: 'contextUpdate', stage: 'building' });
    await until(() => ofType(alice, 'journeyEntry').length === before + 1);
    expect(ofType(alice, 'journeyEntry').at(-1)?.entry.body).toContain('Building');
    // The tag set a moment ago is not clobbered by a stage-only update.
    expect(ofType(alice, 'contextState').at(-1)).toMatchObject({
      stage: 'building',
      domainTag: 'Education',
    });
  });

  it('never sends movement or proximity to a watcher', async () => {
    const alice = await watch(ALICE);
    const bob = await join(BOB);
    const carol = await join(CAROL); // a second body, so the move has a witness

    bob.send({ t: 'move', x: 10.6, y: 7.5, dir: 'right', moving: true });
    bob.send({ t: 'move', x: 10.9, y: 7.5, dir: 'right', moving: false });
    await until(() => ofType(carol, 'actorMove').length > 0);
    await new Promise((r) => setTimeout(r, 200));

    expect(ofType(alice, 'actorMove')).toHaveLength(0);
    expect(ofType(alice, 'proximity')).toHaveLength(0);
    // But the Workspace does learn who walked in, so it can show them.
    expect(ofType(alice, 'actorJoin').map((m) => m.actor.userId)).toContain(BOB);
  });

  it('stops delivering after unwatch, and on socket close', async () => {
    const alice = await watch(ALICE);
    const bob = await join(BOB);

    alice.send({ t: 'unwatch' });
    await new Promise((r) => setTimeout(r, 100));
    bob.send({ t: 'chat', body: 'still there?' });
    await until(() => ofType(bob, 'chatMessage').length === 1);
    expect(ofType(alice, 'chatMessage')).toHaveLength(0);

    // A closed watcher must not linger in the registry either.
    const second = await watch(ALICE);
    second.socket.close();
    await until(() => app.hub.sessionCount === 2);
    bob.send({ t: 'chat', body: 'and now?' });
    await until(() => ofType(bob, 'chatMessage').length === 2);
  });

  it('watches one room at a time', async () => {
    const alice = await watch(ALICE, ROOM);
    alice.send({ t: 'watch', roomId: OTHER_ROOM });
    await until(() => ofType(alice, 'workspaceState').length === 2);
    expect(ofType(alice, 'workspaceState')[1]?.roomId).toBe(OTHER_ROOM);

    const bob = await join(BOB, ROOM);
    bob.send({ t: 'chat', body: 'first room only' });
    await until(() => ofType(bob, 'chatMessage').length === 1);
    await new Promise((r) => setTimeout(r, 150));
    expect(ofType(alice, 'chatMessage')).toHaveLength(0);
  });

  it('counts this week’s Done cards without storing the count', async () => {
    const bob = await join(BOB);
    bob.send({ t: 'kanbanCreate', column: 'todo', title: 'Wire the sensor' });
    await until(() => ofType(bob, 'kanbanCard').length === 1);
    const cardId = ofType(bob, 'kanbanCard')[0]?.card.id ?? '';
    bob.send({ t: 'kanbanMove', cardId, column: 'done', position: 1 });
    await until(() => ofType(bob, 'kanbanCard').length === 2);

    const alice = await watch(ALICE);
    const journey = ofType(alice, 'workspaceState')[0]?.journey ?? [];
    const rollup = journey.find((e) => e.kind === 'weekly_done');
    expect(rollup?.body).toContain('1 task');

    // Moving it back out changes the count on the next read — the rollup is
    // computed, not a frozen row.
    bob.send({ t: 'kanbanMove', cardId, column: 'doing', position: 1 });
    await until(() => ofType(bob, 'kanbanCard').length === 3);
    const again = await watch(BOB);
    expect(
      (ofType(again, 'workspaceState')[0]?.journey ?? []).some((e) => e.kind === 'weekly_done'),
    ).toBe(false);
  });

  it('keeps a watcher alive when the same user enters the Live Space elsewhere', async () => {
    // One avatar per user, but the Workspace in another tab is not an avatar —
    // superseding it would close the page you were reading.
    const alice = await watch(ALICE);
    const aliceInWorld = await join(ALICE);

    expect(alice.socket.readyState).toBe(WebSocket.OPEN);
    const bob = await join(BOB);
    bob.send({ t: 'chat', body: 'both tabs should hear this' });
    await until(() => ofType(alice, 'chatMessage').length === 1);
    expect(ofType(aliceInWorld, 'chatMessage')).toHaveLength(1);
  });

  it('closes the Workspace of someone removed from the room', async () => {
    const alice = await watch(ALICE);
    const bob = await join(BOB);

    const res = await app.inject({
      method: 'POST',
      url: '/internal/evict',
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      payload: { roomId: ROOM, reason: 'removed', userIds: [ALICE] },
    });
    expect(res.json()).toEqual({ evicted: 1 });

    await until(() => ofType(alice, 'evicted').length === 1);
    bob.send({ t: 'chat', body: 'private again' });
    await until(() => ofType(bob, 'chatMessage').length === 1);
    await new Promise((r) => setTimeout(r, 150));
    expect(ofType(alice, 'chatMessage')).toHaveLength(0);
  });
});
