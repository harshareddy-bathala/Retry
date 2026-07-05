import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';

// OWASP defaults (SECURITY.md §1)
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// Small common-password list (SECURITY.md §1). Checked case-insensitively after
// the min-length rule, so only ≥10-char offenders need to be here.
const COMMON_PASSWORDS = new Set([
  'password123',
  'password1234',
  'qwertyuiop',
  '1234567890',
  'iloveyou123',
  'welcome123',
  'admin12345',
  'letmein123',
  'sunshine123',
  'football123',
  'qwerty12345',
  'passw0rd123',
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

// Opaque tokens (refresh, email verify/reset): random value goes to the user,
// only the sha256 lands in the DB (SECURITY.md §1 "hashed at rest").
export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
