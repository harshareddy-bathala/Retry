import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/lib/env.js';

const REQUIRED = {
  DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
  JWT_SECRET: 's'.repeat(40),
} as const;

describe('loadEnv', () => {
  it('parses TTL strings into seconds (FR-AUTH-03)', () => {
    const env = loadEnv({ ...REQUIRED, ACCESS_TOKEN_TTL: '7d', REFRESH_TOKEN_TTL: '30d' });
    expect(env.ACCESS_TOKEN_TTL).toBe(7 * 86400);
    expect(env.REFRESH_TOKEN_TTL).toBe(30 * 86400);
  });

  it('refuses to start on a short JWT secret', () => {
    expect(() => loadEnv({ ...REQUIRED, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('refuses malformed TTLs', () => {
    expect(() => loadEnv({ ...REQUIRED, ACCESS_TOKEN_TTL: 'soon' })).toThrow(/TTL format/);
  });

  it('defaults the email domain to nttf.co.in (FR-AUTH-01)', () => {
    // Explicit undefined masks any value a developer's local .env sets.
    expect(loadEnv({ ...REQUIRED, ALLOWED_EMAIL_DOMAIN: undefined }).ALLOWED_EMAIL_DOMAIN).toBe(
      'nttf.co.in',
    );
  });
});
