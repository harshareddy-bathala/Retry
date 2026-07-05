# Skill: Writing Tests

Use when writing any test. Full strategy in `TESTING.md`; this is the how-to.

## Where tests live

| Kind | Location | Runner |
|---|---|---|
| Unit | `*.test.ts` next to source | `pnpm test` |
| API integration | `apps/api/src/**/*.int.test.ts` | `pnpm test:int` (needs docker compose test services) |
| Component | `*.test.tsx` next to component | `pnpm test` |
| E2E | `apps/web/e2e/*.spec.ts` | `pnpm test:e2e` |

## API integration test pattern

```ts
import { buildApp } from '../app';           // full Fastify app, no listen()
import { resetDb, seedUser } from '../test/helpers';

beforeEach(() => resetDb());                  // TRUNCATE ... CASCADE, fast

it('locks editing when submitted', async () => {
  const { token, post } = await seedSubmittedPost();
  const res = await app.inject({
    method: 'PATCH', url: `/api/posts/${post.id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { title: 'new title' },
  });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.code).toBe('POST_NOT_EDITABLE');
});
```

- Real Postgres + Redis; **never mock Drizzle or the DB**
- Mock only externals via fakes in `apps/api/src/test/fakes/`: Anthropic (canned structured grade), Daily (records calls), GitHub clone (fixture repo dir), SMTP (captures messages)
- Test helpers own auth: `seedUser(role)` returns `{ user, token }` — don't hand-build JWTs in tests
- Assert on error **codes**, not messages (messages may be reworded)

## Table-driven RBAC (the pattern for every protected route)

```ts
const cases = [
  ['student',  403], ['faculty', 200], ['alumni', 403], ['admin', 403],
] as const;
it.each(cases)('GET /faculty/queue as %s → %s', async (role, expected) => {
  const { token } = await seedUser(role);
  const res = await app.inject({ method: 'GET', url: '/api/faculty/queue',
    headers: { authorization: `Bearer ${token}` } });
  expect(res.statusCode).toBe(expected);
});
```

New protected route ⇒ new rows in `rbac.int.test.ts`. No exceptions.

## WS integration pattern

Connect two real `ws` clients through the ticket flow, act on one, assert the broadcast on the other, then assert persistence via REST. Always test the negative: non-member close `4403`, heartbeat-timeout presence clear, boundary proximity (5 tiles in, 6 tiles out).

## What NOT to write

- Route tests re-asserting Zod validation shape by shape (one 400 case is enough — the schema is the spec)
- Snapshot tests (except WS payload shapes)
- Component tests for pure layout — Testing Library tests assert behavior (click → mutation called), not markup
- E2E outside the 5 critical journeys in `TESTING.md` §4 — E2E minutes are expensive; integration tests are where breadth lives
