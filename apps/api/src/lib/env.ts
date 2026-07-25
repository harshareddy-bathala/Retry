// Validated at boot — the app refuses to start on a missing/invalid value (.env.example).
import 'dotenv/config';
import { z } from 'zod';

const ttlSchema = z
  .string()
  .regex(/^\d+[smhd]$/, 'TTL format: <number><s|m|h|d>')
  .transform((ttl) => {
    const unit = ttl.slice(-1);
    const value = Number(ttl.slice(0, -1));
    const seconds = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
    if (!seconds) throw new Error(`unreachable: bad TTL unit ${unit}`);
    return value * seconds;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),
  WEB_BASE_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_SECRET_PREVIOUS: z.string().optional().default(''),
  ACCESS_TOKEN_TTL: ttlSchema.default('7d'), // FR-AUTH-03
  REFRESH_TOKEN_TTL: ttlSchema.default('30d'),
  // FR-AUTH-01; '*' disables the domain check (local dev only)
  ALLOWED_EMAIL_DOMAIN: z.string().min(1).default('nttf.co.in'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().default('Retry <retry@nttf.co.in>'),

  SENTRY_DSN_API: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}
