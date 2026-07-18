import { jwtVerify } from 'jose';

export type AuthedUser = { userId: string; role: string };

export type TokenVerifier = (token: string) => Promise<AuthedUser | null>;

// Verifies access tokens minted by apps/api (HS256, sub = user id, role claim).
// Returns null instead of throwing — an unauthenticated socket is closed with
// code 4401, never crashed.
export function createTokenVerifier(secret: string): TokenVerifier {
  const key = new TextEncoder().encode(secret);
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
      return {
        userId: payload.sub,
        role: typeof payload.role === 'string' ? payload.role : 'student',
      };
    } catch {
      return null;
    }
  };
}
