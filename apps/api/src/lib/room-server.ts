import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './env.js';

// Server-to-server calls into the room server (R3).
//
// The room server is a separate process holding the authoritative live world,
// so a membership change made through the REST API is invisible to it: someone
// you just removed keeps walking around the map until they leave on their own.
// These two calls close that gap.
//
// Every call is best-effort. The database change has already been committed by
// the time we get here, and the live world is ephemeral — a failed push means a
// stale actor for a few seconds, not a wrong outcome. A failure must therefore
// never turn a successful removal into a 500 for the user.

const TIMEOUT_MS = 2_000;

export type EvictReason = 'removed' | 'roomDeleted';

/**
 * Who to walk out of a room's live map: named users (a removal), everyone but
 * the named users (a room turning private, which strips visitors), or the lot
 * (a deleted room).
 */
export type EvictTarget = { userIds: string[] } | { except: string[] } | 'all';

export interface RoomServerClient {
  evict(roomId: string, target: EvictTarget, reason: EvictReason): Promise<void>;
  /** A room's door slot, visibility or occupancy changed — refresh the plaques. */
  doorsChanged(): Promise<void>;
}

export function createRoomServerClient(env: Env, logger: FastifyBaseLogger): RoomServerClient {
  const secret = env.INTERNAL_API_SECRET;
  if (!secret) {
    logger.warn(
      'INTERNAL_API_SECRET is not set: live eviction is disabled. Removed members stay in the map until they leave.',
    );
    return { evict: async () => undefined, doorsChanged: async () => undefined };
  }

  async function post(path: string, body: unknown): Promise<void> {
    try {
      const res = await fetch(`${env.ROOM_SERVER_INTERNAL_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        logger.warn({ path, status: res.status }, 'room server rejected an internal call');
      }
    } catch (err: unknown) {
      // Room server down or restarting. Its own state is rebuilt from the
      // database on reconnect, so the world converges without us.
      logger.warn({ err, path }, 'room server unreachable for an internal call');
    }
  }

  return {
    evict: (roomId, target, reason) =>
      post('/internal/evict', {
        roomId,
        reason,
        ...(target === 'all' ? {} : target),
      }),
    doorsChanged: () => post('/internal/doors-changed', {}),
  };
}
