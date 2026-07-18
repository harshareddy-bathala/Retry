// Validated at boot, same pattern as apps/api. JWT_SECRET must match the API's
// so access tokens minted there verify here.
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ROOM_SERVER_PORT: z.coerce.number().int().default(4100),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
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
