/* eslint-disable no-console -- seed is a CLI script, not production code */
// Bootstrap seed: creates the admin account from env (FR-AUTH-05 — privileged
// accounts are never self-registered). Demo data seeding lands with Phase 1.
import 'dotenv/config';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { createDb } from './index.js';
import { users } from './schema.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // 19 MiB — OWASP default (SECURITY.md §1)
  timeCost: 2,
  parallelism: 1,
} as const;

async function main() {
  const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD are required');
  }

  const { db, pool } = createDb({ connectionString: DATABASE_URL });
  try {
    const existing = await db.query.users.findFirst({ where: eq(users.email, ADMIN_EMAIL) });
    if (existing) {
      console.log(`admin ${ADMIN_EMAIL} already exists — nothing to do`);
      return;
    }
    const passwordHash = await argon2.hash(ADMIN_PASSWORD, ARGON2_OPTIONS);
    await db.insert(users).values({
      email: ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      name: 'Administrator',
      role: 'admin',
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
    });
    console.log(`admin ${ADMIN_EMAIL} created`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
