# PROGRESS.md — Foundry

> Living status tracker. Update in the same PR as the work. `ROADMAP.md` is the plan; this is reality. AI assistants: read this to know what exists before writing code that depends on it.

**Last updated:** 2026-07-03

## Current State

**Phase 0 — Foundations. Nothing is built yet.** Documentation and planning are complete; the monorepo has not been scaffolded.

## Phase Status

| Phase | Scope | Status |
|-------|-------|--------|
| Docs & planning | CLAUDE.md, SRS, all context docs, skills, roadmap | ✅ Complete (2026-07-03) |
| Phase 0 — Foundations (M1) | Scaffold, CI, auth, deploy skeleton | 🔲 Not started |
| Phase 1 — Posts & Profiles (M2) | Post CRUD, teams, profiles, Latest feed | 🔲 Not started |
| Phase 2 — Lineage, Social & Feed (M3) | Fork, CTE traversal, social, ranked feeds | 🔲 Not started |
| Phase 3 — Grading Pipeline (M4–5) | Submit → AI → faculty approval → release | 🔲 Not started |
| Phase 4 — Rooms: Workspace (M6–7) | WS server, context, blueprint, kanban, chat, journey | 🔲 Not started |
| Phase 5 — Rooms: Live Space (M8) | Phaser, proximity, Daily.co, tldraw | 🔲 Not started |
| Phase 6 — Idea Hub + Hardening (M9–10) | Ideas, FRs, alumni, perf/security pass, **P1 launch** | 🔲 Not started |
| Phase 7 — P2 + Pilot (M11–12) | Assignments, exports, follows, AI FRs, polish | 🔲 Not started |

## Phase 0 Checklist (current phase — next actions)

- [ ] pnpm workspace scaffold (`apps/web`, `apps/api`, `packages/db|types|config`)
- [ ] `packages/config`: shared eslint/prettier/tsconfig
- [ ] docker-compose: postgres15+pgvector, redis7, mailpit
- [ ] Drizzle wiring + `users`, `refresh_tokens` schema + first migration + seed script
- [ ] Fastify bootstrap: `app.ts`/`server.ts`, env validation (`lib/env.ts`), logger, Sentry, error handler
- [ ] Auth routes: register / verify-email / login / refresh / logout / forgot / reset / onboarding / me
- [ ] `requireAuth` + `requireRole` middleware + RBAC test skeleton
- [ ] Minimal admin: create-faculty, suspend-user
- [ ] React shell: Vite, router, nav, auth pages, api client, TanStack Query provider
- [ ] GitHub Actions: PR checks (lint/typecheck/test/migration/AI-grep) + staging deploy
- [ ] Droplet provisioned: Nginx + TLS + systemd units + staging subdomain
- [ ] **Exit demo:** teammate registers → verifies → onboards → empty feed on staging

## Requirement Ledger

P1 requirement checkboxes live per-phase; check them off as each lands. (Full IDs in `foundry_srs.md`.) Convention: a requirement is checked only when its `TESTING.md` coverage exists and it's been exercised on staging (see Definition of Done, `CONTRIBUTING.md` §7).

## Known Deviations from SRS

_None yet. Record any scope change here with a link to the `DECISIONS.md` entry._
