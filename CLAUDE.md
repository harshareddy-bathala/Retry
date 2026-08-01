# CLAUDE.md — Retry AI Context File

> Read this file completely before writing any code, suggesting any architecture, or answering any question about this codebase. This is the authoritative source of truth. Do not hallucinate dependencies, patterns, or conventions that are not listed here.

---

## What is Retry

Retry is a college project archival, collaboration, and evaluation platform for engineering students at NTTF NEC Bangalore. It is a final year project built by a 5-member team over 12 months.

Students post projects throughout their academics. Projects form a lineage (fork graph). Faculty grade using AI assistance with human approval. Teams collaborate in project-aware Collaboration Rooms. An Idea Hub surfaces unbuilt ideas and feature requests.

Full problem statement: `retry_problem_and_solution.md`
Full requirements: `retry_srs.md`

---

## Monorepo Structure

```
retry/
├── apps/
│   ├── web/                  # React frontend (Vite)
│   ├── api/                  # Fastify REST API + BullMQ workers          :4000
│   ├── room-server/          # The live world: /ws + /whiteboard          :4100
│   └── e2e/                  # Playwright drive + WS load scripts (not in CI)
├── packages/
│   ├── db/                   # Drizzle schema, migrations, seed
│   ├── protocol/             # THE WIRE CONTRACT — Zod schemas for every WS event
│   ├── maps/                 # Tiled maps, the licensed-art pipeline, the map validator
│   ├── types/                # Shared REST/DTO types (no runtime code)
│   └── config/               # Shared ESLint, Prettier, TS configs
├── .claude/
│   └── skills/               # Claude skill files per domain
├── .github/
│   └── workflows/            # CI/CD pipelines
├── CLAUDE.md                 # ← you are here
├── TECH_STACK.md
├── ARCHITECTURE.md
├── DATABASE.md
├── API.md
├── WEBSOCKET_EVENTS.md
├── CONVENTIONS.md
├── CONTRIBUTING.md
├── TESTING.md
├── DEPLOYMENT.md
├── SECURITY.md
├── DECISIONS.md
├── PROGRESS.md
├── ROADMAP.md
├── CHANGELOG.md
└── .env.example
```

---

## Tech Stack — Quick Reference

Read `TECH_STACK.md` for versions and reasons. Summary:

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TanStack Query v5, React Router v6 |
| UI | Tailwind CSS v4, Radix Dialog + Tooltip, lucide-react. **No animation library** |
| Backend | Fastify v4, TypeScript, Zod |
| ORM | Drizzle ORM |
| Database | PostgreSQL 15 + pgvector extension |
| Cache / Queue | Redis 7, BullMQ — **queue and feed cache only, never rooms** |
| Room server | `apps/room-server` — a **separate** Fastify + `ws` process on :4100 |
| Whiteboard | tldraw v2 sync server (inside the room server) |
| AI | Anthropic API — claude-sonnet-4-6 — **grading worker only** |
| Video | Self-hosted LiveKit SFU (ADR-012). Not yet provisioned |
| Canvas | Phaser.js 3 |
| Auth | JWT (access 7d, refresh 30d) — jose library |
| Infra | DigitalOcean Droplet, Managed PostgreSQL, Nginx |
| Monitoring | New Relic (infra + APM), Sentry (error tracking) |

---

## Hard Rules — Never Violate

1. **Never use `any` in TypeScript.** Use `unknown` and narrow, or define a proper type.
2. **Never call the Anthropic API outside `apps/api/src/workers/grading.worker.ts`.** AI is confined to the grading pipeline. Zero AI calls in route handlers, room server, or frontend.
3. **Never put secrets in code.** All secrets come from environment variables. See `.env.example`.
4. **Every Fastify route must validate input with Zod.** No raw `request.body` access without a schema.
5. **Never return raw database errors to the client.** Catch, log to Sentry, return a typed error response.
6. **RBAC is enforced at the middleware layer.** Never check roles inside business logic or route handlers. Use the `requireRole()` middleware.
7. **Every database query goes through Drizzle.** No raw SQL except for recursive CTE lineage queries and pgvector similarity queries — those two are the only exceptions, and they live in `packages/db/src/queries/`.
8. **No direct DOM manipulation in React.** Use refs only where absolutely necessary (Phaser canvas mount, tldraw container).
9. **WebSocket events must match the Zod schemas in `packages/protocol/src/events.ts` exactly.** No ad-hoc event names, and no locally redefined message shapes — both the client and the room server import from `@retry/protocol` only. `WEBSOCKET_EVENTS.md` documents that contract; the schema is what enforces it.
10. **No `console.log` in production code.** Use the logger (`apps/api/src/lib/logger.ts`). Frontend errors go to Sentry.

---

## User Roles

| Role | Value in DB | Can do |
|------|-------------|--------|
| Student | `student` | Create posts, rooms, fork, grade-view own grades |
| Faculty | `faculty` | All student reads + rubrics + grading panel + assignments |
| Alumni | `alumni` | Read-only feed + comment + Idea Hub open ideas |
| Admin | `admin` | Account management only — no grading or post creation |

Role is enforced via the `requireRole(roles[])` Fastify middleware in every protected route.

---

## Post Status State Machine

```
Draft → Published → Submitted → Graded
```

- Draft ↔ Published: student can toggle freely
- Published → Submitted: explicit student action; locks editing; copies `demo_url` → `frozen_demo_url`
- Submitted → Graded: faculty approval action only
- Submitted → Draft: withdraw action (student); `frozen_demo_url` preserved

---

## Room Architecture (Critical)

Rooms have two views, on two routes, sharing one WebSocket protocol:
- **Workspace** (`/rooms/:id`): Blueprint, Build Journey, Kanban. Room metadata over REST; live content over a `watch`-mode socket — no avatar, no proximity, no AV. This is also the accessible, canvas-free path.
- **Live Space** (`/world?map=`): Phaser 2D canvas + server-side proximity + LiveKit audio/video + tldraw whiteboard. Full-bleed, outside `AppShell`, desktop only (≥1024 px, fine pointer).

The map is a **Tiled tilemap** (`packages/maps/maps/*.json`), loaded by both the client (rendering) and the room server (collision, spawns, interactables) — the two can never disagree about where a wall is. There is no procedural map generation; the JSON is the source of truth.

No attendance or session timestamps are stored. Live presence is a single mutable cell (`room_members.presence_seen_at`), never an append-only history. A room with no stored content (empty blueprint, empty kanban, empty chat) is never auto-deleted — only the owner can delete a room.

Rooms have zero FK relationship to posts. They are fully independent entities.

---

## AI Usage — Exactly Where and How

AI (Anthropic API) is called in exactly one place: `apps/api/src/workers/grading.worker.ts`.

The worker:
1. Dequeues a BullMQ job from the `grading` queue
2. Clones the GitHub repo (if URL provided)
3. Runs Tree-sitter AST analysis
4. Runs pgvector similarity query against lineage ancestors
5. Calls Anthropic API with rubric + code signals + similarity data
6. Stores structured JSON grade as `pending` in `grades` table
7. Notifies faculty via the notifications system

The AI never grades autonomously. Every grade requires explicit faculty approval before release to students.

---

## What Has Not Been Built Yet

Check `PROGRESS.md` for the current state — and trust the prose there over the phase table, which lags.

The one thing worth knowing up front: **AV runs locally but has never met a real network.** `docker compose up -d` starts a LiveKit dev server and `apps/e2e/tests/av.spec.ts` drives proximity subscription, screen share and the pre-join check against it. What is still unproven is the part local dev cannot prove — TURN on TCP/443, which ADR-012 flags as mandatory on Indian campus and mobile networks. `docs/livekit-vps.md` is the runbook.

---

## Key Files to Read for Each Domain

| Task | Files to read |
|------|--------------|
| Working on any route | `ARCHITECTURE.md`, `API.md`, `CONVENTIONS.md` |
| Database changes | `DATABASE.md`, `packages/db/src/schema.ts` |
| Room server / any WS event | `packages/protocol/src/events.ts` (authoritative), `WEBSOCKET_EVENTS.md`, `ARCHITECTURE.md` |
| Room UI / the HUD | `docs/rooms-hud.md`, `apps/web/src/features/rooms/hud/`, `input/input-layers.ts` |
| Maps and world art | `docs/authoring-maps.md`, `docs/assets-setup.md`, `packages/maps/README.md` |
| AI grading | `retry_srs.md` §4.6, `apps/api/src/workers/grading.worker.ts` |
| Frontend component | `CONVENTIONS.md`, `.claude/skills/skill-frontend.md` |
| Writing a test | `TESTING.md`, `.claude/skills/skill-testing.md` |