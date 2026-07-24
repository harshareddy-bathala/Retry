import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { chatHistoryQuerySchema, createRoomSchema } from '@foundry/types';
import { AppError } from '../lib/errors.js';
import type { AuthGuards } from '../plugins/auth.js';
import type { RoomsService } from '../services/rooms.service.js';

const roomIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

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

  // Chat history (Phase 6): member-only, 50/page, ?before= scroll-up cursor.
  app.get('/rooms/:id/messages', studentOnly, async (request, reply) => {
    if (!request.auth) throw new AppError('UNAUTHENTICATED', 401, 'Missing access token.');
    const { id } = roomIdParamsSchema.parse(request.params);
    const { before } = chatHistoryQuerySchema.parse(request.query);
    return reply.send(await service.listMessages(id, request.auth.sub, before));
  });

  // Member roster for the presence panel (live status comes from the WS actors).
  app.get('/rooms/:id/members', studentOnly, async (request, reply) => {
    if (!request.auth) throw new AppError('UNAUTHENTICATED', 401, 'Missing access token.');
    const { id } = roomIdParamsSchema.parse(request.params);
    return reply.send(await service.listMembers(id, request.auth.sub));
  });
}
