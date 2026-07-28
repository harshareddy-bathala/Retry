import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { parseServerMessage, type ServerMessage } from '@retry/protocol';
import { buildApp } from '../src/app.js';
import { instantiate, isBlocked } from '../src/world/maps.js';

/**
 * studio_a's default spawn, READ FROM THE MAP rather than written down here.
 *
 * It used to be the literal 10.5, 7.5, and every one of these tests failed the
 * day the studio was re-authored — as a protocol error, in nine different
 * places, for a map edit. A test may depend on the map having a spawn; it must
 * not depend on where.
 */
function studioSpawn(): { x: number; y: number } {
  const map = instantiate('studio_a', 'studio_a');
  if (!map) throw new Error('studio_a failed to instantiate');
  return map.spawn;
}

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const SPAWN = studioSpawn();

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
    // The point of this test is one rule: a move can be a legal DISTANCE and
    // still be refused because of where it lands. Nothing about it should
    // depend on the furniture.
    //
    // It has now been broken twice by map edits — once naming a desk tile
    // (14,6), once assuming a clear lane from the spawn to the north wall, and
    // there is a whiteboard in the way of that. So rather than describe a
    // route, it SEARCHES for one: a solid tile, and a clear tile within one
    // legal step of both it and the spawn.
    const map = instantiate('studio_a', 'studio_a');
    if (!map) throw new Error('studio_a failed to instantiate');
    // The server's step limit is EUCLIDEAN (hub.ts MAX_STEP_TILES, via
    // Math.hypot), not per-axis. Searching with a per-axis bound picks pairs
    // 2.24 tiles apart, which the teleport check rejects before the collision
    // check ever runs — and the test then fails for the wrong reason.
    const near = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
      Math.hypot(a.x - b.x, a.y - b.y) <= 2;

    // One legal step from the spawn to open floor, then one more into a wall.
    // The solid tile does NOT have to be near the spawn — requiring that found
    // nothing, because the spawn is deliberately in the middle of the room.
    let step: { x: number; y: number } | null = null;
    let wall: { x: number; y: number } | null = null;
    for (let sy = 1; sy < map.height - 1 && !wall; sy++) {
      for (let sx = 1; sx < map.width - 1 && !wall; sx++) {
        const from = { x: sx + 0.5, y: sy + 0.5 };
        if (isBlocked(map, sx, sy) || !near(from, SPAWN)) continue;
        for (let wy = 1; wy < map.height - 1 && !wall; wy++) {
          for (let wx = 1; wx < map.width - 1 && !wall; wx++) {
            const target = { x: wx + 0.5, y: wy + 0.5 };
            if (!isBlocked(map, wx, wy) || !near(from, target)) continue;
            step = from;
            wall = target;
          }
        }
      }
    }
    expect(wall, 'studio_a has no solid tile a legal step from open floor').not.toBeNull();
    if (!step || !wall) throw new Error('unreachable');

    const b = await connectAndJoin('user-b');
    b.send({ t: 'move', x: step.x, y: step.y, dir: 'up', moving: true });
    await until(() => app.hub.actorsIn('studio_a').some((a) => a.userId === 'user-b'));
    const before = ofType(b, 'snapshot').length;
    b.send({ t: 'move', x: wall.x, y: wall.y, dir: 'up', moving: true });
    await until(() => ofType(b, 'snapshot').length === before + 1);
    // Authoritative position is the last LEGAL one, not inside the wall.
    expect(ofType(b, 'snapshot').at(-1)?.actors.find((x) => x.userId === 'user-b')).toMatchObject(
      step,
    );
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
