import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { parseServerMessage, type ServerMessage } from '@retry/protocol';
import { buildApp } from '../src/app.js';
import { InMemoryRoomStore } from '../src/world/store.js';

// Emotes, typing notices and proximity speech — the three things that make the
// world feel occupied rather than merely rendered.
//
// What they have in common is that all three are EPHEMERAL: none is persisted,
// all three are rate-limited server-side, and none may be trusted from the
// wire without a whitelist. The tests below are mostly about those properties
// rather than about the happy path, because the happy path is one broadcast.

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
/** Room ids must be uuids: the `watch` schema validates the shape, and a
 *  non-uuid frame is dropped as unparseable with no reply at all. */
const ROOM = '55555555-5555-4555-8555-555555555555';
/** studio_a's default spawn, in tiles. Both users land here. */
const SPAWN = { x: 10.5, y: 7.5 };

let app: FastifyInstance;
let baseUrl: string;
let store: InMemoryRoomStore;
const openClients: Client[] = [];

beforeAll(async () => {
  store = new InMemoryRoomStore();
  store.addRoom(
    {
      id: ROOM,
      name: 'Social Lab',
      visibility: 'public',
      accessPolicy: 'open',
      doorX: null,
      doorY: null,
      mapTemplate: 'studio_a',
    },
    ['ana', 'ben', 'cara'],
  );
  app = await buildApp({ jwtSecret: SECRET, logLevel: 'silent', store });
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

async function connect(userId: string): Promise<Client> {
  const token = await new SignJWT({ role: 'student' })
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

async function join(userId: string, mapId = ROOM): Promise<Client> {
  const client = await connect(userId);
  client.send({ t: 'join', mapId, displayName: userId, sprite: 'maker' });
  await until(() => ofType(client, 'snapshot').length > 0);
  return client;
}

async function watch(userId: string, roomId = ROOM): Promise<Client> {
  const client = await connect(userId);
  client.send({ t: 'watch', roomId, displayName: userId });
  await until(() => ofType(client, 'workspaceState').length > 0);
  return client;
}

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Give the server a beat to NOT do something. */
const settle = (ms = 250): Promise<void> => new Promise((r) => setTimeout(r, ms));

const ofType = <T extends ServerMessage['t']>(client: Client, t: T) =>
  client.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);

describe('emotes', () => {
  it('fans a valid emote out to the map', async () => {
    const ana = await join('ana');
    const ben = await join('ben');

    ana.send({ t: 'emote', key: 'love' });
    await until(() => ofType(ben, 'actorEmote').length === 1);
    expect(ofType(ben, 'actorEmote')[0]).toMatchObject({ userId: 'ana', key: 'love' });
  });

  it('drops an invented key rather than relaying it', async () => {
    const ana = await join('ana');
    const ben = await join('ben');

    // The hole `sprite` used to have: any client could broadcast any string
    // and every other client would try to render it.
    ana.send({ t: 'emote', key: 'not-a-real-emote' });
    await settle();
    expect(ofType(ben, 'actorEmote')).toHaveLength(0);

    // …and the connection is still perfectly usable afterwards.
    ana.send({ t: 'emote', key: 'hey' });
    await until(() => ofType(ben, 'actorEmote').length === 1);
  });

  it('rate-limits a spamming connection without dropping it', async () => {
    const ana = await join('ana');
    const ben = await join('ben');

    for (let i = 0; i < 20; i++) ana.send({ t: 'emote', key: 'hey' });
    await settle(400);
    // First one through, the rest inside the interval silently dropped.
    expect(ofType(ben, 'actorEmote')).toHaveLength(1);
    expect(ana.socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe('typing notices', () => {
  it('reaches other people in the room but never echoes to the typist', async () => {
    const ana = await join('ana');
    const ben = await join('ben');

    ana.send({ t: 'typing' });
    await until(() => ofType(ben, 'actorTyping').length === 1);
    expect(ofType(ben, 'actorTyping')[0]).toMatchObject({ userId: 'ana', displayName: 'ana' });
    expect(ofType(ana, 'actorTyping')).toHaveLength(0);
  });

  it('reaches a Workspace watcher, who has no avatar to draw a bubble over', async () => {
    const ana = await join('ana');
    const cara = await watch('cara');

    ana.send({ t: 'typing' });
    await until(() => ofType(cara, 'actorTyping').length === 1);
  });

  it('is rate-limited: a client that fires per keystroke cannot flood the room', async () => {
    const ana = await join('ana');
    const ben = await join('ben');

    // A 40-character message typed by a client with no debounce at all.
    for (let i = 0; i < 40; i++) ana.send({ t: 'typing' });
    await settle(400);
    expect(ofType(ben, 'actorTyping')).toHaveLength(1);
  });
});

describe('proximity speech', () => {
  it('reaches only the people proximity says are close, and is never persisted', async () => {
    const ana = await join('ana');
    const ben = await join('ben');
    const far = await join('cara');

    // Ana and Ben stand together at the spawn; Cara walks well out of range.
    // The proximity engine debounces for 300ms before committing a zone.
    for (let x = SPAWN.x; x < SPAWN.x + 8; x += 2) {
      far.send({ t: 'move', x, y: SPAWN.y, dir: 'right', moving: true });
    }
    far.send({ t: 'move', x: SPAWN.x + 8, y: SPAWN.y, dir: 'right', moving: false });
    await until(() =>
      ofType(ana, 'proximity').some((m) =>
        m.pairs.some((p) => p.userId === 'ben' && p.zone === 'close'),
      ),
    );

    ana.send({ t: 'chat', body: 'over here', scope: 'nearby' });

    await until(() => ofType(ben, 'chatMessage').length === 1);
    expect(ofType(ben, 'chatMessage')[0]).toMatchObject({
      userId: 'ana',
      body: 'over here',
      scope: 'nearby',
    });
    // The speaker hears themselves — the client renders the server's copy.
    await until(() => ofType(ana, 'chatMessage').length === 1);

    // Out of earshot, and stays that way.
    await settle();
    expect(ofType(far, 'chatMessage')).toHaveLength(0);

    // Speech is not record: nothing reached the message store.
    expect(store.messagesIn(ROOM)).toHaveLength(0);
  });

  it('a watcher reading the room hears nothing said nearby', async () => {
    const ana = await join('ana');
    const cara = await watch('cara');

    ana.send({ t: 'chat', body: 'just between us', scope: 'nearby' });
    await settle();
    // A Workspace is not standing in the room; it is reading it. Nobody is
    // near it, so it is on nobody's proximity list.
    expect(ofType(cara, 'chatMessage')).toHaveLength(0);
  });

  it('room-scoped chat is unchanged: persisted, and delivered to watchers too', async () => {
    const ana = await join('ana');
    const cara = await watch('cara');

    ana.send({ t: 'chat', body: 'for the record' });
    await until(() => ofType(cara, 'chatMessage').length === 1);
    expect(ofType(cara, 'chatMessage')[0]).toMatchObject({ body: 'for the record', scope: 'room' });
    expect(store.messagesIn(ROOM)).toHaveLength(1);
  });
});
