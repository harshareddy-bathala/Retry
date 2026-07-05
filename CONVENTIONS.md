# CONVENTIONS.md — Foundry

> Code style and structural conventions. ESLint + Prettier (configs in `packages/config`) enforce what they can; this doc covers what they can't. When in doubt, match the surrounding code.

---

## 1. TypeScript

- `strict: true` everywhere. **`any` is banned** (Hard Rule 1) — use `unknown` + narrowing, or define the type. `as` casts require a comment explaining why narrowing isn't possible.
- Prefer `type` over `interface` except when declaration-merging is required (never in our code).
- Shared types + Zod schemas live in `packages/types`. Derive types from Zod: `type CreatePostInput = z.infer<typeof createPostSchema>`. Never write a type and a schema separately for the same shape.
- No default exports (exception: React lazy-loaded route components). Named exports only.
- No enums — use union types (`type Role = 'student' | 'faculty' | ...`) matching the pg enums in `DATABASE.md`.
- Dates cross the API as ISO-8601 strings; parse at the edge.

## 2. Naming

| Thing | Convention | Example |
|---|---|---|
| Files (non-component) | kebab-case with role suffix | `posts.service.ts`, `posts.routes.ts`, `grading.worker.ts` |
| React components | PascalCase file = component name | `PostCard.tsx`, `LineageTree.tsx` |
| Hooks | `use` prefix, camelCase file | `usePostQuery.ts`, `useRoomSocket.ts` |
| Variables/functions | camelCase; booleans read as predicates | `isSubmitted`, `canEdit`, `hasQuorum` |
| Constants | SCREAMING_SNAKE only for true constants | `MAX_TITLE_LENGTH = 80` |
| DB tables/columns | snake_case (see DATABASE.md); Drizzle maps to camelCase in TS | `frozen_demo_url` → `frozenDemoUrl` |
| API routes | plural nouns, kebab-case, actions as sub-resources | `POST /posts/:id/submit` not `POST /submitPost` |
| WS events | `namespace:event` per WEBSOCKET_EVENTS.md | `kanban:card:move` |
| Error codes | SCREAMING_SNAKE in `packages/types/src/errors.ts` | `FORK_RATIONALE_TOO_SHORT` |

## 3. Backend Patterns

- **Route files** register routes only: middleware chain → Zod parse → service call → reply. No business logic, no Drizzle imports.
- **Service files** own business logic and transactions. One service per domain. Services throw typed `AppError(code, statusCode, message)`; a global Fastify error handler maps them to the error envelope and reports unexpected errors to Sentry.
- **State machines in one place**: post status transitions live in `posts.service.ts` as a transition table — routes call `transition(post, 'submit', actor)`, never set `status` directly.
- Validation is Zod at the route boundary; services may assume valid shapes but must still check *authorization-relevant* facts (ownership, membership, state).
- All multi-write operations use `db.transaction()`. Denormalised counters (`upvote_count`, `fork_count`, `comment_count`) update inside the same transaction as the source row.
- Logging: `logger.info({ postId }, 'post submitted')` — object first, message second, no string interpolation of data. Never log tokens, passwords, or email bodies.

## 4. Frontend Patterns

- **Feature folders** (`src/features/<domain>`) contain components, hooks, and api calls for that domain. Shared primitives go to `src/components` only after being used by 2+ features.
- **Server state = TanStack Query.** Query keys are arrays namespaced by domain: `['posts', postId]`, `['feed', mode, filters]`. Mutations invalidate by prefix. No server data in React context.
- API calls go through the single client in `src/lib/api.ts` (fetch wrapper: auth header, refresh-token retry, error-envelope unwrap). Components never call `fetch` directly.
- Forms: react-hook-form + the same Zod schemas from `packages/types` via `zodResolver`.
- **No direct DOM manipulation** (Hard Rule 8). Allowed refs: Phaser canvas mount, tldraw container, focus management via Radix.
- Tailwind: class order = layout → spacing → typography → color → state. Use `clsx`/`tailwind-merge` helper `cn()`. No inline `style` except dynamic canvas-derived positions (video bubbles).
- Loading/error/empty states are required on every data-fetching view — feed skeletons, not spinners, per NFR-PERF.
- Room realtime: one `useRoomSocket(roomId)` hook owns the WS connection; events dispatch into TanStack Query cache updates (`setQueryData`) so Workspace views re-render from a single source of truth.

## 5. Comments & Docs

- Comment **why**, not what. State machine edges, proximity math, and lineage CTEs deserve comments; `// increment counter` does not.
- Every requirement-driven behavior cites its SRS ID: `// FR-POST-05: frozen_demo_url written once, never updated`.
- TODOs must have an owner: `// TODO(harsha): ...` and a tracking issue if non-trivial.

## 6. Git

- Conventional Commits: `feat(posts): add readiness checklist endpoint`, `fix(rooms): clear presence on heartbeat timeout`. Scopes = domain names (auth, posts, feed, lineage, grading, rooms, ideas, notifications, db, web, infra).
- Full workflow in `CONTRIBUTING.md`.
