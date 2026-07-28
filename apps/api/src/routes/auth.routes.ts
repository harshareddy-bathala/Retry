import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  forgotPasswordSchema,
  loginSchema,
  onboardingSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@retry/types';
import { AppError } from '../lib/errors.js';
import type { Env } from '../lib/env.js';
import type { AuthGuards } from '../plugins/auth.js';
import type { AuthService } from '../services/auth.service.js';

const REFRESH_COOKIE = 'retry_refresh';

// Refresh token rides an httpOnly cookie scoped to the auth routes — never
// readable by JS, never in localStorage (SECURITY.md §1).
function setRefreshCookie(reply: FastifyReply, env: Env, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL,
  });
}

function readRefreshCookie(request: FastifyRequest): string {
  const token = request.cookies[REFRESH_COOKIE];
  if (!token) throw new AppError('UNAUTHENTICATED', 401, 'No refresh token.');
  return token;
}

export function authRoutes(
  app: FastifyInstance,
  deps: { service: AuthService; guards: AuthGuards; env: Env },
): void {
  const { service, guards, env } = deps;
  // Auth endpoints are the brute-force surface: 5/min/IP in production
  // (SECURITY.md §5).
  //
  // Off under test — integration suites share one app instance and the
  // in-memory counter would 429 legitimate fixtures mid-file — and loosened in
  // development, where the only client is localhost and the browser drive
  // registers a fresh student per test. At nine tests the drive queued behind
  // its own limit and reported it as "a phone-sized viewport gets a broken
  // canvas", which is a lie about the product caused by a defence that is
  // defending nothing: an attacker who can reach a dev API on 127.0.0.1 has
  // already won.
  //
  // Production is unchanged, and is the only place the number matters.
  const registerLimit = { max: env.NODE_ENV === 'development' ? 100 : 5, timeWindow: '1 minute' };
  const authRateLimit = {
    rateLimit: env.NODE_ENV === 'test' ? false : registerLimit,
  };

  app.post('/auth/register', { config: authRateLimit }, async (request, reply) => {
    await service.register(registerSchema.parse(request.body));
    return reply.status(201).send({ message: 'Check your college email for the verification link.' });
  });

  app.get('/auth/verify-email', async (request, reply) => {
    const { token } = verifyEmailSchema.parse(request.query);
    await service.verifyEmail(token);
    return reply.send({ message: 'Email verified. You can log in now.' });
  });

  app.post('/auth/login', { config: authRateLimit }, async (request, reply) => {
    const { accessToken, refreshToken, user } = await service.login(loginSchema.parse(request.body));
    setRefreshCookie(reply, env, refreshToken);
    return reply.send({ accessToken, user });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const presented = readRefreshCookie(request);
    const { accessToken, refreshToken, user } = await service.refresh(presented);
    setRefreshCookie(reply, env, refreshToken);
    return reply.send({ accessToken, user });
  });

  app.post('/auth/logout', { preHandler: [guards.requireAuth] }, async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE];
    if (presented) await service.logout(presented);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return reply.status(204).send();
  });

  app.post('/auth/forgot-password', { config: authRateLimit }, async (request, reply) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    await service.forgotPassword(email);
    // Always 200 — response must not reveal whether the email exists
    return reply.send({ message: 'If that account exists, a reset link is on its way.' });
  });

  app.post('/auth/reset-password', { config: authRateLimit }, async (request, reply) => {
    await service.resetPassword(resetPasswordSchema.parse(request.body));
    return reply.send({ message: 'Password updated. Log in with the new one.' });
  });

  app.post(
    '/auth/onboarding',
    { preHandler: [guards.requireRole(['student'])] },
    async (request, reply) => {
      // preHandler guarantees auth is set
      if (!request.auth) throw new AppError('UNAUTHENTICATED', 401, 'Missing access token.');
      const user = await service.completeOnboarding(
        request.auth.sub,
        onboardingSchema.parse(request.body),
      );
      return reply.send({ user });
    },
  );

  app.get('/auth/me', { preHandler: [guards.requireAuth] }, async (request, reply) => {
    if (!request.auth) throw new AppError('UNAUTHENTICATED', 401, 'Missing access token.');
    const user = await service.getMe(request.auth.sub);
    return reply.send({ user });
  });
}
