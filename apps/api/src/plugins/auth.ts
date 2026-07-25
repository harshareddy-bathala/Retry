import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@retry/types';
import { AppError } from '../lib/errors.js';
import type { AccessTokenClaims, Jwt } from '../lib/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AccessTokenClaims | null;
  }
}

// Hard Rule 6: RBAC lives here and only here. Routes compose these as preHandlers;
// services never look at roles.
export function createAuthGuards(jwt: Jwt) {
  async function authenticate(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHENTICATED', 401, 'Missing access token.');
    }
    request.auth = await jwt.verify(header.slice('Bearer '.length));
  }

  function requireRole(roles: readonly Role[]) {
    return async function requireRoleHandler(
      request: FastifyRequest,
      _reply: FastifyReply,
    ): Promise<void> {
      await authenticate(request);
      // request.auth is set by authenticate or it threw
      if (!request.auth || !roles.includes(request.auth.role)) {
        throw new AppError('FORBIDDEN', 403, 'Your role cannot access this resource.');
      }
    };
  }

  return {
    authenticate,
    requireRole,
    // `✱ = any authenticated` rows in API.md
    requireAuth: requireRole(['student', 'faculty', 'alumni', 'admin']),
  };
}

export type AuthGuards = ReturnType<typeof createAuthGuards>;
