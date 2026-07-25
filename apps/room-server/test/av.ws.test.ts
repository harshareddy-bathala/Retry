import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { parseServerMessage, type ServerMessage } from '@retry/protocol';
import { buildApp } from '../src/app.js';
import { InMemoryRoomStore } from '../src/world/store.js';
import type { AvGrant, AvProvider } from '../src/av/livekit.js';

// Phase 5: AV orchestration — one LiveKit room per map instance, tokens
// pushed with map entry, cached grants on resync, graceful degradation. The
// provider is faked here; LiveKitAvProvider itself is pure token signing.

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

class FakeAv implements AvProvider {
  calls: Array<{ mapId: string; userId: string; userName: string }> = [];
  failNext = false;
  async grantFor(mapId: string, userId: string, userName: string): Promise<AvGrant> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('av provider is down');
    }
    this.calls.push({ mapId, userId, userName });
    return {
      serverUrl: `wss://fake.livekit.local`,
      room: `retry-${mapId}`,
      token: `tok-${mapId}-${userId}-${this.calls.length}`,
    };
  }
}

let app: FastifyInstance;
let baseUrl: string;
let fakeAv: FakeAv;
const openClients: Client[] = [];

beforeAll(async () => {
  const store = new InMemoryRoomStore();
  store.addRoom(
    {
      id: 'room-open',
      name: 'Open Lab',
      visibility: 'public',
      accessPolicy: 'open',
      doorX: 2,
      doorY: 1,
      mapTemplate: 'studio_a',
    },
    ['owner-open'],
  );
  fakeAv = new FakeAv();
  app = await buildApp({ jwtSecret: SECRET, logLevel: 'silent', store, av: fakeAv });
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

type Client = { socket: WebSocket; messages: ServerMessage[]; send: (msg: unknown) => void };

async function connectAndJoin(userId: string, mapId: string): Promise<Client> {
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
  client.send({ t: 'join', mapId, displayName: userId, sprite: 'maker' });
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

const avTokensOf = (c: Client) =>
  c.messages.filter((m): m is Extract<ServerMessage, { t: 'avToken' }> => m.t === 'avToken');

describe('livekit av flow', () => {
  it('pushes an avToken for the joined map, minted for this user', async () => {
    const c = await connectAndJoin('av-user', 'commons');
    await until(() => avTokensOf(c).length > 0);
    const msg = avTokensOf(c)[0];
    expect(msg).toMatchObject({ mapId: 'commons', room: 'retry-commons', serverUrl: 'wss://fake.livekit.local' });
    expect(fakeAv.calls.at(-1)).toMatchObject({ mapId: 'commons', userId: 'av-user' });
  });

  it('transition hands over to the NEW map\'s LiveKit room with a fresh token', async () => {
    const c = await connectAndJoin('owner-open', 'room-open');
    await until(() => avTokensOf(c).length > 0);
    c.send({ t: 'transition', toMapId: 'commons' });
    await until(() => avTokensOf(c).length > 1);
    const [inRoom, inCommons] = avTokensOf(c);
    expect(inRoom?.mapId).toBe('room-open');
    expect(inCommons?.mapId).toBe('commons');
    expect(inRoom?.room).not.toBe(inCommons?.room);
    expect(inRoom?.token).not.toBe(inCommons?.token);
  });

  it('a resync re-sends the cached grant without a re-mint', async () => {
    const c = await connectAndJoin('av-user', 'commons');
    await until(() => avTokensOf(c).length > 0);
    const mints = fakeAv.calls.length;
    c.send({ t: 'join' }); // bare join = resync
    await until(() => avTokensOf(c).length > 1);
    expect(avTokensOf(c)[1]?.token).toBe(avTokensOf(c)[0]?.token);
    expect(fakeAv.calls.length).toBe(mints);
  });

  it('an AV provider outage degrades to no avToken — entry itself still works', async () => {
    fakeAv.failNext = true;
    const c = await connectAndJoin('av-user', 'commons');
    await new Promise((r) => setTimeout(r, 200));
    expect(avTokensOf(c).length).toBe(0);
    expect(c.messages.some((m) => m.t === 'snapshot')).toBe(true);
    expect(c.messages.some((m) => m.t === 'error')).toBe(false);
  });

  it('without an AV provider no avToken is ever sent', async () => {
    const bare = await buildApp({ jwtSecret: SECRET, logLevel: 'silent' });
    await bare.listen({ port: 0, host: '127.0.0.1' });
    const address = bare.server.address();
    if (address === null || typeof address === 'string') throw new Error('no bound port');
    try {
      const token = await new SignJWT({ role: 'student' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('solo')
        .setExpirationTime('10m')
        .sign(new TextEncoder().encode(SECRET));
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws?token=${token}`);
      const messages: ServerMessage[] = [];
      socket.on('message', (data) => {
        const parsed = parseServerMessage(String(data));
        if (parsed.ok) messages.push(parsed.message);
      });
      await new Promise<void>((resolve) => socket.once('open', () => resolve()));
      socket.send(JSON.stringify({ t: 'join', mapId: 'commons', displayName: 'solo' }));
      await until(() => messages.some((m) => m.t === 'snapshot'));
      await new Promise((r) => setTimeout(r, 200));
      expect(messages.some((m) => m.t === 'avToken')).toBe(false);
      socket.close();
    } finally {
      await bare.close();
    }
  });
});
