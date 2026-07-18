import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { parseServerMessage } from '@foundry/protocol';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;
let wsUrl: string;

beforeAll(async () => {
  app = await buildApp({ logLevel: 'silent' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no bound port');
  wsUrl = `ws://127.0.0.1:${address.port}/ws`;
});

afterAll(async () => {
  await app.close();
});

type Client = {
  socket: WebSocket;
  nextMessage: () => Promise<string>;
  closed: () => Promise<void>;
};

// The message listener must be attached at construction: the server sends the
// snapshot immediately, so the frame can arrive in the same TCP segment as the
// upgrade response and be emitted before an `await` resumes. Listening late
// loses it.
function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const inbox: string[] = [];
    const waiters: Array<(msg: string) => void> = [];
    socket.on('message', (data) => {
      const msg = String(data);
      const waiter = waiters.shift();
      if (waiter) waiter(msg);
      else inbox.push(msg);
    });
    const closedPromise = new Promise<void>((r) => socket.once('close', () => r()));
    socket.once('error', reject);
    socket.once('open', () =>
      resolve({
        socket,
        nextMessage: () => {
          const queued = inbox.shift();
          if (queued !== undefined) return Promise.resolve(queued);
          return new Promise<string>((r) => waiters.push(r));
        },
        closed: () => closedPromise,
      }),
    );
  });
}

async function until(predicate: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('room-server health check', () => {
  it('responds on /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('accepts a connection and sends an empty snapshot', async () => {
    const client = await connect();
    const raw = await client.nextMessage();
    const parsed = parseServerMessage(raw);
    expect(parsed).toEqual({
      ok: true,
      message: { t: 'snapshot', mapId: 'studio_a', actors: [] },
    });
    client.socket.close();
    await client.closed();
  });

  it('drops unparseable messages without killing the connection', async () => {
    const client = await connect();
    await client.nextMessage();
    client.socket.send('{definitely not json');
    client.socket.send(JSON.stringify({ t: 'teleport', anywhere: true }));
    client.socket.send(JSON.stringify({ t: 'join', mapId: 'studio_a' }));
    // Connection must still be alive after garbage frames.
    await new Promise((r) => setTimeout(r, 100));
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.socket.close();
    await client.closed();
  });

  it('releases the server-side handle on disconnect (no leak)', async () => {
    const client = await connect();
    await client.nextMessage();
    await until(() => app.liveConnections.size === 1);
    client.socket.close();
    await client.closed();
    await until(() => app.liveConnections.size === 0);
    expect(app.liveConnections.size).toBe(0);
  });
});
