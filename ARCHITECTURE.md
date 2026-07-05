# ARCHITECTURE.md — Foundry

> System architecture, process model, request flows, and source layout. Read this before touching any route, worker, or WebSocket handler.

---

## 1. System Overview

```
                        ┌──────────────────────────────────────────────┐
                        │        DigitalOcean Droplet (Ubuntu 22.04)   │
                        │                                              │
  Browser (React SPA)   │  ┌────────┐   ┌───────────────────────────┐  │
  ┌──────────────────┐  │  │        │   │  apps/api (Node process)  │  │
  │ Feed / Posts /   │──┼─▶│        │──▶│  • Fastify REST API       │  │
  │ Idea Hub / Panel │  │  │        │   │  • Room WS server         │  │
  ├──────────────────┤  │  │ Nginx  │   │    (@fastify/websocket)   │  │
  │ Room Workspace   │──┼─▶│  TLS   │   └─────────┬─────────────────┘  │
  ├──────────────────┤  │  │        │   ┌─────────▼─────────────────┐  │
  │ Live Space       │──┼─▶│        │──▶│  tldraw sync server       │  │
  │ (Phaser canvas)  │  │  │        │   │  (separate Node process)  │  │
  └───────┬──────────┘  │  └────────┘   └───────────────────────────┘  │
          │             │  ┌───────────────────────────┐               │
          │  WebRTC     │  │  Grading worker           │               │
          ▼             │  │  (BullMQ consumer,        │               │
     Daily.co cloud     │  │   separate Node process)  │──▶ Anthropic  │
                        │  └───────────┬───────────────┘    GitHub     │
                        │        ┌─────▼─────┐                         │
                        │        │  Redis 7  │  (queue, cache, pub/sub)│
                        └────────┴─────┬─────┴─────────────────────────┘
                                       │
                          DO Managed PostgreSQL 15 + pgvector
```

Three Node processes run on the droplet under systemd:

| Process | Entry | Responsibility |
|---------|-------|----------------|
| `foundry-api` | `apps/api/src/server.ts` | REST API **and** room WebSocket server (same Fastify instance, separate plugin scopes) |
| `foundry-worker` | `apps/api/src/workers/index.ts` | BullMQ consumers: grading, embeddings, AI feature-request suggestions, email |
| `foundry-tldraw` | tldraw sync server | Whiteboard CRDT sync; persists documents to PostgreSQL |

The API and room server share one process in V1 (200 concurrent users fit comfortably). Redis pub/sub is used for room event broadcast from day one so the room server can be split out and scaled horizontally later without protocol changes (NFR-SCALE-02).

---

## 2. Monorepo Layout

```
foundry/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/              # Router, providers, layout shells
│   │       ├── features/         # One folder per domain (see below)
│   │       │   ├── auth/
│   │       │   ├── feed/
│   │       │   ├── posts/
│   │       │   ├── lineage/
│   │       │   ├── grading/      # faculty panel views
│   │       │   ├── rooms/        # workspace/, live-space/, kanban/, blueprint/
│   │       │   ├── ideas/
│   │       │   ├── profile/
│   │       │   └── notifications/
│   │       ├── components/       # Shared UI primitives (Radix + Tailwind)
│   │       ├── lib/              # api client, query client, sentry, utils
│   │       └── types/            # Frontend-only types; shared ones live in packages/types
│   └── api/
│       └── src/
│           ├── server.ts         # Fastify bootstrap
│           ├── app.ts            # Plugin registration, buildApp() for tests
│           ├── routes/           # One file per domain: auth.routes.ts, posts.routes.ts, ...
│           ├── services/         # Business logic, called by routes: posts.service.ts, ...
│           ├── middleware/       # requireAuth, requireRole, rateLimit
│           ├── room/             # WS server: connection, presence, proximity, handlers/
│           ├── workers/          # grading.worker.ts, embedding.worker.ts, email.worker.ts, index.ts
│           ├── queues/           # BullMQ queue definitions + job payload types
│           └── lib/              # logger.ts, sentry.ts, redis.ts, daily.ts, mailer.ts, env.ts
├── packages/
│   ├── db/
│   │   └── src/
│   │       ├── schema.ts         # Entire Drizzle schema, single file
│   │       ├── queries/          # ONLY raw-SQL exceptions: lineage.ts, similarity.ts
│   │       ├── migrations/       # drizzle-kit output, committed
│   │       └── seed.ts
│   ├── types/                    # Shared TS types + Zod schemas (no runtime beyond zod)
│   └── config/                   # eslint, prettier, tsconfig bases
```

**Layering rule (API):** `routes → services → db`. Routes do: Zod parse → call service → map result to response. Services hold business logic and transactions. Nothing above `services` touches Drizzle directly.

---

## 3. Request Flows

### 3.1 REST request
```
Browser → Nginx (TLS) → Fastify
  → requireAuth (JWT verify, attaches request.user)
  → requireRole([...]) (RBAC — the ONLY place roles are checked)
  → Zod schema parse (body/query/params)
  → service function (business logic, Drizzle queries, transaction)
  → typed response | typed error envelope (never raw DB errors)
```

### 3.2 Post submission → grading (the critical pipeline)
```
1. POST /api/posts/:id/submit (student)
2. Service: validate state Published → Submitted; copy demo_url → frozen_demo_url; lock editing
3. Enqueue BullMQ job `grading` { postId, rubricId }
4. Worker dequeues:
   a. Clone GitHub repo (if URL present) to tmp dir; skip gracefully if absent (FR-GRADE-11)
   b. Tree-sitter AST analysis → code-quality signals
   c. Generate embedding; pgvector cosine similarity vs lineage ancestors (raw SQL in packages/db/src/queries/similarity.ts)
   d. ONE Anthropic API call: rubric + signals + similarity + docs → structured JSON grade
   e. Insert grades row, status='pending'
   f. Notify faculty (in-app)
5. Faculty reviews → approve / modify / override → status flips, grade released
6. Notify author + accepted team members (in-app + email)
Timeout: 10 min → job failure state → faculty notified "manual grading required"
Retries: 3× exponential backoff (1/5/15 min); Anthropic outage → jobs stay pending (NFR-REL-04)
```

### 3.3 Room session
```
1. Student opens room → GET /api/rooms/:id (Workspace data: context, blueprint,
   journey, kanban, chat history — all REST from PostgreSQL)
2. WS connect wss://.../rooms/:id/ws (JWT in query-param ticket, see SECURITY.md)
3. Server registers presence in Redis → broadcasts presence:update
4. Workspace edits (blueprint, kanban, context) → WS events → persist → broadcast
5. "Go to Live Space" → Phaser canvas mounts → avatar:move events (throttled)
6. Server-side proximity check each position update (Euclidean, threshold 5 tiles)
   → enters proximity: Daily.co REST call adds both to shared call → proximity:enter event
   → leaves: removed from call → proximity:leave
7. Disconnect → presence cleared after 30s missed heartbeat; nothing else changes
```
Live presence is **ephemeral** — Redis only, never PostgreSQL. No attendance, no session logs (Hard Rule / SRS §4.7.2).

### 3.4 Feed
```
Every 15 min (BullMQ repeatable job): compute ranking scores → write to Redis sorted sets
GET /api/feed?mode=for-you → read Redis ranking → hydrate post cards from PostgreSQL → paginate
Latest mode bypasses ranking (pure reverse-chronological SQL).
```

---

## 4. Boundary Rules (enforced, not aspirational)

1. **AI boundary** — the Anthropic SDK is imported in exactly one file: `apps/api/src/workers/grading.worker.ts`. CI greps for violations.
2. **Rooms ↔ posts** — zero FK between `rooms` and `posts`. The only reference is `rooms.ancestor_post_id` + immutable `ancestor_snapshot` JSONB captured at creation (fork-aware rooms, FR-ROOM-15). Never join rooms to posts at query time for room features.
3. **RBAC** — `requireRole()` middleware only. If you're writing `if (user.role === ...)` inside a service, stop and move it to the route's middleware chain.
4. **Raw SQL** — allowed in exactly two files: `packages/db/src/queries/lineage.ts` (recursive CTEs) and `packages/db/src/queries/similarity.ts` (pgvector). Everything else is Drizzle.
5. **WS protocol** — every event name and payload matches `WEBSOCKET_EVENTS.md`. Adding an event = updating that doc in the same PR.

---

## 5. Scaling Posture (V1 targets, not aspirations)

- 200 concurrent users, ≤20% response-time degradation (NFR-PERF-05)
- Avatar position propagation ≤150 ms (NFR-PERF-06) — positions are relayed via Redis pub/sub but **never persisted per-move**; `room_members.last_position` is written only on disconnect
- Feed FCP ≤2 s; post detail ≤1.5 s; room canvas interactive ≤3 s
- Grading job ≤5 min normal load, 10 min hard timeout
