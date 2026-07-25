// Shared test harness per TESTING.md / skill-testing.md:
// real Postgres for integration tests, fakes only for true externals (mailer).
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createDb, users, type Db } from '@retry/db';
import type { Role } from '@retry/types';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/lib/crypto.js';
import type { Mailer } from '../src/lib/email.js';
import { loadEnv, type Env } from '../src/lib/env.js';
import { createJwt } from '../src/lib/jwt.js';

export const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST ?? '';
// Integration suites: describe.skipIf(!hasTestDb)(...) — CI always sets DATABASE_URL_TEST.
export const hasTestDb = TEST_DATABASE_URL.length > 0;

export type SentMail = { to: string; subject: string; text: string };

export function createFakeMailer(): Mailer & { sent: SentMail[] } {
  const sent: SentMail[] = [];
  return {
    sent,
    async send(mail) {
      sent.push(mail);
    },
  };
}

export function testEnv(): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    ALLOWED_EMAIL_DOMAIN: 'nttf.co.in',
  });
}

export type TestContext = {
  app: FastifyInstance;
  db: Db;
  env: Env;
  mailer: ReturnType<typeof createFakeMailer>;
  seedUser: (role?: Role, overrides?: { verified?: boolean }) => Promise<{ id: string; email: string; token: string }>;
  resetDb: () => Promise<void>;
  close: () => Promise<void>;
};

let seedCounter = 0;

export async function buildTestApp(): Promise<TestContext> {
  const env = testEnv();
  const { db, pool } = createDb({ connectionString: TEST_DATABASE_URL, poolMax: 5 });
  const mailer = createFakeMailer();
  const app = await buildApp({ env, db, mailer });
  const jwt = createJwt({
    secret: env.JWT_SECRET,
    previousSecret: '',
    ttlSeconds: env.ACCESS_TOKEN_TTL,
  });

  return {
    app,
    db,
    env,
    mailer,
    async seedUser(role: Role = 'student', overrides = {}) {
      seedCounter += 1;
      const email = `user${seedCounter}@nttf.co.in`;
      const [user] = await db
        .insert(users)
        .values({
          email,
          passwordHash: await hashPassword('correct-horse-battery'),
          name: `Test ${role} ${seedCounter}`,
          role,
          emailVerifiedAt: (overrides.verified ?? true) ? new Date() : null,
        })
        .returning();
      if (!user) throw new Error('seedUser failed');
      return { id: user.id, email, token: await jwt.sign({ sub: user.id, role }) };
    },
    async resetDb() {
      await db.execute(sql`TRUNCATE TABLE users, refresh_tokens, email_tokens RESTART IDENTITY CASCADE`);
    },
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

export function extractLinkToken(text: string): string {
  const match = text.match(/[?&]token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`no token link in email body: ${text}`);
  return match[1];
}
