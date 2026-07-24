# Rooms Build — Handoff Document

> **Audience:** the next AI assistant (or teammate) continuing the Collaboration Rooms build.
> **Written:** 2026-07-19, mid-Phase-6. Read this fully, then `CLAUDE.md`, then `foundry_rooms_build_plan.md`, before writing any code.
> **Authority order when documents disagree:** `foundry_srs.md` > `CLAUDE.md` > `foundry_rooms_build_plan.md` prompts. This has already mattered once — see "Known deviation" below.

---

## 1. How this build is being run (keep doing this)

- **One phase at a time**, from `foundry_rooms_build_plan.md` (its own phase numbering, separate from ROADMAP.md's). A phase is done only when its acceptance criteria are **exercised for real**, not just unit-tested.
- **Verification is three-layered**, every phase:
  1. `pnpm -r typecheck && pnpm -r lint && pnpm -r test` (api integration tests need `DATABASE_URL_TEST=postgresql://foundry:foundry@localhost:5432/foundry_test`).
  2. WS integration tests in `apps/room-server/test/*.ws.test.ts` against `buildApp()` with `InMemoryRoomStore` (never Postgres in room-server tests).
  3. **A headless-browser drive of the actual app** — puppeteer-core driving Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`), CDP `Network.webSocketFrameReceived/Sent` sniffing to assert wire behavior, screenshots to verify rendering. Existing drive scripts (reference material, live in the job temp dir which may be gone — patterns are what matter): login → click through the UI (never `page.goto` after login — the access token is in-memory only and a full navigation drops it), walk with held WASD keys (4 tiles/s), press E, assert frames.
- **One commit per phase**, message written to a temp file and committed with `git commit -F <file>` (PowerShell mangles quotes in `-m`). Every commit ends with the `Co-Authored-By: Claude …` trailer. Commit only when the phase is verified.
- **Docs updated in the same commit**: `PROGRESS.md` (a dated paragraph per phase — follow the existing style), `WEBSOCKET_EVENTS.md` §6 (every protocol change), `DATABASE.md` (schema deltas).
- **Hard rules from CLAUDE.md are absolute**: no `any`; Zod on every input; identity only ever from the JWT (`sub`), never a message body; RBAC in middleware; no raw SQL outside the two sanctioned query files; no `console.log` (use `lib/logger.ts` server-side, `lib/report.ts` client-side); WS events must match `packages/protocol` exactly.

## 2. What is DONE and committed (rooms phases 0–5)

| Commit | Phase | Summary |
|---|---|---|
| `437a1dc` | – | `ALLOWED_EMAIL_DOMAIN='*'` wildcard for local dev registration |
| `ffe2da4` | 2 | Multiplayer sync: server-authoritative world, JWT-in-query WS auth, snapshot/actorJoin/Move/Leave, 20 moves/s cap, >2-tile teleport rejection + resync, client prediction + 100 ms interpolation |
| `2dfbf7e` | 3 | Proximity engine (close ≤2 / near ≤5 tiles, 0.5-tile exit hysteresis, 300 ms debounce, 100 ms settle ticker, pair-scoped emission) + placeholder DOM bubble overlay + mic/cam toggle persistence |
| `2e182a4` | 4 | Multi-map world: `commons` map + door slots, rooms as map instances (mapId = room uuid), one-socket transitions with 200 ms client fade, access policies (open/knock/invite_only) enforced server-side, knock flow (60 s timeout, session-only grants), spawn resolution via `room_members.current_map_id`, per-map position restore, rooms REST API + Rooms tab UI, migration `0001` |
| `bc69340` | 5 | Daily.co proximity AV: lazy one-Daily-room-per-map, per-session 2 h tokens pushed as `avToken`, client joins with **all tracks unsubscribed** and subscribes only on close/near (bandwidth scales with proximity), WebAudio gain ramp 200 ms (1.0/0.5), `<video>` bubbles with initials fallback, clean no-key degradation |

**Phase 5 open item:** live AV is blocked on the user's Daily account — the API key is set in `apps/room-server/.env` and token minting works (verified: real room created at `harshareddy.daily.co/foundry-commons`), but joining fails with `account-missing-payment-method`. The user must add a payment method at dashboard.daily.co → Billing. When they have, re-run the live-AV checks (fake-media-device drive: launch Edge with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`, assert `<video>` appears for close peers, disappears on walking apart, reconnects <1 s). No code changes should be needed.

## 3. Phase 6 (persistent panels) — IN PROGRESS, uncommitted

Everything below exists in the working tree, **typechecks and lints clean across all 7 workspaces**, and the 41 pre-existing room-server tests + 6 rooms API tests pass. What's missing is: new tests for the panel flows, the browser drive, docs, and the commit.

### Done (uncommitted, file by file)

- **Migration `0002_low_grandmaster.sql`** (applied to both `foundry` and `foundry_test` local DBs): `room_messages`, `kanban_columns` (rename overlay, UNIQUE(room_id,key)), `kanban_cards` (fractional `position real` — one write per drag, never a reindex), `kanban_column` enum `todo/doing/done/parked`, `rooms.whiteboard_state jsonb`. Schema in `packages/db/src/schema.ts`.
- **Protocol** (`packages/protocol/src/events.ts`): client `kanbanCreate/kanbanUpdate/kanbanMove/kanbanDelete/kanbanRenameColumn`; server `chatMessage` (broadcast INCLUDING sender — clients never locally echo), `kanbanState` (full board on room entry), `kanbanCard` (upsert), `kanbanCardRemoved`, `kanbanColumn`. The pre-existing client `chat` message is now live.
- **Store** (`apps/room-server/src/world/store.ts` + `drizzle-store.ts` + in-memory): `appendMessage`, `kanbanBoard`, `createCard` (position = column max + 1), `updateCard`, `moveCard`, `deleteCard`, `renameColumn` (upsert on conflict), `whiteboardState`/`saveWhiteboardState`. `mergeColumnLabels` merges rename rows over `DEFAULT_KANBAN_LABELS`. In-memory store has a `messagesIn()` test helper.
- **Hub** (`apps/room-server/src/rooms/hub.ts`): `onChat` (room instances only — sanitized via `sanitizeText` which strips control chars; persists then broadcasts), `onKanban` (member-gated via `store.isMember`, visitors get FORBIDDEN error frame and read-only sync), `pushKanbanState` on every room-map entry (guarded: skip if the session moved on while loading).
- **Whiteboard sync server** (`apps/room-server/src/rooms/whiteboard.ts` + route in `app.ts`): `@tldraw/sync-core@5.2.5` `TLSocketRoom` per room, lazy, snapshot loaded from `rooms.whiteboard_state` (corrupt document → warn + start empty, never brick), persistence debounced to one write per 5 s (trailing edge), flush + close on server shutdown. WS route `GET /whiteboard?roomId=&token=&sessionId=` — JWT verified, `role==='student'`, **membership required** (4403 otherwise).
- **API** (`apps/api/src/services/rooms.service.ts`, `routes/rooms.routes.ts`): `GET /api/rooms/:id/messages` (member-only, 50/page, `?before=` ISO cursor, page returned oldest→newest, `nextBefore` null at exhaustion) and `GET /api/rooms/:id/members`. Types in `packages/types/src/rooms.ts`. Integration tests for both in `apps/api/test/integration/rooms.int.test.ts` (6/6 green).
- **Web** (`apps/web/src/features/rooms/`):
  - `event-bus.ts`: new `panel:state {open}` event; `game/RoomScene.ts` subscribes — sets `keyboard.enabled=false`, `resetKeys()`, zeroes velocity and sends a final stop move when a panel opens (**"typing in chat never moves the avatar"**).
  - `panels/RoomPanels.tsx`: right-rail shell (💬 📋 ✏️ 👥), exactly one panel open, Escape closes, unread chat badge, panels only in room instances (hidden on `commons`/`studio_a`), all state keyed by `roomId` so nothing leaks between rooms (`key={roomId}` remount).
  - `panels/ChatPanel.tsx`: REST history + WS live, id-dedup between the two, scroll-stick-to-bottom, "Load older" pagination, 403 → "visiting, live messages only" mode, plain-text rendering (React text nodes = render-side sanitisation).
  - `panels/KanbanPanel.tsx`: 4 columns, HTML5 drag (drop on card = fractional position before it, drop on column = append), double-click column label to rename, ✕ delete, add-card input per column. Renders server broadcasts only — no optimistic state.
  - `panels/PresencePanel.tsx`: REST roster + live actors → green dot "Active now"; visitors section for non-member occupants.
  - `panels/WhiteboardPanel.tsx`: lazy-loaded (tldraw is huge), `useSync` against `/whiteboard`, uploads-disabled asset store, full-screen overlay, error state for non-members. **This file was written but has NEVER been rendered — the tldraw integration is typecheck-verified only. Expect to debug it first.**
  - `RoomLivePage.tsx` mounts `<RoomPanels selfUserId>` inside the canvas wrapper.

### Remaining for Phase 6 (do these in order)

1. **Room-server tests** (new `test/panels.ws.test.ts`, follow `world.ws.test.ts` patterns — seeded `InMemoryRoomStore`, `connectAndJoin`, `until()`): chat persists + broadcasts to sender and peers; chat dropped on static maps; kanban mutations blocked for non-members (FORBIDDEN frame) and applied for members; `kanbanState` arrives on join; two concurrent `kanbanMove`s to the same column keep distinct positions; column rename broadcast; whiteboard WS rejects non-members (4403) and syncs two `ws` clients (send a tldraw connect message or at minimum assert the socket stays open and a snapshot persist happens after edits — check `TLSocketRoom` test affordances).
2. **Drive** (adapt the phase-4/5 drive patterns): two browsers as `drivea@test.local` / `driveb@test.local` (password `correct-horse-battery`, member/non-member of the seeded rooms `Drive Open` and `Drive Knock` — see §5). Checks: chat message A→B live; reload B (fresh login) → history present (survives restart); unread badge increments while closed; kanban card created on A appears on B; **both drag different cards simultaneously → no lost update**; whiteboard drawing on A appears on B; panel state absent in the Commons; open chat, type WASD → avatar does not move (assert no `move` frames sent); Escape returns movement.
3. **Docs**: `PROGRESS.md` phase paragraph; `WEBSOCKET_EVENTS.md` §6 (add the six new client + five new server events to the table + a panels paragraph); `DATABASE.md` already documents these tables — verify wording matches what was built; **add the deviation entry** (below) to PROGRESS.md's "Known Deviations from SRS" (it deviates from the *build plan*, aligning WITH the SRS).
4. **Commit** in the established style.

### Known deviation (already decided, just needs recording)

The build plan's Phase 6 asks for an "Activity log" backed by a `room_sessions(joined_at, left_at)` table. **This contradicts SRS line 301** ("No session timestamps or attendance history are kept") and CLAUDE.md's room rules. The SRS's actual FR-ROOM-07/08 describe *live presence*. Decision: the fourth panel is a **live presence panel** (roster + "Active now"), no sessions table, no background closer job. Record this in PROGRESS.md → Known Deviations with a pointer to SRS §"Data & privacy" line 301.

## 4. After Phase 6: what remains in the build plan

- **Phase 7 — Project awareness (derived read-model)** (`foundry_rooms_build_plan.md` §PHASE 7): `room_project_context` cache table (never user-written, rebuildable), computed summary/active-card-count/last-activity/top-contributors, displayed in the room UI. Depends on posts/lineage existing — **the main app's Phase 1 (posts) hasn't been built**, so parts of this phase may need stubbing or deferral; read the phase prompt carefully and scope honestly.
- **Phase 8 — Resilience & scale** (§PHASE 8): reconnect storms, Redis adapter for multi-process fan-out, load testing (the plan names targets), graceful shutdown. The one-socket + in-memory-registry architecture was built knowing this phase converts fan-out to Redis pub/sub — `RoomHub.broadcast` is the single choke point to adapt.
- **Main-app phases** (ROADMAP.md): the Workspace view (blueprint, build journey, project context header) is *separate* from this live-space track and lands with main-app rooms phases. Don't conflate them.

## 5. Pixel-art & polish upgrade (explicitly promised to the user)

All current art is **programmatically generated placeholder** — the visual quality ceiling is an asset swap away, and every contract was designed for that swap:

- **Tileset contract**: 32×32 px tiles, one tileset image per map, embedded tileset named `placeholder` in the Tiled JSON (`packages/maps/maps/*.json`), referenced by the scene as texture key `tiles`. To upgrade: author real maps in **Tiled** (export JSON, keep layer names `ground`/`objects`/`collision` + object layers `spawns`/`interactables` exactly — `pnpm --filter @foundry/maps validate` enforces this), drop the new tileset PNG in `packages/maps/tilesets/`, update the `image`/`columns`/`tilecount` fields. The validator + server collision + client render all read the same JSON — nothing else changes.
- **Avatar contract**: `apps/web/src/features/rooms/assets/avatar.png`, 32×32 frames, **4 rows (down/left/right/up) × 4 columns (idle, walk1, walk2, walk3)** — see `DIRS`/anims in `RoomScene.ts`. The wire protocol already carries a cosmetic `sprite` string per actor and `room_members` is specced for `avatar_sprite int (0–5)` (FR-ROOM-24: six presets chosen on first Live Space entry — **not yet implemented**; that's part of this work: a sprite picker on first room entry, persisted per room per member, sprite sheets `avatar_0.png`…`avatar_5.png`, scene picks the sheet by `actor.sprite`).
- **Recommended sources** (all license-safe): Kenney.nl packs (CC0), LPC (Liberated Pixel Cup) sprites (CC-BY-SA — attribution required), itch.io CC0 interior/office packs ("Modern Office" style suits the studio metaphor). Or commission/draw 16-color originals for a distinctive look — the Commons wants a corridor/atrium feel, rooms want desks + whiteboard + plants.
- **Polish list**: door open/close animation on transitions (currently instant fade), footstep dust particles, whiteboard desk glow when someone is drawing, Commons ambient props, camera shake off, name-tag font already DPR-crisp (keep the `buildPill` resolution trick).

## 6. Environment & operational knowledge (hard-won — read carefully)

- **Windows.** Bash tool = Git Bash; PowerShell also available. Foreground `sleep` is blocked in Bash chains. `git commit -F tempfile` always. Heredocs with quotes inside sometimes break — prefer the Write tool for script files. Python `re.sub` replacement strings decode `\uXXXX` — a literal-control-character bug came from this once; use plain `str.replace`.
- **Processes**: killing a shell task orphans node children holding ports. Free ports with PowerShell: `Get-NetTCPConnection -LocalPort 4100 -State Listen | % OwningProcess | Stop-Process -Force`. **The user runs their own `pnpm run dev` (ports 3000 api / 4100 room-server / 5173 vite)** — do NOT kill their stack casually; tsx watch hot-reloads committed changes but does NOT reload `.env` edits (a room-server restart was needed for the Daily key). If you must restart something of theirs, say so in the final message.
- **Local stack**: Docker Desktop (can be down after reboots — `docker compose up -d` in repo root brings postgres/redis/mailpit back; DB data survives). Migrations: `cd packages/db && DATABASE_URL=… pnpm migrate` (dev DB `foundry`, test DB `foundry_test` — created manually, both migrated through `0002`).
- **Accounts** (all password `correct-horse-battery`): `testuser@gmail.com` (student, owns "Open Lab"), `proxa@test.local` (owns "Knock Studio" public/knock + "Secret Base" private), `proxb@test.local`, and **dedicated drive accounts `drivea@test.local` (owns "Drive Open" public/open) / `driveb@test.local` (owns "Drive Knock" public/knock)** — always drive with these two, never the user's accounts (live-tab supersede ping-pong killed a drive once). `admin@nttf.co.in` / `FoundryDev!234`. New-account flow: register → Mailpit API (`localhost:8025/api/v1/search?query=to:<email>`) → verify link token → login → `POST /api/auth/onboarding`.
- **Before every drive**: reset drive-account presence: `docker exec foundry-postgres-1 psql -U foundry -d foundry -c "UPDATE room_members SET current_map_id = NULL, last_position = NULL WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'drive%@test.local')"`. Auth endpoints rate-limit 5/min/IP in dev — drive logins retry after 30 s, or space runs out a minute apart.
- **Drive walking math**: commons spawn (14,9); door slots on the north wall at x = 3,7,11,15,19,23 (2-wide, interact from y=1); studio_a spawn (10.5,7.5), exit door tiles (9–10,14); speed 4 tiles/s ⇒ hold-key ms = tiles/4×1000; **direction depends on relative door x — a sign bug here cost a debugging cycle**. After any door transition, `sleep(500)` before the next E (the 200 ms fade swallows early presses).
- **Phaser gotcha**: `JustDown` polling missed E presses in headless Edge — interact is now the event-driven `keydown-E` handler. Keep new key handling event-driven.
- **StrictMode**: RoomSocket teardown detaches handlers before close; scene calls `roomSocket.requestResync()` post-boot because the join snapshot races asset loading. Don't "simplify" either.

## 7. Continuation prompt

Use §8 of this file (or the prompt the user was given in chat) verbatim to brief the next model.

## 8. Prompt for the next assistant

```
You are continuing the Foundry Collaboration Rooms build on Windows 11.

Read, in order: ROOMS_HANDOFF.md (repo root — your primary brief), CLAUDE.md,
foundry_rooms_build_plan.md, PROGRESS.md, WEBSOCKET_EVENTS.md §6. Authority
when they disagree: foundry_srs.md > CLAUDE.md > build plan.

Current state: rooms phases 0–5 are committed (see PROGRESS.md). Phase 6
(persistent panels: chat, kanban, tldraw whiteboard, live-presence panel) is
fully implemented in the uncommitted working tree — typecheck/lint/existing
tests all green — but NOT yet finished: it still needs the new WS tests, the
two-browser headless-Edge drive, doc updates, the SRS-deviation note, and the
phase commit. ROOMS_HANDOFF.md §3 lists the exact remaining steps in order;
start with step 1 and do not skip the drive — the WhiteboardPanel has never
been rendered and will likely need debugging.

Non-negotiables: verify every phase by driving the real app headless (the
handoff documents the tooling, accounts, walking math, and known traps); one
commit per phase via `git commit -F <tempfile>`; update PROGRESS.md +
WEBSOCKET_EVENTS.md in the same commit; never violate CLAUDE.md's hard rules;
never drive with the user's own accounts; don't kill the user's dev stack
without telling them.

After Phase 6: Phase 7 (project-awareness read model — scope carefully, the
main app's posts phase doesn't exist yet), Phase 8 (resilience/scale), then
the pixel-art upgrade in handoff §5 (real tilesets + the six-avatar picker,
FR-ROOM-24). Work phase by phase; finish and verify each before the next.
```
