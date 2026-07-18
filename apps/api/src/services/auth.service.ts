import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { emailTokens, refreshTokens, users, type Db, type UserRow } from '@foundry/db';
import type {
  AuthUser,
  LoginInput,
  OnboardingInput,
  RegisterInput,
  ResetPasswordInput,
} from '@foundry/types';
import type { FastifyBaseLogger } from 'fastify';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  isCommonPassword,
  verifyPassword,
} from '../lib/crypto.js';
import { passwordResetEmail, verificationEmail, type Mailer } from '../lib/email.js';
import { AppError } from '../lib/errors.js';
import type { Env } from '../lib/env.js';
import type { Jwt } from '../lib/jwt.js';

const EMAIL_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 h (SECURITY.md §1)

export type AuthServiceDeps = {
  db: Db;
  env: Env;
  jwt: Jwt;
  mailer: Mailer;
  logger: FastifyBaseLogger;
};

export function createAuthService({ db, env, jwt, mailer, logger }: AuthServiceDeps) {
  async function issueEmailToken(userId: string, purpose: 'verify_email' | 'reset_password') {
    const { token, hash } = generateOpaqueToken();
    await db.insert(emailTokens).values({
      userId,
      purpose,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
    });
    return token;
  }

  async function issueRefreshToken(userId: string, familyId: string = randomUUID()) {
    const { token, hash } = generateOpaqueToken();
    await db.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000),
    });
    return token;
  }

  async function issueSession(user: UserRow) {
    const accessToken = await jwt.sign({ sub: user.id, role: user.role });
    const refreshToken = await issueRefreshToken(user.id);
    return { accessToken, refreshToken, user: toAuthUser(user) };
  }

  return {
    // FR-AUTH-01/02: domain-restricted signup; account inactive until the link is clicked.
    // ALLOWED_EMAIL_DOMAIN='*' disables the restriction — local dev only, never staging/prod.
    async register(input: RegisterInput): Promise<void> {
      const domain = input.email.split('@')[1];
      if (env.ALLOWED_EMAIL_DOMAIN !== '*' && domain !== env.ALLOWED_EMAIL_DOMAIN) {
        throw new AppError(
          'EMAIL_DOMAIN_NOT_ALLOWED',
          400,
          `Registration requires a @${env.ALLOWED_EMAIL_DOMAIN} college email.`,
        );
      }
      if (isCommonPassword(input.password)) {
        throw new AppError('PASSWORD_TOO_WEAK', 400, 'That password is too common. Pick another.');
      }
      const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });
      if (existing) {
        throw new AppError('EMAIL_ALREADY_REGISTERED', 409, 'An account with this email exists.');
      }

      const passwordHash = await hashPassword(input.password);
      const [user] = await db
        .insert(users)
        .values({ email: input.email, passwordHash, name: input.name })
        .returning();
      if (!user) throw new AppError('INTERNAL_ERROR', 500, 'Registration failed.');

      const token = await issueEmailToken(user.id, 'verify_email');
      await mailer.send({ to: user.email, ...verificationEmail(env.WEB_BASE_URL, token) });
      logger.info({ userId: user.id }, 'user registered, verification email sent');
    },

    async verifyEmail(token: string): Promise<void> {
      const row = await db.query.emailTokens.findFirst({
        where: and(eq(emailTokens.tokenHash, hashOpaqueToken(token)), isNull(emailTokens.usedAt)),
      });
      if (!row || row.purpose !== 'verify_email') {
        throw new AppError('TOKEN_INVALID', 400, 'Invalid verification link.');
      }
      if (row.expiresAt < new Date()) {
        throw new AppError('TOKEN_EXPIRED', 400, 'Verification link expired. Register again.');
      }
      await db.transaction(async (tx) => {
        await tx.update(emailTokens).set({ usedAt: new Date() }).where(eq(emailTokens.id, row.id));
        await tx
          .update(users)
          .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, row.userId));
      });
      logger.info({ userId: row.userId }, 'email verified');
    },

    async login(input: LoginInput) {
      const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
      // Same error for unknown email and wrong password — no account enumeration.
      if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
        throw new AppError('INVALID_CREDENTIALS', 401, 'Email or password is incorrect.');
      }
      if (user.isSuspended) {
        throw new AppError('ACCOUNT_SUSPENDED', 403, 'This account is suspended. Contact admin.');
      }
      if (!user.emailVerifiedAt) {
        throw new AppError('EMAIL_NOT_VERIFIED', 403, 'Verify your college email first.');
      }
      logger.info({ userId: user.id }, 'login');
      return issueSession(user);
    },

    // Rotation per SECURITY.md §1: every use rotates; reuse of a rotated token
    // means theft — revoke the whole family.
    async refresh(presentedToken: string) {
      const row = await db.query.refreshTokens.findFirst({
        where: eq(refreshTokens.tokenHash, hashOpaqueToken(presentedToken)),
      });
      if (!row) throw new AppError('TOKEN_INVALID', 401, 'Unknown refresh token.');

      if (row.revokedAt) {
        await db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
        logger.warn({ userId: row.userId, familyId: row.familyId }, 'refresh token reuse — family revoked');
        throw new AppError('TOKEN_INVALID', 401, 'Refresh token reused. Log in again.');
      }
      if (row.expiresAt < new Date()) {
        throw new AppError('TOKEN_EXPIRED', 401, 'Refresh token expired. Log in again.');
      }

      const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
      if (!user || user.isSuspended) {
        throw new AppError('TOKEN_INVALID', 401, 'Account unavailable.');
      }

      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.id, row.id));
      const accessToken = await jwt.sign({ sub: user.id, role: user.role });
      const refreshToken = await issueRefreshToken(user.id, row.familyId);
      return { accessToken, refreshToken, user: toAuthUser(user) };
    },

    async logout(presentedToken: string): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, hashOpaqueToken(presentedToken)));
    },

    // FR-AUTH-08. Always succeeds from the caller's view — no account enumeration.
    async forgotPassword(email: string): Promise<void> {
      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (!user) return;
      const token = await issueEmailToken(user.id, 'reset_password');
      await mailer.send({ to: user.email, ...passwordResetEmail(env.WEB_BASE_URL, token) });
      logger.info({ userId: user.id }, 'password reset email sent');
    },

    async resetPassword(input: ResetPasswordInput): Promise<void> {
      if (isCommonPassword(input.password)) {
        throw new AppError('PASSWORD_TOO_WEAK', 400, 'That password is too common. Pick another.');
      }
      const row = await db.query.emailTokens.findFirst({
        where: and(
          eq(emailTokens.tokenHash, hashOpaqueToken(input.token)),
          isNull(emailTokens.usedAt),
        ),
      });
      if (!row || row.purpose !== 'reset_password') {
        throw new AppError('TOKEN_INVALID', 400, 'Invalid reset link.');
      }
      if (row.expiresAt < new Date()) {
        throw new AppError('TOKEN_EXPIRED', 400, 'Reset link expired. Request a new one.');
      }
      const passwordHash = await hashPassword(input.password);
      await db.transaction(async (tx) => {
        await tx.update(emailTokens).set({ usedAt: new Date() }).where(eq(emailTokens.id, row.id));
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, row.userId));
        // Credential change invalidates every session (SECURITY.md §7 revocation sweep).
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
      });
      logger.info({ userId: row.userId }, 'password reset');
    },

    // FR-AUTH-04: first-login profile completion, students only (enforced at route).
    async completeOnboarding(userId: string, input: OnboardingInput): Promise<AuthUser> {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!user) throw new AppError('NOT_FOUND', 404, 'User not found.');
      if (user.onboardingCompletedAt) {
        throw new AppError('ONBOARDING_ALREADY_COMPLETE', 409, 'Onboarding already completed.');
      }
      const [updated] = await db
        .update(users)
        .set({
          name: input.name,
          department: input.department,
          batchYear: input.batchYear,
          semester: input.semester,
          bio: input.bio ?? null,
          onboardingCompletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) throw new AppError('INTERNAL_ERROR', 500, 'Onboarding failed.');
      return toAuthUser(updated);
    },

    async getMe(userId: string): Promise<AuthUser> {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!user) throw new AppError('NOT_FOUND', 404, 'User not found.');
      return toAuthUser(user);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    department: user.department,
    batchYear: user.batchYear,
    semester: user.semester,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    onboardingComplete: user.onboardingCompletedAt !== null,
  };
}
