import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { buildLoggerOptions } from './lib/logger.js';
import { createTokenVerifier } from './lib/auth.js';
import { RoomHub } from './rooms/hub.js';

declare module 'fastify' {
  interface FastifyInstance {
    hub: RoomHub;
  }
}

export type BuildAppOptions = {
  jwtSecret: string;
  logLevel?: string;
  pretty?: boolean;
};

// Rooms Phase 2 server: authenticated WebSocket endpoint backed by RoomHub.
// Auth is a JWT in the connection query string (rooms build plan Phase 2);
// unauthenticated sockets are closed with 4401 before touching the hub.
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions({ level: options.logLevel, pretty: options.pretty }),
  });

  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  const verifyToken = createTokenVerifier(options.jwtSecret);
  app.decorate('hub', new RoomHub());

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
