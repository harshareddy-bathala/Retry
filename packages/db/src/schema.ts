// Phase 0 tables only: users + auth token tables. The rest of DATABASE.md lands
// with its own phase (posts/lineage in Phase 1, etc.) so migrations stay reviewable.
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['student', 'faculty', 'alumni', 'admin']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: userRole('role').notNull().default('student'),
  department: text('department'),
  batchYear: text('batch_year'),
  semester: integer('semester'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  // null = inactive account (FR-AUTH-02)
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // FR-AUTH-04: set once the onboarding form is submitted
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  isSuspended: boolean('is_suspended').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Opaque refresh tokens, hashed at rest, rotated on every use (SECURITY.md §1).
// family_id groups a rotation chain: reuse of a rotated token revokes the family.
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId), index('refresh_tokens_family_idx').on(t.familyId)],
);

export const emailTokenPurpose = pgEnum('email_token_purpose', ['verify_email', 'reset_password']);

// Single-use, 1 h TTL, hashed at rest (SECURITY.md §1) — verification + reset links.
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: emailTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_tokens_user_idx').on(t.userId)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type EmailTokenRow = typeof emailTokens.$inferSelect;
