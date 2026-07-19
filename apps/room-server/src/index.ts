import { loadEnv } from './lib/env.js';
import { buildApp } from './app.js';
import { DrizzleRoomStore } from './world/drizzle-store.js';

const env = loadEnv();

const store = env.DATABASE_URL ? new DrizzleRoomStore(env.DATABASE_URL) : undefined;

const app = await buildApp({
  jwtSecret: env.JWT_SECRET,
  pretty: env.NODE_ENV === 'development',
  store,
});

if (!store) {
  app.log.warn(
    'DATABASE_URL is not set — running with an empty in-memory room store; only the static maps (commons, studio_a) will work',
  );
}

app.addHook('onClose', async () => {
  if (store instanceof DrizzleRoomStore) await store.close();
});

try {
  await app.listen({ port: env.ROOM_SERVER_PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
