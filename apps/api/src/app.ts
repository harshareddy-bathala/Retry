import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Db } from '@foundry/db';
import type { Env } from './lib/env.js';
import { createJwt } from './lib/jwt.js';
import type { Mailer } from './lib/email.js';
import { buildLoggerOptions } from './lib/logger.js';
import { createAuthGuards } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { authRoutes } from './routes/auth.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { createAuthService } from './services/auth.service.js';

export type BuildAppDeps = {
  env: Env;
  db: Db;
  mailer: Mailer;
};

// All wiring happens here so tests can inject a test db + recording mailer
// and drive everything through app.inject() (TESTING.md).
export async function buildApp({ env, db, mailer }: BuildAppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions({
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      pretty: env.NODE_ENV === 'development',
    }),
    trustProxy: true,
  });

  await app.register(helmet);
  await app.register(cors, { origin: [env.WEB_BASE_URL], credentials: true });
  await app.register(cookie);
  // Redis store lands with the rooms phase; in-memory is fine for one process (ADR-003).
  await app.register(rateLimit, { global: false });

  app.decorateRequest('auth', null);
  registerErrorHandler(app);

  const jwt = createJwt({
    secret: env.JWT_SECRET,
    previousSecret: env.JWT_SECRET_PREVIOUS,
    ttlSeconds: env.ACCESS_TOKEN_TTL,
  });
  const guards = createAuthGuards(jwt);
  const authService = createAuthService({ db, env, jwt, mailer, logger: app.log });

  await app.register(
    async (api) => {
      healthRoutes(api, { db });
      authRoutes(api, { service: authService, guards, env });
    },
    { prefix: '/api' },
  );

  return app;
}
