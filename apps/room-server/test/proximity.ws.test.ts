import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { parseServerMessage, type ServerMessage } from '@retry/protocol';
import { buildApp } from '../src/app.js';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

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

type Client = {
  socket: WebSocket;
  messages: ServerMessage[];
  send: (msg: unknown) => void;
};

async function connectAndJoin(userId: string): Promise<Client> {
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
  const client: Client = {
    socket,
    messages,
    send: (msg) => socket.send(JSON.stringify(msg)),
  };
  openClients.push(client);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  client.send({ t: 'join', mapId: 'studio_a', displayName: userId, sprite: 'maker' });
  await until(() => messages.some((m) => m.t === 'snapshot'));
  return client;
}

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const proximityOf = (client: Client) =>
  client.messages.filter((m): m is Extract<ServerMessage, { t: 'proximity' }> => m.t === 'proximity');

describe('proximity over websocket', () => {
  it('two actors at spawn become close after the debounce, on both sides', async () => {
    const a = await connectAndJoin('prox-a');
    const b = await connectAndJoin('prox-b');
    await until(() => proximityOf(a).length > 0 && proximityOf(b).length > 0);
    expect(proximityOf(a)[0]?.pairs).toEqual([{ userId: 'prox-b', zone: 'close' }]);
    expect(proximityOf(b)[0]?.pairs).toEqual([{ userId: 'prox-a', zone: 'close' }]);
  });

  it('a departing peer emits zone out to the remaining side', async () => {
    const a = await connectAndJoin('prox-a');
    const b = await connectAndJoin('prox-b');
    await until(() => proximityOf(a).length > 0);
    b.socket.close();
    await until(() => proximityOf(a).some((m) => m.pairs.some((p) => p.zone === 'out')));
    const out = proximityOf(a).at(-1);
    expect(out?.pairs).toEqual([{ userId: 'prox-b', zone: 'out' }]);
  });

  it('a reconnecting client receives its zones afresh (bubble list correct after reconnect)', async () => {
    const a = await connectAndJoin('prox-a');
    const b = await connectAndJoin('prox-b');
    await until(() => proximityOf(a).length > 0 && proximityOf(b).length > 0);
    // B drops and reconnects — same user, fresh socket.
    b.socket.close();
    await until(() => app.hub.sessionCount === 1);
    const b2 = await connectAndJoin('prox-b');
    await until(() => proximityOf(b2).length > 0);
    expect(proximityOf(b2)[0]?.pairs).toEqual([{ userId: 'prox-a', zone: 'close' }]);
  });

  it('a resync snapshot carries current zones so the bubble list survives', async () => {
    const a = await connectAndJoin('prox-a');
    const b = await connectAndJoin('prox-b');
    await until(() => proximityOf(a).length > 0 && proximityOf(b).length > 0);
    const before = proximityOf(b).length;
    // Illegal teleport → server resyncs B with snapshot + zones
    b.send({ t: 'move', x: 0.5, y: 0.5, dir: 'up', moving: false });
    await until(() => proximityOf(b).length === before + 1);
    expect(proximityOf(b).at(-1)?.pairs).toEqual([{ userId: 'prox-a', zone: 'close' }]);
  });

  it('media toggles broadcast to peers and land in snapshots', async () => {
    const a = await connectAndJoin('media-a');
    const b = await connectAndJoin('media-b');
    b.send({ t: 'media', audio: false, video: true });
    await until(() => a.messages.some((m) => m.t === 'mediaState'));
    expect(a.messages.find((m) => m.t === 'mediaState')).toEqual({
      t: 'mediaState',
      userId: 'media-b',
      audio: false,
      video: true,
    });
    // A rejoining client sees B's muted state in the snapshot
    const c = await connectAndJoin('media-c');
    const snapshot = c.messages.find((m) => m.t === 'snapshot');
    if (snapshot?.t !== 'snapshot') throw new Error('no snapshot');
    expect(snapshot.actors.find((x) => x.userId === 'media-b')).toMatchObject({
      audio: false,
      video: true,
    });
  });
});
