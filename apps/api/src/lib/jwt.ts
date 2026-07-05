import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Role } from '@foundry/types';
import { AppError } from './errors.js';

export type AccessTokenClaims = {
  sub: string; // user id
  role: Role;
};

const encoder = new TextEncoder();

export function createJwt(config: { secret: string; previousSecret: string; ttlSeconds: number }) {
  const current = encoder.encode(config.secret);
  // Dual-key rotation (SECURITY.md §4): verify accepts the previous secret too.
  const previous = config.previousSecret ? encoder.encode(config.previousSecret) : null;

  return {
    async sign(claims: AccessTokenClaims): Promise<string> {
      return new SignJWT({ role: claims.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.sub)
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + config.ttlSeconds)
        .sign(current);
    },

    async verify(token: string): Promise<AccessTokenClaims> {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, current));
      } catch (primaryError) {
        if (!previous) throw toAuthError(primaryError);
        try {
          ({ payload } = await jwtVerify(token, previous));
        } catch {
          throw toAuthError(primaryError);
        }
      }
      if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
        throw new AppError('TOKEN_INVALID', 401, 'Malformed token');
      }
      return { sub: payload.sub, role: payload.role as Role };
    },
  };
}

function toAuthError(err: unknown): AppError {
  const isExpired = err instanceof Error && err.name === 'JWTExpired';
  return isExpired
    ? new AppError('TOKEN_EXPIRED', 401, 'Access token expired')
    : new AppError('TOKEN_INVALID', 401, 'Invalid access token');
}

export type Jwt = ReturnType<typeof createJwt>;
