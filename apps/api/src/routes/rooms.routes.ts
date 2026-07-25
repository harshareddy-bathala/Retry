import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  chatHistoryQuerySchema,
  createInviteSchema,
  createRoomSchema,
  transferOwnershipSchema,
  updateRoomSchema,
} from '@retry/types';
import { AppError } from '../lib/errors.js';
import type { AuthGuards } from '../plugins/auth.js';
import type { RoomsService } from '../services/rooms.service.js';

const roomIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
const memberParamsSchema = z
  .object({ id: z.string().uuid(), userId: z.string().uuid() })
  .strict();
const inviteParamsSchema = z.object({ id: z.string().uuid() }).strict();

// Rooms are a student feature (SRS §3.2/§3.3: faculty and alumni are rejected
// from all rooms) — RBAC enforced here via requireRole, never in the service.
// Room *ownership* is not RBAC: it is a per-row fact, checked in the service.
export function roomsRoutes(
  app: FastifyInstance,
  deps: { service: RoomsService; guards: AuthGuards },
): void {
  const { service, guards } = deps;
  const studentOnly = { preHandler: [guards.requireRole(['student'])] };

  // Every handler needs the caller; Fastify types `auth` as nullable because
  // unauthenticated routes share the decorator.
  function sub(request: { auth: { sub: string } | null }): string {
    if (!request.auth) throw new AppError('UNAUTHENTICATED', 401, 'Missing access token.');
    return request.auth.sub;
  }

  app.post('/rooms', studentOnly, async (request, reply) => {
    const room = await service.createRoom(sub(request), createRoomSchema.parse(request.body));
    return reply.status(201).send({ room });
  });

  app.get('/rooms', studentOnly, async (request, reply) => {
    return reply.send(await service.listRooms(sub(request)));
  });

  app.get('/rooms/:id', studentOnly, async (request, reply) => {
    const { id } = roomIdParamsSchema.parse(request.params);
    return reply.send(await service.getRoom(id, sub(request)));
  });

  // Rename / describe / flip visibility (FR-ROOM-03) — owner only.
  app.patch('/rooms/:id', studentOnly, async (request, reply) => {
    const { id } = roomIdParamsSchema.parse(request.params);
    const input = updateRoomSchema.parse(request.body);
    return reply.send(await service.updateRoom(id, sub(request), input));
  });

  // Deletes the chat, board and whiteboard with it (FR-ROOM-36). The client
  // confirms by name before calling this; there is no undo.
  app.delete('/rooms/:id', studentOnly, async (request, reply) => {
    const { id } = roomIdParamsSchema.parse(request.params);
    await service.deleteRoom(id, sub(request));
    return reply.status(204).send();
  });

  // Chat history (Phase 6): member-only, 50/page, ?before= scroll-up cursor.
  app.get('/rooms/:id/messages', studentOnly, async (request, reply) => {
    const { id } = roomIdParamsSchema.parse(request.params);
    const { before } = chatHistoryQuerySchema.parse(request.query);
    return reply.send(await service.listMessages(id, sub(request), before));
  });

  // Member roster for the presence panel (live status comes from the WS actors).
  app.get('/rooms/:id/members', studentOnly, async (request, reply) => {
    const { id } = roomIdParamsSchema.parse(request.params);
    return reply.send(await service.listMembers(id, sub(request)));
  });

  // Removing yourself is "leave"; removing someone else needs ownership
  // (FR-ROOM-05). The service tells them apart.
  app.delete('/rooms/:id/members/:userId', studentOnly, async (request, reply) => {
    const { id, userId } = memberParamsSchema.parse(request.params);
    await service.removeMember(id, sub(request), userId);
    return reply.status(204).send();
  });

  app.post('/rooms/:id/transfer', studentOnly, async (request, reply) => {
    const { id } = roomIdParamsSchema.parse(request.params);
    const { userId } = transferOwnershipSchema.parse(request.body);
    await service.transferOwnership(id, sub(request), userId);
    return reply.status(204).send();
  });

  app.post('/rooms/:id/invites', studentOnly, async (request, reply) => {
    const { id } = roomIdParamsSchema.parse(request.params);
    const input = createInviteSchema.parse(request.body);
    return reply.status(201).send(await service.createInvite(id, sub(request), input));
  });

  // Invites are addressed to a person, not a room: they are listed and
  // answered outside any room's scope, and a decline is never reported back.
  app.get('/invites', studentOnly, async (request, reply) => {
    return reply.send(await service.listInvites(sub(request)));
  });

  app.post('/invites/:id/accept', studentOnly, async (request, reply) => {
    const { id } = inviteParamsSchema.parse(request.params);
    return reply.send(await service.respondToInvite(id, sub(request), 'accept'));
  });

  app.post('/invites/:id/decline', studentOnly, async (request, reply) => {
    const { id } = inviteParamsSchema.parse(request.params);
    await service.respondToInvite(id, sub(request), 'decline');
    return reply.status(204).send();
  });

  // The notification feed is not room-scoped and not student-only: posts and
  // grading will write to it for every role.
  app.get('/notifications', { preHandler: [guards.requireAuth] }, async (request, reply) => {
    return reply.send(await service.listNotifications(sub(request)));
  });

  app.post('/notifications/read', { preHandler: [guards.requireAuth] }, async (request, reply) => {
    await service.markNotificationsRead(sub(request));
    return reply.status(204).send();
  });
}
