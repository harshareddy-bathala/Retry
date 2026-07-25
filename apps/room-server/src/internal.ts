import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RoomHub } from './rooms/hub.js';

// Server-to-server surface for the API process (R3).
//
// The API owns membership; the room server owns the live world. When the API
// removes someone from a room, nothing in the world knows — they keep walking
// around a room they are no longer in. These routes are how that change
// reaches the map, over the private network only, behind a shared secret.
//
// Deliberately NOT the JWT surface: no user is acting here, and these calls
// must work regardless of who is signed in.

const evictBodySchema = z
  .object({
    roomId: z.string().uuid(),
    reason: z.enum(['removed', 'roomDeleted']),
    /** Named users to remove. Omit (with `except`) to mean "everyone else". */
    userIds: z.array(z.string().uuid()).min(1).optional(),
    /** Users to spare — a room turning private keeps its members, drops visitors. */
    except: z.array(z.string().uuid()).optional(),
  })
  .strict();

export type InternalRoutesDeps = {
  hub: RoomHub;
  /** Absent = the internal API is not mounted at all. */
  secret?: string;
};

export function internalRoutes(app: FastifyInstance, deps: InternalRoutesDeps): void {
  const { hub } = deps;
  const secret: string | undefined = deps.secret;
  if (secret === undefined) {
    app.log.warn(
      'INTERNAL_API_SECRET is not set: /internal is disabled. Removed members will stay in a room until they leave it.',
    );
    return;
  }
  const expected = secret;

  function authorize(request: FastifyRequest): boolean {
    const header = request.headers['x-internal-secret'];
    if (typeof header !== 'string') return false;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on a length mismatch, which is itself a leak of
    // one bit; comparing lengths first and short-circuiting is equivalent and
    // safe, since length is not the secret.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  app.post('/internal/evict', async (request, reply) => {
    if (!authorize(request)) return reply.status(401).send({ error: 'unauthorized' });
    const parsed = evictBodySchema.safeParse(request.body);
    if (!parsed.success) {
      // Only our own API calls this, so a bad body is our bug: say so plainly
      // in the logs rather than surfacing a 500 with a stack trace.
      request.log.error({ issues: parsed.error.issues }, 'malformed internal evict call');
      return reply.status(400).send({ error: 'invalid body' });
    }
    const body = parsed.data;
    const evicted = await hub.evict(
      body.roomId,
      { ...(body.userIds ? { userIds: body.userIds } : {}), ...(body.except ? { except: body.except } : {}) },
      body.reason,
    );
    return reply.send({ evicted });
  });

  app.post('/internal/doors-changed', async (request, reply) => {
    if (!authorize(request)) return reply.status(401).send({ error: 'unauthorized' });
    await hub.refreshDoors();
    return reply.send({ ok: true });
  });
}
