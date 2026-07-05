import { describe, expect, it } from 'vitest';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  isCommonPassword,
  verifyPassword,
} from '../../src/lib/crypto.js';

describe('password hashing', () => {
  it('verifies the original password and rejects others', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'correct-horse-battery')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong-horse-battery')).resolves.toBe(false);
  });
});

describe('common password list', () => {
  it('flags known-common passwords case-insensitively', () => {
    expect(isCommonPassword('Password123')).toBe(true);
    expect(isCommonPassword('qwertyuiop')).toBe(true);
    expect(isCommonPassword('drop-forge-anvil-42')).toBe(false);
  });
});

describe('opaque tokens', () => {
  it('stores only the sha256, and the hash is reproducible from the token', () => {
    const { token, hash } = generateOpaqueToken();
    expect(token).not.toEqual(hash);
    expect(hashOpaqueToken(token)).toEqual(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never repeats tokens', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateOpaqueToken().token));
    expect(seen.size).toBe(50);
  });
});
