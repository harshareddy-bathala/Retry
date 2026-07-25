// Full auth journey against a real Postgres (TESTING.md: never mock the DB).
// Requires DATABASE_URL_TEST with migrations applied; skipped locally without it.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, extractLinkToken, hasTestDb, type TestContext } from '../helpers.js';

describe.skipIf(!hasTestDb)('auth flow', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx ??= await buildTestApp();
    await ctx.resetDb();
    ctx.mailer.sent.length = 0;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const register = (body: Record<string, unknown>) =>
    ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: body });

  const GOOD_REGISTRATION = {
    email: 'tn1234@nttf.co.in',
    password: 'drop-forge-anvil-42',
    name: 'Harsha',
  };

  it('register → verify → login → me (FR-AUTH-01/02/03)', async () => {
    const reg = await register(GOOD_REGISTRATION);
    expect(reg.statusCode).toBe(201);
    expect(ctx.mailer.sent).toHaveLength(1);

    // Account inactive until the link is clicked
    const early = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: GOOD_REGISTRATION.email, password: GOOD_REGISTRATION.password },
    });
    expect(early.statusCode).toBe(403);
    expect(early.json().error.code).toBe('EMAIL_NOT_VERIFIED');

    const token = extractLinkToken(ctx.mailer.sent[0]!.text);
    const verify = await ctx.app.inject({
      method: 'GET',
      url: `/api/auth/verify-email?token=${token}`,
    });
    expect(verify.statusCode).toBe(200);

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: GOOD_REGISTRATION.email, password: GOOD_REGISTRATION.password },
    });
    expect(login.statusCode).toBe(200);
    const { accessToken, user } = login.json();
    expect(user.role).toBe('student');
    expect(user.onboardingComplete).toBe(false);
    expect(login.cookies.find((c) => c.name === 'retry_refresh')?.httpOnly).toBe(true);

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(GOOD_REGISTRATION.email);
  });

  it('rejects non-college domains with EMAIL_DOMAIN_NOT_ALLOWED (FR-AUTH-01)', async () => {
    const res = await register({ ...GOOD_REGISTRATION, email: 'someone@gmail.com' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  });

  it('rejects duplicate registration with EMAIL_ALREADY_REGISTERED', async () => {
    await register(GOOD_REGISTRATION);
    const res = await register(GOOD_REGISTRATION);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects common passwords with PASSWORD_TOO_WEAK', async () => {
    const res = await register({ ...GOOD_REGISTRATION, password: 'password123' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PASSWORD_TOO_WEAK');
  });

  it('returns the same INVALID_CREDENTIALS for unknown email and wrong password', async () => {
    await ctx.seedUser('student');
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ghost@nttf.co.in', password: 'whatever-goes' },
    });
    const wrongPw = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user1@nttf.co.in', password: 'wrong-password-1' },
    });
    for (const res of [unknown, wrongPw]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('rotates refresh tokens and revokes the family on reuse (SECURITY.md §1)', async () => {
    await register(GOOD_REGISTRATION);
    const token = extractLinkToken(ctx.mailer.sent[0]!.text);
    await ctx.app.inject({ method: 'GET', url: `/api/auth/verify-email?token=${token}` });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: GOOD_REGISTRATION.email, password: GOOD_REGISTRATION.password },
    });
    const cookie1 = login.cookies.find((c) => c.name === 'retry_refresh')!.value;

    const refresh1 = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { retry_refresh: cookie1 },
    });
    expect(refresh1.statusCode).toBe(200);
    const cookie2 = refresh1.cookies.find((c) => c.name === 'retry_refresh')!.value;
    expect(cookie2).not.toBe(cookie1);

    // Reusing the rotated token is theft — whole family dies
    const reuse = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { retry_refresh: cookie1 },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('TOKEN_INVALID');

    const afterRevoke = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { retry_refresh: cookie2 },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it('completes onboarding once, then 409s (FR-AUTH-04)', async () => {
    const { token } = await ctx.seedUser('student');
    const payload = {
      name: 'Harsha N',
      department: 'CSE',
      batchYear: '2023-2026',
      semester: 6,
      bio: 'building small tools',
    };
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/onboarding',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().user.onboardingComplete).toBe(true);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/onboarding',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ONBOARDING_ALREADY_COMPLETE');
  });

  it('resets password via emailed link and revokes existing sessions (FR-AUTH-08)', async () => {
    await register(GOOD_REGISTRATION);
    const verifyToken = extractLinkToken(ctx.mailer.sent[0]!.text);
    await ctx.app.inject({ method: 'GET', url: `/api/auth/verify-email?token=${verifyToken}` });

    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: GOOD_REGISTRATION.email },
    });
    expect(ctx.mailer.sent).toHaveLength(2);
    const resetToken = extractLinkToken(ctx.mailer.sent[1]!.text);

    const reset = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: resetToken, password: 'brand-new-secret-99' },
    });
    expect(reset.statusCode).toBe(200);

    // Single-use: second attempt fails
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: resetToken, password: 'other-new-secret-99' },
    });
    expect(again.json().error.code).toBe('TOKEN_INVALID');

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: GOOD_REGISTRATION.email, password: 'brand-new-secret-99' },
    });
    expect(login.statusCode).toBe(200);
  });
});
