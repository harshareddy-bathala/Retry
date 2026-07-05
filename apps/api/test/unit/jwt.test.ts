import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import { createJwt } from '../../src/lib/jwt.js';

const SECRET_A = 'a'.repeat(40);
const SECRET_B = 'b'.repeat(40);

describe('jwt', () => {
  it('round-trips sub and role claims', async () => {
    const jwt = createJwt({ secret: SECRET_A, previousSecret: '', ttlSeconds: 60 });
    const token = await jwt.sign({ sub: 'user-1', role: 'faculty' });
    await expect(jwt.verify(token)).resolves.toEqual({ sub: 'user-1', role: 'faculty' });
  });

  it('rejects an expired token with TOKEN_EXPIRED', async () => {
    const jwt = createJwt({ secret: SECRET_A, previousSecret: '', ttlSeconds: -10 });
    const token = await jwt.sign({ sub: 'user-1', role: 'student' });
    await expect(jwt.verify(token)).rejects.toMatchObject(
      new AppError('TOKEN_EXPIRED', 401, 'Access token expired'),
    );
  });

  it('rejects a token signed with an unknown secret with TOKEN_INVALID', async () => {
    const signer = createJwt({ secret: SECRET_B, previousSecret: '', ttlSeconds: 60 });
    const verifier = createJwt({ secret: SECRET_A, previousSecret: '', ttlSeconds: 60 });
    const token = await signer.sign({ sub: 'user-1', role: 'student' });
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('accepts tokens signed with the previous secret during rotation (SECURITY.md §4)', async () => {
    const old = createJwt({ secret: SECRET_A, previousSecret: '', ttlSeconds: 60 });
    const rotated = createJwt({ secret: SECRET_B, previousSecret: SECRET_A, ttlSeconds: 60 });
    const token = await old.sign({ sub: 'user-1', role: 'admin' });
    await expect(rotated.verify(token)).resolves.toEqual({ sub: 'user-1', role: 'admin' });
  });
});
