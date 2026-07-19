import type { FastifyInstance } from 'fastify';
import { createRoomSchema } from '@foundry/types';
import { AppError } from '../lib/errors.js';
import type { AuthGuards } from '../plugins/auth.js';
import type { RoomsService } from '../services/rooms.service.js';

// Rooms are a student feature (SRS §3.2/§3.3: faculty and alumni are rejected
// from all rooms) — RBAC enforced here via requireRole, never in the service.
export function roomsRoutes(
  app: FastifyInstance,
  deps: { service: RoomsService; guards: AuthGuards },
): void {
  const { service, guards } = deps;
  const studentOnly = { preHandler: [guards.requireRole(['student'])] };

  app.post('/rooms', studentOnly, async (request, reply) => {
    if (!request.auth) throw new AppError('UNAUTHENTICATED', 401, 'Missing access token.');
    const room = await service.createRoom(request.auth.sub, createRoomSchema.parse(request.body));
    return reply.status(201).send({ room });
  });

  app.get('/rooms', studentOnly, async (request, reply) => {
    if (!request.auth) throw new AppError('UNAUTHENTICATED', 401, 'Missing access token.');
    return reply.send(await service.listRooms(request.auth.sub));
  });
}
