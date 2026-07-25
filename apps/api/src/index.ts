import { createDb } from '@retry/db';
import { buildApp } from './app.js';
import { createSmtpMailer } from './lib/email.js';
import { loadEnv } from './lib/env.js';

const env = loadEnv();
const { db, pool } = createDb({
  connectionString: env.DATABASE_URL,
  poolMax: env.DATABASE_POOL_MAX,
});

const app = await buildApp({ env, db, mailer: createSmtpMailer(env) });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
