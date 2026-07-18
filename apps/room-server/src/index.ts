import { buildApp } from './app.js';

const port = Number(process.env.ROOM_SERVER_PORT ?? 4100);
const host = process.env.HOST ?? '0.0.0.0';

const app = await buildApp({
  pretty: process.env.NODE_ENV === 'development',
});

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
