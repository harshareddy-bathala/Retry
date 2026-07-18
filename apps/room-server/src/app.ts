import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { parseClientMessage, type SnapshotMessage } from '@foundry/protocol';
import { buildLoggerOptions } from './lib/logger.js';

declare module 'fastify' {
  interface FastifyInstance {
    // Open sockets, so tests (and later, shutdown) can prove nothing leaks.
    liveConnections: Set<WebSocket>;
  }
}

export type BuildAppOptions = {
  logLevel?: string;
  pretty?: boolean;
};

// Phase 0 health-check server: accepts a WebSocket connection, sends a
// snapshot with zero actors, validates (and ignores) inbound messages, and
// cleans up on close. Registries, auth, and broadcast arrive in Phase 2.
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions({ level: options.logLevel, pretty: options.pretty }),
  });

  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  app.decorate('liveConnections', new Set<WebSocket>());

  app.get('/health', () => ({ status: 'ok' }));

  app.get('/ws', { websocket: true }, (socket, req) => {
    app.liveConnections.add(socket);
    req.log.info('ws connected');

    const snapshot: SnapshotMessage = { t: 'snapshot', mapId: 'studio_a', actors: [] };
    socket.send(JSON.stringify(snapshot));

    socket.on('message', (data: Buffer) => {
      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) {
        // Contract: drop with a logged warning, never crash the connection.
        req.log.warn({ reason: parsed.error }, 'dropped unparseable ws message');
        return;
      }
      req.log.debug({ t: parsed.message.t }, 'ws message ignored (no gameplay in phase 0)');
    });

    socket.on('close', () => {
      app.liveConnections.delete(socket);
      req.log.info('ws disconnected');
    });

    socket.on('error', (err: Error) => {
      req.log.warn({ err }, 'ws connection error');
    });
  });

  return app;
}
