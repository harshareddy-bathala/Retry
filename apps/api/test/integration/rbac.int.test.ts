// Table-driven RBAC matrix (TESTING.md §3.2). Grows a row per protected route
// as domains land — the table IS the spec.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@foundry/types';
import { buildTestApp, hasTestDb, type TestContext } from '../helpers.js';

type RbacCase = {
  route: string;
  method: 'GET' | 'POST';
  payload?: Record<string, unknown>;
  allowed: Role[];
};

const ONBOARDING_PAYLOAD = {
  name: 'T User',
  department: 'CSE',
  batchYear: '2023-2026',
  semester: 4,
};

const MATRIX: RbacCase[] = [
  { route: '/api/auth/me', method: 'GET', allowed: ['student', 'faculty', 'alumni', 'admin'] },
  {
    route: '/api/auth/onboarding',
    method: 'POST',
    payload: ONBOARDING_PAYLOAD,
    allowed: ['student'],
  },
];

const ALL_ROLES: Role[] = ['student', 'faculty', 'alumni', 'admin'];

describe.skipIf(!hasTestDb)('RBAC matrix', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx ??= await buildTestApp();
    await ctx.resetDb();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  describe.each(MATRIX)('$method $route', ({ route, method, payload, allowed }) => {
    it.each(ALL_ROLES)('%s', async (role) => {
      const { token } = await ctx.seedUser(role);
      const res = await ctx.app.inject({
        method,
        url: route,
        headers: { authorization: `Bearer ${token}` },
        ...(payload ? { payload } : {}),
      });
      if (allowed.includes(role)) {
        expect(res.statusCode).toBeLessThan(403);
      } else {
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe('FORBIDDEN');
      }
    });

    it('rejects missing token with UNAUTHENTICATED', async () => {
      const res = await ctx.app.inject({ method, url: route, ...(payload ? { payload } : {}) });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });
  });
});
