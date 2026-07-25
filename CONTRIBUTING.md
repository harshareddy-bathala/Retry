# CONTRIBUTING.md — Retry

> Team workflow for the 5-member Retry team. Optimised for parallel work without stepping on each other, with `main` always deployable.

---

## 1. Local Setup

Prereqs: Node 20 LTS, pnpm 9, Docker Desktop (for local Postgres + Redis).

```bash
git clone <repo-url> && cd retry
pnpm install
cp .env.example .env            # fill in local values
docker compose up -d            # postgres:15 + pgvector, redis:7
pnpm --filter db migrate
pnpm --filter db seed           # SEED_DEMO_DATA=true for fake posts/users
pnpm dev                        # runs web (5173) + api (3000) concurrently
```

Worker and tldraw sync run separately when needed: `pnpm --filter api worker`, `pnpm tldraw-sync`.

## 2. Branching

- `main` — protected. Always green, always deployable. No direct pushes.
- Feature branches off `main`: `<type>/<domain>-<short-desc>` → `feat/rooms-kanban-board`, `fix/grading-timeout-state`, `docs/api-ideas`.
- Branches live ≤1 week. Bigger features are split into stacked, individually-mergeable PRs (schema → service → routes → UI is the usual split).
- No long-lived `develop` branch — 5 people don't need GitFlow.

## 3. Pull Requests

- PR title = Conventional Commit format (it becomes the squash commit).
- **Squash-merge only.** Branch history is yours; `main` history is linear.
- Template checklist:
  - [ ] Zod validation on any new route
  - [ ] `requireRole()` on any protected route
  - [ ] New/changed endpoints reflected in `API.md`; WS events in `WEBSOCKET_EVENTS.md`; schema in `DATABASE.md`
  - [ ] Tests for service-layer logic (see `TESTING.md`)
  - [ ] No `any`, no `console.log`, no secrets
- **1 approving review required.** Domain owners (below) review their domain. Review within 24h — unblock teammates first, do your own work second.
- CI must pass: lint, typecheck, unit + integration tests, AI-boundary grep (fails the build if `@anthropic-ai/sdk` is imported outside `grading.worker.ts`).

## 4. Domain Ownership (review routing, not exclusivity)

| Domain | Owner |
|---|---|
| Auth, users, admin, RBAC | member 1 |
| Posts, lineage, feed, Idea Hub | member 2 |
| Grading pipeline, worker, rubrics, faculty panel | member 3 |
| Rooms: WS server, Workspace, Kanban, chat | member 4 |
| Live Space: Phaser, proximity, Daily.co, tldraw | member 5 |

(Fill in real names; everyone reads everything — ownership means "default reviewer + keeps that doc updated".)

## 5. Database Changes

1. Edit `packages/db/src/schema.ts`
2. `pnpm --filter db generate` — review the generated SQL by hand
3. Update `DATABASE.md` in the same PR
4. Never edit a migration that has been merged; write a new one
5. Migrations run in CI against a scratch DB to prove they apply cleanly

## 6. Issue Tracking

GitHub Issues + a single Project board (columns: Backlog / This Sprint / In Progress / Review / Done). Every PR links an issue. Requirement-scoped issues carry the SRS ID in the title: `[FR-ROOM-17] Build Journey auto-entries`.

Sprints are 2 weeks, aligned to the phase plan in `ROADMAP.md`. Sprint planning = 30 min, Monday; pick from the current phase only.

## 7. Definition of Done

A feature is done when: code merged, tests pass, docs updated, deployed to the droplet, and **manually exercised once in the deployed environment** (not just localhost). For P1 features, the relevant SRS requirement is checked off in `PROGRESS.md`.
