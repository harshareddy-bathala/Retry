# TECH_STACK.md — Retry

> Authoritative list of every technology in the project, its pinned major version, and why it was chosen. If a library is not on this list, do not introduce it without adding an entry here and a rationale in `DECISIONS.md`.

---

## Runtime & Tooling

| Technology | Version | Why |
|------------|---------|-----|
| Node.js | 20 LTS | Long-term support through the full 12-month build; native `fetch`, stable `--watch`. |
| TypeScript | 5.x (strict) | `strict: true` everywhere. `any` is banned (see CLAUDE.md Hard Rule 1). |
| pnpm | 9.x | Workspace-native monorepo package manager. Fast, disk-efficient, strict node_modules prevents phantom dependencies. **All scripts and docs assume pnpm — do not use npm or yarn.** |

## Frontend (`apps/web`)

| Technology | Version | Why |
|------------|---------|-----|
| React | 18.x | Team familiarity, ecosystem, concurrent rendering for the feed. |
| Vite | 5.x | Fast dev server, native TS, first-class Vitest integration. |
| React Router | v6 | SPA routing; data routers not required — TanStack Query owns data. |
| TanStack Query | v5 | All server state. No Redux. Cache invalidation matches REST resource boundaries. |
| Tailwind CSS | v4 | Utility-first; no CSS files per component. **There is no `tailwind.config`** — v4 takes tokens from `@theme inline` in `apps/web/src/styles/theme.css`. |
| Radix UI | latest | **Dialog and Tooltip only.** Taken for the focus trap, `aria-modal` and focus restore — the parts that hand-rolling gets subtly wrong. Everything else is hand-written. |
| lucide-react | latest | The icon set. Tree-shaken, takes `currentColor`. Replaced emoji-as-iconography, which rendered differently on every OS. |
| Phaser.js | 3.x | Live Space 2D canvas: tilemap, avatars, movement. Mounted via a single ref (allowed exception to the no-DOM rule). |
| tldraw | v2 | Shared whiteboard. Self-hosted sync server, state persisted as JSON in PostgreSQL. |
| React Flow | 11.x | Lineage DAG visualiser (nodes = post cards, edges = forks). Chosen over D3 — declarative, React-native. |
| react-markdown + remark-gfm | latest | Markdown rendering for post descriptions and comments. Sanitised via `rehype-sanitize`. |
| Sentry (browser SDK) | latest | Frontend error tracking. No `console.log` — errors go to Sentry. |

## Backend (`apps/api`)

| Technology | Version | Why |
|------------|---------|-----|
| Fastify | v4 | Fast, schema-first, TypeScript-friendly. Plugins for CORS, JWT, WebSocket, rate-limit. |
| Zod | 3.x | Every route input validated (Hard Rule 4). Schemas shared with frontend via `packages/types`. |
| Drizzle ORM | latest | All queries (Hard Rule 7). SQL-like, fully typed, migrations via drizzle-kit. |
| jose | 5.x | JWT signing/verification. Access 7d, refresh 30d (FR-AUTH-03). |
| BullMQ | 5.x | Grading job queue on Redis. 3 retries, exponential backoff 1/5/15 min (NFR-SCALE-01). |
| @fastify/websocket (ws) | latest | The room server (`apps/room-server`, a **separate process** on :4100): presence, avatar positions, chat, Kanban, Blueprint sync, tldraw sync. |
| livekit-server-sdk | 2.x | Local JWT minting for the SFU. No REST round-trip, so no third-party outage sits in the room-entry path. |
| Tree-sitter (node bindings) | latest | AST analysis in the grading worker: function length, complexity, comment ratio. |
| @anthropic-ai/sdk | latest | **Grading worker only** (`apps/api/src/workers/grading.worker.ts`). Model: `claude-sonnet-4-6`. Hard Rule 2. |
| LiveKit (self-hosted SFU) | 2.x | WebRTC audio/video (ADR-012, replacing Daily.co). One room per map; the client subscribes per-publication by proximity zone. **Not yet provisioned.** |
| Nodemailer | 6.x | Email via college SMTP (TLS): verification, password reset, grade release, deadline reminders. |
| Pino | (bundled with Fastify) | Structured logging via `apps/api/src/lib/logger.ts`. Hard Rule 10. |
| Sentry (node SDK) | latest | Backend error tracking. All caught DB/route errors report here (Hard Rule 5). |

## Data Layer (`packages/db`)

| Technology | Version | Why |
|------------|---------|-----|
| PostgreSQL | 15 (DO Managed) | Relational core + recursive CTEs for lineage DAG + JSONB for grades/whiteboard/blueprint history. |
| pgvector | latest ext | Embedding storage + cosine similarity for plagiarism detection (FR-GRADE-09). |
| Redis | 7 | Feed ranking cache (15-min recompute) and the BullMQ backing store. **Not used for rooms** — room fan-out is in-process, which is why the room server is single-instance. |
| drizzle-kit | latest | Migration generation and running. Migrations are committed, never hand-edited after generation. |

## Testing

| Technology | Scope |
|------------|-------|
| Vitest | Unit + integration, both apps. Same toolchain as Vite. |
| Fastify `inject()` | Route-level integration tests without a network socket. |
| Playwright | E2E on critical flows only: auth, post lifecycle, submission → grading, fork. |
| Testcontainers (or docker-compose) | Real PostgreSQL + Redis in integration tests. No mocking Drizzle. |

Details: `TESTING.md`.

## Infrastructure

| Resource | Product | Spec | Cost |
|----------|---------|------|------|
| App server | DigitalOcean Basic Droplet | 2 vCPU / 4 GB / 80 GB SSD, Ubuntu 22.04 | ~$24/mo |
| Database | DO Managed PostgreSQL 15 | 1 vCPU / 1 GB / 10 GB | ~$15/mo |
| Reverse proxy | Nginx on the droplet | TLS termination, HTTP→HTTPS redirect, WS upgrade routing | — |
| Process manager | systemd units | api (:4000), room server (:4100, **its own process**), grading worker, LiveKit | — |
| CI/CD | GitHub Actions | lint + typecheck + test on PR; deploy on main | free tier |
| Monitoring | New Relic (infra + APM), Sentry (errors) | | free tiers |

Backup plan: college server (4 core / 8 GB) — everything is plain Node + Postgres, no cloud-specific dependencies. Details: `DEPLOYMENT.md`.

## External Services

| Service | Used for | Constraint |
|---------|----------|------------|
| Anthropic API | AI grading + AI-suggested Feature Requests (both run in the grading worker process) | `claude-sonnet-4-6`; never called outside the worker |
| LiveKit | Proximity audio/video in Live Space | Self-hosted, so no per-minute cost. TURN on TCP/443 is mandatory, not optional, on Indian campus and mobile networks (`docs/livekit-vps.md`) |
| GitHub API | Repo clone for grading AST analysis | Read-only OAuth token |
| College SMTP | Transactional email | TLS required; domain `nttf.co.in` |

## Explicitly Not Used

- **No Next.js** — SPA is sufficient; no SEO requirement (college-internal).
- **No Redux/Zustand for server state** — TanStack Query owns it. Small UI state uses React context/local state.
- **No Prisma** — Drizzle chosen for SQL transparency and lighter runtime.
- **No Socket.io** — plain `ws` via Fastify plugin; we control the event protocol (`packages/protocol/src/events.ts`).
- **No bespoke WebRTC stack** — LiveKit SFU only (FR-ROOM-29, ADR-012).
- **No animation library** — Framer Motion was specified and never installed. Transitions are Tailwind utilities.
- **No state library for room state** — three `useSyncExternalStore` module stores plus one typed event bus. Per-frame data (avatar screen positions) never passes through React at all.
- **No S3/object storage in V1** — cover images noted in `DECISIONS.md` (local disk on droplet, served by Nginx); videos are external links only.
