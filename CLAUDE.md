# CLAUDE.md — Foundry AI Context File

> Read this file completely before writing any code, suggesting any architecture, or answering any question about this codebase. This is the authoritative source of truth. Do not hallucinate dependencies, patterns, or conventions that are not listed here.

---

## What is Foundry

Foundry is a college project archival, collaboration, and evaluation platform for engineering students at NTTF NEC Bangalore. It is a final year project built by a 5-member team over 12 months.

Students post projects throughout their academics. Projects form a lineage (fork graph). Faculty grade using AI assistance with human approval. Teams collaborate in project-aware Collaboration Rooms. An Idea Hub surfaces unbuilt ideas and feature requests.

Full problem statement: `foundry_problem_and_solution.md`
Full requirements: `foundry_srs.md`

---

## Monorepo Structure

```
foundry/
├── apps/
│   ├── web/                  # React frontend (Vite)
│   └── api/                  # Fastify backend (API + Room server + Workers)
├── packages/
│   ├── db/                   # Drizzle schema, migrations, seed
│   ├── types/                # Shared TypeScript types (no runtime code)
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
| UI | Tailwind CSS v4, Radix UI primitives, Framer Motion |
| Backend | Fastify v4, TypeScript, Zod |
| ORM | Drizzle ORM |
| Database | PostgreSQL 15 + pgvector extension |
| Cache / Queue | Redis 7, BullMQ |
| Room server | Fastify WebSocket plugin (ws) |
| Whiteboard | tldraw v2 sync server (self-hosted) |
| AI | Anthropic API — claude-sonnet-4-6 — **grading worker only** |
| Video | Daily.co API (WebRTC) |
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
9. **WebSocket events must match the schema in `WEBSOCKET_EVENTS.md` exactly.** No ad-hoc event names.
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

Rooms have two views:
- **Workspace** (default on entry): Blueprint, Build Journey, Kanban — loaded from PostgreSQL via REST
- **Live Space** (on demand): Phaser.js 2D canvas + Daily.co proximity video + tldraw whiteboard — loaded on user action

No attendance or session timestamps are stored. Live presence is ephemeral WebSocket state only. A room with no stored content (empty blueprint, empty kanban, empty chat) is never auto-deleted — only the owner can delete a room.

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

Check `PROGRESS.md` for the current state. As of project start, nothing is built. Start with Phase 1 from `ROADMAP.md`.

---

## Key Files to Read for Each Domain

| Task | Files to read |
|------|--------------|
| Working on any route | `ARCHITECTURE.md`, `API.md`, `CONVENTIONS.md` |
| Database changes | `DATABASE.md`, `packages/db/src/schema.ts` |
| Room server | `WEBSOCKET_EVENTS.md`, `ARCHITECTURE.md` |
| AI grading | `foundry_srs.md` §4.6, `apps/api/src/workers/grading.worker.ts` |
| Frontend component | `CONVENTIONS.md`, `.claude/skills/skill-frontend.md` |
| Writing a test | `TESTING.md`, `.claude/skills/skill-testing.md` |