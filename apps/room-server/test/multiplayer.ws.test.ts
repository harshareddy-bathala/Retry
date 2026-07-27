import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { parseServerMessage, type ServerMessage } from '@retry/protocol';
import { buildApp } from '../src/app.js';
import { instantiate, isBlocked } from '../src/world/maps.js';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const SPAWN = { x: 10.5, y: 7.5 }; // studio_a default spawn (336,240 px / 32)

let app: FastifyInstance;
let baseUrl: string;
const openClients: Client[] = [];

beforeAll(async () => {
  app = await buildApp({ jwtSecret: SECRET, logLevel: 'silent' });
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

function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ role: 'student' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(SECRET));
}

type Client = {
  socket: WebSocket;
  messages: ServerMessage[];
  send: (msg: unknown) => void;
  closeCode: Promise<number>;
};

// Listeners are attached at construction — server frames can arrive in the
// same TCP segment as the upgrade response, before an `await` resumes.
function connectRaw(query: string): Client {
  const socket = new WebSocket(`${baseUrl}${query}`);
  const messages: ServerMessage[] = [];
  socket.on('message', (data) => {
    const parsed = parseServerMessage(String(data));
    if (parsed.ok) messages.push(parsed.message);
  });
  const closeCode = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
  socket.on('error', () => undefined);
  const client: Client = {
    socket,
    messages,
    send: (msg) => socket.send(typeof msg === 'string' ? msg : JSON.stringify(msg)),
    closeCode,
  };
  openClients.push(client);
  return client;
}

async function connectAndJoin(userId: string, displayName = userId): Promise<Client> {
  const client = connectRaw(`?token=${await tokenFor(userId)}`);
  await new Promise<void>((resolve, reject) => {
    client.socket.once('open', () => resolve());
    client.socket.once('error', reject);
  });
  client.send({ t: 'join', mapId: 'studio_a', displayName, sprite: 'maker' });
  await until(() => client.messages.some((m) => m.t === 'snapshot'));
  return client;
}

async function until(predicate: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const ofType = <T extends ServerMessage['t']>(client: Client, t: T) =>
  client.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);

describe('room-server multiplayer', () => {
  it('responds on /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a connection without a token (4401)', async () => {
    const client = connectRaw('');
    expect(await client.closeCode).toBe(4401);
  });

  it('rejects a forged token (4401)', async () => {
    const forged = await new SignJWT({ role: 'student' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('intruder')
      .sign(new TextEncoder().encode('wrong-secret-wrong-secret-wrong-secret!'));
    const client = connectRaw(`?token=${forged}`);
    expect(await client.closeCode).toBe(4401);
  });

  it('join returns a snapshot with self at the map spawn', async () => {
    const a = await connectAndJoin('user-a', 'Asha');
    const snapshot = ofType(a, 'snapshot')[0];
    expect(snapshot?.mapId).toBe('studio_a');
    expect(snapshot?.actors).toEqual([
      expect.objectContaining({ userId: 'user-a', displayName: 'Asha', x: SPAWN.x, y: SPAWN.y }),
    ]);
  });

  it('broadcasts actorJoin to peers; joiner sees existing actors', async () => {
    const a = await connectAndJoin('user-a');
    const b = await connectAndJoin('user-b');
    await until(() => ofType(a, 'actorJoin').length === 1);
    expect(ofType(a, 'actorJoin')[0]?.actor.userId).toBe('user-b');
    const bSnapshot = ofType(b, 'snapshot')[0];
    expect(bSnapshot?.actors.map((x) => x.userId).sort()).toEqual(['user-a', 'user-b']);
  });

  it('relays moves to others, never echoes to the sender, and ignores spoofed userId fields', async () => {
    const a = await connectAndJoin('user-a');
    const b = await connectAndJoin('user-b');
    // Spoof attempt: extra userId field claiming to be user-a.
    b.send({ t: 'move', userId: 'user-a', x: SPAWN.x + 1, y: SPAWN.y, dir: 'right', moving: true });
    await until(() => ofType(a, 'actorMove').length === 1);
    // The broadcast carries the JWT-derived identity, not the claimed one.
    expect(ofType(a, 'actorMove')[0]).toMatchObject({ userId: 'user-b', x: SPAWN.x + 1 });
    expect(ofType(b, 'actorMove').length).toBe(0);
  });

  it('rejects a teleport (>2 tiles) and resyncs the offender only', async () => {
    const a = await connectAndJoin('user-a');
    const b = await connectAndJoin('user-b');
    const snapshotsBefore = ofType(b, 'snapshot').length;
    b.send({ t: 'move', x: SPAWN.x + 8, y: SPAWN.y, dir: 'right', moving: true });
    await until(() => ofType(b, 'snapshot').length === snapshotsBefore + 1);
    const resync = ofType(b, 'snapshot').at(-1);
    expect(resync?.actors.find((x) => x.userId === 'user-b')).toMatchObject(SPAWN);
    await new Promise((r) => setTimeout(r, 150));
    expect(ofType(a, 'actorMove').length).toBe(0);
  });

  it('rejects a legal-distance move into a collision tile and resyncs', async () => {
    // Walk north into the WALL, not into a desk. This test used to name a
    // specific desk tile (14,6) and broke the moment the room was re-furnished,
    // with a failure that read like a protocol bug rather than a map edit. The
    // wall ring is structural: every room has one, and no furniture pass moves it.
    const map = instantiate('studio_a', 'studio_a');
    if (!map) throw new Error('studio_a failed to instantiate');
    const column = Math.floor(SPAWN.x);
    expect(isBlocked(map, column, 1), 'studio_a has no north wall above the spawn').toBe(true);
    expect(isBlocked(map, column, 2)).toBe(false);

    const b = await connectAndJoin('user-b');
    // Legal steps (<= 2 tiles each) straight up the spawn column to the tile
    // just below the wall. Only the LANDING tile is collision-checked.
    for (let y = SPAWN.y - 2; y > 2.5; y -= 2) {
      b.send({ t: 'move', x: SPAWN.x, y, dir: 'up', moving: true });
    }
    b.send({ t: 'move', x: SPAWN.x, y: 2.5, dir: 'up', moving: true });
    const before = ofType(b, 'snapshot').length;
    // …then one more step, into the wall: distance legal, target blocked.
    b.send({ t: 'move', x: SPAWN.x, y: 1.5, dir: 'up', moving: true });
    await until(() => ofType(b, 'snapshot').length === before + 1);
    const resync = ofType(b, 'snapshot').at(-1);
    // Authoritative position is the last legal one, not inside the wall.
    expect(resync?.actors.find((x) => x.userId === 'user-b')).toMatchObject({
      x: SPAWN.x,
      y: 2.5,
    });
  });

  it('caps move relays at 20/s per connection, dropping the excess silently', async () => {
    const a = await connectAndJoin('user-a');
    const b = await connectAndJoin('user-b');
    for (let i = 0; i < 35; i++) {
      // Tiny legal steps back and forth
      b.send({
        t: 'move',
        x: SPAWN.x + 0.01 * (i + 1),
        y: SPAWN.y,
        dir: 'right',
        moving: true,
      });
    }
    await new Promise((r) => setTimeout(r, 400));
    const relayed = ofType(a, 'actorMove').length;
    expect(relayed).toBeGreaterThan(0);
    expect(relayed).toBeLessThanOrEqual(20);
    expect(b.socket.readyState).toBe(WebSocket.OPEN); // dropped, not disconnected
  });

  it('broadcasts actorLeave on disconnect and frees the session', async () => {
    const a = await connectAndJoin('user-a');
    const b = await connectAndJoin('user-b');
    b.socket.close();
    await until(() => ofType(a, 'actorLeave').some((m) => m.userId === 'user-b'));
    await until(() => app.hub.sessionCount === 1);
  });

  it('answers ping with pong, before and during a join', async () => {
    const client = connectRaw(`?token=${await tokenFor('pinger')}`);
    await new Promise<void>((resolve, reject) => {
      client.socket.once('open', () => resolve());
      client.socket.once('error', reject);
    });

    // Liveness must not depend on having joined a map: the client starts its
    // heartbeat the moment the socket opens.
    client.send({ t: 'ping' });
    await until(() => ofType(client, 'pong').length === 1);

    client.send({ t: 'join', mapId: 'studio_a', displayName: 'pinger', sprite: 'maker' });
    client.send({ t: 'ping' });
    await until(() => ofType(client, 'pong').length === 2);
    await until(() => ofType(client, 'snapshot').length === 1);
  });

  it('survives unparseable frames', async () => {
    const a = await connectAndJoin('user-a');
    a.send('{broken json');
    a.send({ t: 'warp', to: 'narnia' });
    await new Promise((r) => setTimeout(r, 100));
    expect(a.socket.readyState).toBe(WebSocket.OPEN);
  });
});
