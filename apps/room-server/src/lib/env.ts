// Validated at boot, same pattern as apps/api. JWT_SECRET must match the API's
// so access tokens minted there verify here.
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ROOM_SERVER_PORT: z.coerce.number().int().default(4100),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  // Optional so the sandbox still runs without Postgres — but room instances,
  // doors and knocks need it; boot logs a loud warning when it is missing.
  DATABASE_URL: z.string().min(1).optional(),
  // Optional: without it AV stays off and the Phase 3 placeholder bubbles
  // remain. The key lives ONLY here — never in the api or the client.
  DAILY_API_KEY: z.string().min(1).optional(),
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
