import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { buildLoggerOptions } from './lib/logger.js';
import { createTokenVerifier } from './lib/auth.js';
import { RoomHub } from './rooms/hub.js';
import { WhiteboardHub } from './rooms/whiteboard.js';
import { InMemoryRoomStore, type RoomStore } from './world/store.js';
import { LiveKitAvProvider, type AvProvider, type LiveKitConfig } from './av/livekit.js';
import { internalRoutes } from './internal.js';

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
  /** Self-hosted LiveKit credentials (Phase 5); absent = AV disabled. */
  livekit?: LiveKitConfig;
  /** Test seam: inject a fake AV provider instead of signing real tokens. */
  av?: AvProvider;
  /** Shared secret for the API's server-to-server calls; absent = /internal off. */
  internalSecret?: string;
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
  const store = options.store ?? new InMemoryRoomStore();
  const av =
    options.av ?? (options.livekit ? new LiveKitAvProvider(options.livekit) : undefined);
  const hub = new RoomHub({
    store,
    knockTimeoutMs: options.knockTimeoutMs,
    av,
    logger: app.log,
  });
  const whiteboards = new WhiteboardHub(store, app.log);
  app.addHook('onClose', async () => whiteboards.stop());
  hub.start();
  app.addHook('onClose', async () => hub.stop());
  app.decorate('hub', hub);

  app.get('/health', () => ({ status: 'ok' }));

  // Server-to-server surface for apps/api (R3). Never exposed through Nginx.
  internalRoutes(app, { hub, ...(options.internalSecret ? { secret: options.internalSecret } : {}) });

  app.get('/ws', { websocket: true }, async (socket, req) => {
    // Buffer inbound frames across the auth round-trip: a client may send its
    // first message before the handler finishes awaiting, and an unlistened
    // 'message' event is gone for good. See withBufferedFrames.
    await withBufferedFrames(socket, async () => {
      const { token } = req.query as { token?: string };
      const user = token ? await verifyToken(token) : null;
      if (!user) {
        req.log.warn('ws rejected: missing or invalid token');
        socket.close(4401, 'unauthorized');
        return;
      }
      app.hub.connect(socket, user, req.log);
    });
  });

  // Shared whiteboard (Phase 6): tldraw sync protocol on its own endpoint.
  // Same JWT auth; members only (FR-ROOM-37 — "all members can draw").
  app.get('/whiteboard', { websocket: true }, async (socket, req) => {
    // The tldraw client sends `connect` the instant the socket opens — well
    // before the membership query below returns — so buffering is mandatory
    // here, not merely defensive.
    await withBufferedFrames(socket, async () => {
      const { token, roomId, sessionId } = req.query as {
        token?: string;
        roomId?: string;
        sessionId?: string;
      };
      const user = token ? await verifyToken(token) : null;
      if (!user || user.role !== 'student') {
        socket.close(4401, 'unauthorized');
        return;
      }
      if (!roomId || !(await store.isMember(roomId, user.userId))) {
        req.log.warn({ roomId, userId: user.userId }, 'whiteboard rejected: not a member');
        socket.close(4403, 'forbidden');
        return;
      }
      try {
        await whiteboards.connect(roomId, sessionId ?? `${user.userId}-${Date.now()}`, socket);
      } catch (err) {
        req.log.error({ err, roomId }, 'whiteboard connect failed');
        socket.close(1011, 'whiteboard unavailable');
      }
    });
  });

  return app;
}

/**
 * Runs WebSocket handler setup with inbound frames held back.
 *
 * A `ws` socket emits 'message' whether or not anyone is listening, and an
 * unheard event is lost — so any handler that awaits (JWT verification, a
 * membership query) before attaching its listener races the client's first
 * frame. `pause()` stops the underlying stream synchronously, so nothing is
 * read off the wire until setup has attached its listeners; `resume()` then
 * delivers everything in order. This cost the whiteboard its entire handshake:
 * the client's `connect` arrived during the membership query and vanished,
 * leaving tldraw spinning forever with no error on either side.
 */
async function withBufferedFrames(socket: WebSocket, setup: () => Promise<void>): Promise<void> {
  socket.pause();
  try {
    await setup();
  } finally {
    // Safe on an already-closed socket: ws ignores resume() when not open.
    socket.resume();
  }
}
