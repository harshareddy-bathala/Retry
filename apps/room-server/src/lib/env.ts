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
  // Self-hosted LiveKit. All three must be present together; with any of them
  // missing AV stays off and the Phase 3 placeholder bubbles remain — that is
  // the supported state until a LiveKit VPS exists. The API secret lives ONLY
  // here, never in apps/api and never in the client.
  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(1).optional(),
  LIVEKIT_API_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export type LiveKitEnv = { url: string; apiKey: string; apiSecret: string };

/** LiveKit config only when fully specified — a half-configured AV is worse than none. */
export function livekitConfig(env: Env): LiveKitEnv | undefined {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return undefined;
  return { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET };
}

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}
