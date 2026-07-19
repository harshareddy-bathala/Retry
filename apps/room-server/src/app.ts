import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { buildLoggerOptions } from './lib/logger.js';
import { createTokenVerifier } from './lib/auth.js';
import { RoomHub } from './rooms/hub.js';
import { InMemoryRoomStore, type RoomStore } from './world/store.js';
import { DailyAvProvider, type AvProvider } from './av/daily.js';

declare module 'fastify' {
  interface FastifyInstance {
    hub: RoomHub;
  }
}

export type BuildAppOptions = {
  jwtSecret: string;
  logLevel?: string;
  pretty?: boolean;
  /** Rooms persistence. Defaults to an empty in-memory store (tests / static maps only). */
  store?: RoomStore;
  /** Override the 60s knock timeout (tests). */
  knockTimeoutMs?: number;
  /** Daily.co API key (Phase 5); absent = AV disabled. */
  dailyApiKey?: string;
  /** Test seam: inject a fake AV provider instead of the real Daily client. */
  av?: AvProvider;
};

// Authenticated WebSocket endpoint backed by RoomHub (rooms build plan
// Phases 2–4). Auth is a JWT in the connection query string; unauthenticated
// sockets are closed with 4401 before touching the hub.
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions({ level: options.logLevel, pretty: options.pretty }),
  });

  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  const verifyToken = createTokenVerifier(options.jwtSecret);
  const av =
    options.av ??
    (options.dailyApiKey ? new DailyAvProvider(options.dailyApiKey, app.log) : undefined);
  const hub = new RoomHub({
    store: options.store ?? new InMemoryRoomStore(),
    knockTimeoutMs: options.knockTimeoutMs,
    av,
  });
  hub.start();
  app.addHook('onClose', async () => hub.stop());
  app.decorate('hub', hub);

  app.get('/health', () => ({ status: 'ok' }));

  app.get('/ws', { websocket: true }, async (socket, req) => {
    const { token } = req.query as { token?: string };
    const user = token ? await verifyToken(token) : null;
    if (!user) {
      req.log.warn('ws rejected: missing or invalid token');
      socket.close(4401, 'unauthorized');
      return;
    }
    app.hub.connect(socket, user, req.log);
  });

  return app;
}
