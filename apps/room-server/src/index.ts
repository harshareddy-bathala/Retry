import { loadEnv } from './lib/env.js';
import { buildApp } from './app.js';

const env = loadEnv();

const app = await buildApp({
  jwtSecret: env.JWT_SECRET,
  pretty: env.NODE_ENV === 'development',
});

try {
  await app.listen({ port: env.ROOM_SERVER_PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
