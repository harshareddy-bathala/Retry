# ARCHITECTURE.md — Retry

> System architecture, process model, request flows, and source layout. Read this before touching any route, worker, or WebSocket handler.

---

## 1. System Overview

```
                        ┌──────────────────────────────────────────────┐
                        │        DigitalOcean Droplet (Ubuntu 22.04)   │
                        │                                              │
  Browser (React SPA)   │  ┌────────┐   ┌───────────────────────────┐  │
  ┌──────────────────┐  │  │        │   │  apps/api  :4000          │  │
  │ Feed / Posts /   │──┼─▶│        │──▶│  Fastify REST API only    │  │
  │ Idea Hub / Panel │  │  │        │   └─────────┬─────────────────┘  │
  ├──────────────────┤  │  │ Nginx  │             │ POST /internal/*   │
  │ Room Workspace   │──┼─▶│  TLS   │             │ (private network)  │
  ├──────────────────┤  │  │        │   ┌─────────▼─────────────────┐  │
  │ Live Space       │──┼─▶│        │──▶│  apps/room-server  :4100  │  │
  │ (Phaser canvas)  │  │  │        │   │  • /ws     world protocol │  │
  └───────┬──────────┘  │  └────────┘   │  • /whiteboard  tldraw    │  │
          │             │               └───────────────────────────┘  │
          │  WebRTC     │  ┌───────────────────────────┐               │
          ▼             │  │  Grading worker           │               │
   LiveKit SFU          │  │  (BullMQ consumer,        │──▶ Anthropic  │
   (self-hosted;        │  │   separate Node process)  │    GitHub     │
    NOT YET PROVISIONED)│  └───────────┬───────────────┘               │
                        │        ┌─────▼─────┐                         │
                        │        │  Redis 7  │  (queue + cache only)   │
                        └────────┴─────┬─────┴─────────────────────────┘
                                       │
                          DO Managed PostgreSQL 15 + pgvector
```

Four Node processes run on the droplet under systemd:

| Process | Entry | Responsibility |
|---------|-------|----------------|
| `retry-api` | `apps/api/src/server.ts` | REST API only — auth, posts, room lifecycle, membership, history reads |
| `retry-room` | `apps/room-server/src/server.ts` | The live world: `/ws` (world protocol) and `/whiteboard` (tldraw sync) |
| `retry-worker` | `apps/api/src/workers/index.ts` | BullMQ consumers: grading, embeddings, AI feature-request suggestions, email |
| `retry-livekit` | LiveKit SFU | Media only. **Not yet provisioned** — see `docs/livekit-vps.md` |

**The room server is a separate process, not a plugin scope inside the API.** The split is real and load-bearing: the API owns membership and the room server owns the live world, so a membership change has to cross a process boundary. It does, over `POST /internal/evict` and `POST /internal/doors-changed` on the private network, guarded by `INTERNAL_API_SECRET` compared with `timingSafeEqual` and never exposed through Nginx.

The write split follows from that: **REST owns lifecycle, membership and history reads; the WebSocket owns every content write** — chat, kanban, blueprint, context, journey.

> **Redis is not used for rooms.** `RoomHub.broadcast` iterates a local in-process `Map` of sockets. Session state, map registries, the proximity engine and knock requests all live in process memory, so the room server is **single-instance**. Running two would silently split the world in half with no error on either side. Redis backs BullMQ and the feed cache only. Horizontal room scaling needs a fan-out layer that does not exist.

---

## 2. Monorepo Layout

```
retry/
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
│   │       │   ├── rooms/        # game/, hud/, input/, panels/, workspace/, av/, net/
│   │       │   ├── ideas/
│   │       │   ├── profile/
│   │       │   └── notifications/
│   │       ├── components/       # Shared UI primitives (Radix Dialog/Tooltip + Tailwind)
│   │       ├── lib/              # api client, query client, sentry, utils
│   │       └── types/            # Frontend-only types; shared ones live in packages/types
│   ├── api/
│   │   └── src/
│   │       ├── server.ts         # Fastify bootstrap
│   │       ├── app.ts            # Plugin registration, buildApp() for tests
│   │       ├── routes/           # One file per domain: auth.routes.ts, posts.routes.ts, ...
│   │       ├── services/         # Business logic, called by routes: posts.service.ts, ...
│   │       ├── middleware/       # requireAuth, requireRole, rateLimit
│   │       ├── workers/          # grading.worker.ts, embedding.worker.ts, email.worker.ts, index.ts
│   │       ├── queues/           # BullMQ queue definitions + job payload types
│   │       └── lib/              # logger.ts, sentry.ts, redis.ts, room-server.ts, mailer.ts, env.ts
│   └── room-server/
│       └── src/
│           ├── app.ts            # Fastify + ws: /ws and /whiteboard, both socket-paused
│           ├── internal.ts       # POST /internal/evict, /internal/doors-changed
│           ├── rooms/            # hub.ts (the world), proximity.ts, whiteboard.ts
│           ├── world/            # maps.ts (Tiled → collision/spawns), store.ts, drizzle-store.ts
│           ├── av/               # livekit.ts — local token minting, no REST round-trip
│           └── lib/              # auth.ts, env.ts
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

Two views, one socket protocol. See `WEBSOCKET_EVENTS.md` for the full contract.

**Workspace** (`/rooms/:id`, no canvas):
```
1. GET /api/rooms/:id → room metadata, members (REST from PostgreSQL)
2. WS connect ws://<room-server>:4100/ws?token=<access JWT>
3. { t:'watch', roomId } → member-gated; no actor, no proximity, no AV
4. ← workspaceState (name, stage, blueprint, journey, who is in the live map)
   ← kanbanState (the whole board, once)
5. Edits (blueprintUpdate, contextUpdate, kanban*, chat) → persist → broadcast
```

**Live Space** (`/world?map=`, Phaser canvas):
```
1. WS connect (same URL) → { t:'join', mapId? }
2. ← snapshot { mapId, template, actors[] }   ← avToken { serverUrl, room, token }
3. Client predicts locally; sends { t:'move' } on a fixed 50 ms tick while a key
   is held, plus ONE final frame on stop. Remotes interpolate over 100 ms.
4. Server validates each move: ≤2-tile step, not a collision tile, ≤20/s.
   Illegal → no broadcast, resync the offender with a fresh snapshot.
   Legal → actorMove to the map except the sender.
5. ProximityEngine recomputes pairwise Euclidean distance; ≤2 close, ≤5 near,
   0.5-tile exit hysteresis, 300 ms debounce, 100 ms settle tick.
   → proximity { pairs } to ONLY the two clients whose pair changed.
6. Client applies zone → LiveKit setSubscribed per publication (autoSubscribe:false)
   and zone → WebAudio GainNode (1.0/0.5/0, ramped 200 ms).
7. A door sends { t:'transition' } on the SAME socket — never a reconnect.
8. Disconnect → last_position persisted; presence_seen_at NULLed.
```

**Presence is one mutable cell in PostgreSQL** — `room_members.presence_seen_at`, refreshed every 20 s, NULLed on close, read with a 30 s staleness window. Not Redis, and deliberately **not** an append-only table: there is no attendance history and no session log, and there must not be one (SRS §4.7.2).

The API and the room server are different processes, so membership changes cross the boundary explicitly: `POST /internal/evict` moves an evicted member to the Commons **on their existing socket** rather than killing it, because the connection is their whole session and dropping it reads as a crash.

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
5. **WS protocol** — the Zod schemas in `packages/protocol/src/events.ts` are authoritative; `WEBSOCKET_EVENTS.md` explains them. Adding an event = the schema, the doc, and (if a Workspace should see it) `WATCHER_EVENTS` in `hub.ts`, all in the same PR.
6. **The room server never imports from `apps/api`, and vice versa.** They are separate processes. The only channel between them is `POST /internal/*` on the private network, and every call from the API is best-effort with a 2 s timeout — a room server that is down must never turn a successful membership removal into a 500.

---

## 5. Scaling Posture (V1 targets, not aspirations)

- 200 concurrent users, ≤20% response-time degradation (NFR-PERF-05)
- Avatar position propagation ≤150 ms (NFR-PERF-06) — relayed **in process** through `RoomHub.broadcast`, never persisted per-move; `room_members.last_position` is written on transition, leave and disconnect only. Measured with 50 concurrent sockets at the real client's 50 ms cadence: **p50 1.9 ms, p95 67.8 ms, p99 100.4 ms** (`apps/e2e/load/move-latency.ts`)
- **The room server is single-instance.** There is no Redis fan-out and no shared session state, so a second instance would silently split the world. Horizontal room scaling is unbuilt work, not a config change
- Feed FCP ≤2 s; post detail ≤1.5 s; room canvas interactive ≤3 s
- Grading job ≤5 min normal load, 10 min hard timeout
