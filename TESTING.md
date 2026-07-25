# TESTING.md — Retry

> Vitest for unit + integration, Playwright for E2E. Tests are risk-weighted: the grading pipeline and post state machine get depth; UI polish gets smoke coverage.

---

## 1. Stack

| Layer | Tool | Where |
|---|---|---|
| Unit | Vitest | colocated `*.test.ts` next to source |
| API integration | Vitest + Fastify `app.inject()` + real Postgres/Redis in Docker | `apps/api/src/**/*.int.test.ts` |
| Frontend component | Vitest + Testing Library (jsdom) | colocated `*.test.tsx` |
| E2E | Playwright (Chromium) | `apps/web/e2e/` |

Run: `pnpm test` (unit), `pnpm test:int` (spins up docker compose test services on separate ports), `pnpm test:e2e`.

## 2. Principles

- **Test services, not routes, for logic.** Routes get one happy-path + one auth-failure integration test each; the branching logic lives in services and is tested there.
- **Real database in integration tests.** Never mock Drizzle. Each test file gets a truncated schema (fast `TRUNCATE ... CASCADE` between tests). Mocking the DB tests your mocks.
- **Mock only true externals:** Anthropic API, Daily.co, GitHub clone, SMTP. Each has a fake in `apps/api/src/test/fakes/`. The Anthropic fake returns a canned structured grade.
- Zod schemas don't need direct tests — they're exercised via route integration tests.
- No snapshot tests except WS event payload shapes.

## 3. What Must Be Covered (non-negotiable)

These are the highest-risk behaviors; each has a named test file:

1. **Post state machine** (`posts.service.test.ts`) — every legal transition, every illegal transition rejected with 409, `frozen_demo_url` written exactly once on first submit and preserved through withdraw (FR-POST-05), edit-lock while submitted.
2. **RBAC matrix** (`rbac.int.test.ts`) — table-driven: every protected route × every role → expected 200/403. A student must never reach faculty endpoints (NFR-SEC-05); alumni must not fork/claim/create posts; faculty must not create posts or access rooms.
3. **Grading pipeline** (`grading.worker.int.test.ts`) — with repo / without repo (FR-GRADE-11), timeout → failure state + faculty notification, retry/backoff behavior, grade stays `pending` and invisible to students until approval, audit trail immutability after approval.
4. **Lineage traversal** (`lineage.test.ts`) — ancestors + descendants with depth on a seeded 4-generation tree, fork immutability of `parent_post_id`, cycle impossibility.
5. **Fork flow** — mandatory rationale ≥50 chars, prefill correctness, fork_count increments transactionally.
6. **Similarity flag** — seeded embeddings where similarity ≥0.85 sets the plagiarism flag.
7. **Room protocol** (`room.ws.int.test.ts`) — ws client pair: membership rejection (4403), presence join/leave + 30s heartbeat timeout, kanban event round-trip persistence, proximity enter/leave at threshold boundaries (distances 5 vs 6), chat persistence.
8. **One-level comment nesting** — reply-to-reply rejected.
9. **Idea claim race** — two concurrent claims → exactly one succeeds (409 for the loser).

## 4. E2E (Playwright) — critical journeys only

1. Register → verify email (Mailpit in dev) → onboard → create post → publish → appears in Latest feed
2. Fork a post with rationale → lineage shows parent/child
3. Submit for grading → (faked AI) → faculty approves → student sees grade badge + notification
4. Create room → invite → accept → kanban card moves sync across two browser contexts
5. Idea Hub: post idea → claim → publish linked post → idea shows Built

Run headless in CI on every PR to `main`; full suite nightly.

## 5. CI Gates (GitHub Actions, every PR)

1. `pnpm lint` + `pnpm typecheck`
2. Unit + integration tests (Postgres+pgvector and Redis as service containers)
3. Migration apply check against a scratch DB
4. AI-boundary grep: `@anthropic-ai/sdk` imported outside `grading.worker.ts` → fail
5. `console.log` grep in `apps/` source → fail
6. E2E on PRs labelled `e2e` and on every merge to `main`

Coverage: no hard global threshold; **services must be ≥80% branch coverage** (enforced per-directory in vitest config). Chasing 100% on UI glue is wasted student-time.
