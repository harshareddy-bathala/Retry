# PROGRESS.md — Foundry

> Living status tracker. Update in the same PR as the work. `ROADMAP.md` is the plan; this is reality. AI assistants: read this to know what exists before writing code that depends on it.

**Last updated:** 2026-07-19

## Current State

**Phase 0 — Foundations, code-complete locally.** Monorepo scaffolded, auth vertical slice implemented and unit-tested, frontend shell styled with the Figma design tokens (ADR-010), CI defined. Remaining before phase exit: admin endpoints (create-faculty, suspend-user), droplet provisioning, and the staging exit demo. Nothing is pushed or deployed yet.

**Rooms build plan — Phase 0 (Foundation & Contracts) complete locally (2026-07-18).** The Collaboration Rooms multiplayer track (`foundry_rooms_build_plan.md`) runs on its own phase numbering. Landed: `packages/protocol` (WS event discriminated unions + Zod validators + 32px tile/pixel coord helpers), `packages/maps` (`studio_a` Tiled map, placeholder tileset, contract validator wired into CI), `apps/room-server` (Fastify + @fastify/websocket health-check endpoint: connect → empty snapshot → clean close, unparseable frames dropped with a logged warning; leak-checked in tests). Movement protocol registered in `WEBSOCKET_EVENTS.md` §6.

**Rooms build plan — Phase 1 (single-player room) complete locally (2026-07-18).** `apps/web` gains the React–Phaser bridge: typed EventBus (`features/rooms/event-bus.ts`, the only React↔Phaser channel), `<RoomCanvas />` with StrictMode-safe mount/destroy, and `RoomScene` — studio_a rendered from the shared Tiled JSON, arcade-physics movement (4 tiles/s, delta-time, normalised diagonals, per-axis wall sliding), camera follow (lerp 0.1, clamped), DPR-crisp name tag, whiteboard "Press E" affordance emitting `interact:whiteboard`. Demo at `/rooms/sandbox` (Rooms nav item), Phaser code-split behind a lazy route. Verified end-to-end in headless Edge: login → walk to whiteboard → E logged in React → wall slide → route remount with no leaked canvas.

**Rooms build plan — Phase 2 (multiplayer sync) complete locally (2026-07-18).** `apps/room-server` is now the authoritative world server: JWT auth in the WS query string (shared `JWT_SECRET` with the API; userId only ever from the token), per-map connection registry, snapshot/actorJoin/actorMove/actorLeave flows with no sender echo, server-owned collision from the shared map JSON, >2-tile teleport rejection with snapshot resync, 20 moves/s rate cap (silent drop) — all covered by 11 WS integration tests including spoof and forged-token cases. Client: `RoomSocket` (exponential backoff 1s→30s, rejoin+resync on reopen, stale-socket-safe teardown), 50ms move tick + final stop message, client-side prediction, remote avatars interpolated over 100ms with 200ms idle timeout, live presence strip. Verified with two headless-Edge users seeing each other move and leave. `pnpm dev` now starts api + room-server + web.

**Rooms build plan — Phase 3 (proximity engine + placeholder AV) complete locally (2026-07-18).** Server-side proximity over authoritative positions: Euclidean tile distance, zones close ≤2 / near ≤5 (SRS §11.4), 0.5-tile exit hysteresis + 300ms debounce (boundary-flicker test parks an avatar at exactly 5.0 tiles per the plan's warning), 100ms settle ticker, `proximity` events sent only to the affected pair, zones re-sent with every resync snapshot, pairs reset on rejoin so reconnect bubble lists are correct. 20-actor update measured ≪5ms. Client: DOM bubble overlay positioned from Phaser coordinates via rAF (72px close / 48px@70% near, initials placeholder for Phase 5 video), mic/cam toggles persisted in localStorage and restored on rejoin (FR-ROOM-21), mute badges broadcast via `media`/`mediaState`. Fixed en route: Phaser scene now requests a resync after boot (the join snapshot used to arrive before the scene subscribed — actors present at join never rendered). 24 room-server tests. Verified with two headless-Edge users plus live occupants: close/near/out transitions, no flicker, mute badge relay. Rooms Phase 4 (multi-map world) is unblocked.

**Rooms build plan — Phase 4 (multi-map world: Commons, doors, private rooms) complete locally (2026-07-19).** First rooms schema migration (`0001`): minimal `rooms` (visibility, access_policy, door_x/door_y, map_template — workspace columns come with the main rooms phase), `room_members` (current_map_id for presence/spawn resolution, last_position written on transition-out/disconnect only), `room_access_requests` (knock audit; grants are session-only). Minimal rooms REST API: `POST/GET /api/rooms` (students only; public rooms take the lowest free Commons door slot at creation; private rooms coerced to invite_only, doorless, unlisted — privacy by absence). `packages/maps` gains the `commons` map (6 anonymous door slots on the interactables layer, `extractDoorSlots` shared by API + world server) and a studio_a exit door. Room server: map instances (mapId = room uuid over a template) behind a `RoomStore` interface (Drizzle in prod, in-memory in tests), transitions that move the session between map registries over ONE socket (never re-handshaken), server-side access policy on every join/transition (members always; open/knock/invite_only; faculty+alumni rejected from the whole live space), knock flow (live prompts to online members, first-answer-wins, 60s timeout, cancel, auto-walk-in on grant), doors state with live occupancy to Commons occupants, map-scoped proximity, spawn resolution (last-active room else Commons), per-map position restore. Client: RoomScene swaps tilemaps in place behind a 200ms fade (scene + socket survive every door), door leafs + plaques (name · occupancy · lock glyph; unassigned slots plain), event-driven E interact (JustDown polling missed fast taps), Rooms tab (list mine/discover + create with visibility/policy), knock waiting card with countdown + cancel, member Grant/Deny toasts, plain-sentence denials. 13 new WS integration tests (49 total across workspace) + 4 rooms API integration tests; api vitest now serializes integration files (parallel truncation was destroying fixtures) and auth rate limiting is off under test. Verified with two headless-Edge users: 17/17 drive checks — 22–83ms door transitions on one persistent socket, private door absent, knock grant walks the requester in. Rooms Phase 5 (Daily.co AV) is unblocked.

**Rooms build plan — Phase 5 (Daily.co proximity AV) code-complete locally (2026-07-19); live-AV checks pending a `DAILY_API_KEY`.** Server (`apps/room-server/src/av/daily.ts`): one Daily room per map instance created lazily and cached, per-room/per-user/per-session meeting tokens (2 h TTL, `eject_at_token_exp`, SECURITY.md/NFR-SEC-02) minted server-side and pushed as `avToken` after every map-entry snapshot (cached grant re-sent on resync — no re-mint); the API key lives only in the room server; Daily outages degrade to no-AV without blocking entry; cumulative participant-seconds logged on disconnect for free-tier monitoring (SRS §3.4). Client (`apps/web/.../av/`): daily-js call object joined with **all tracks unsubscribed** — a peer's audio+video are subscribed only while proximity says close/near and unsubscribed on out (bandwidth scales with proximity, not room population); per-peer WebAudio GainNode ramped 200 ms (close 1.0 / near 0.5); door transitions leave+rejoin on the same call object with mic/cam state carried unchanged; bubbles render a real `<video>` when a track is live, otherwise initials + active-speaker ring (never a black rectangle); no camera permission and no `DAILY_API_KEY` both degrade cleanly. 5 new WS tests (fake provider): grant per map/user, fresh token per transition, cached on resync, outage tolerance, silent when unconfigured. Verified no-key with two headless-Edge users on the running dev stack: 12/12 — world identical to Phase 4, zero `avToken` frames, zero `<video>` elements. **Not yet exercised (needs a real Daily key in `apps/room-server/.env`): <1 s audio connect, bandwidth-proportionality in webrtc-internals, audible gain ramp, permission-denied UX.** Rooms Phase 6 (persistent panels) is unblocked.

## Phase Status

| Phase | Scope | Status |
|-------|-------|--------|
| Docs & planning | CLAUDE.md, SRS, all context docs, skills, roadmap | ✅ Complete (2026-07-03) |
| Phase 0 — Foundations (M1) | Scaffold, CI, auth, deploy skeleton | 🟡 In progress (code-complete locally 2026-07-06) |
| Phase 1 — Posts & Profiles (M2) | Post CRUD, teams, profiles, Latest feed | 🔲 Not started |
| Phase 2 — Lineage, Social & Feed (M3) | Fork, CTE traversal, social, ranked feeds | 🔲 Not started |
| Phase 3 — Grading Pipeline (M4–5) | Submit → AI → faculty approval → release | 🔲 Not started |
| Phase 4 — Rooms: Workspace (M6–7) | WS server, context, blueprint, kanban, chat, journey | 🔲 Not started |
| Phase 5 — Rooms: Live Space (M8) | Phaser, proximity, Daily.co, tldraw | 🔲 Not started |
| Phase 6 — Idea Hub + Hardening (M9–10) | Ideas, FRs, alumni, perf/security pass, **P1 launch** | 🔲 Not started |
| Phase 7 — P2 + Pilot (M11–12) | Assignments, exports, follows, AI FRs, polish | 🔲 Not started |

## Phase 0 Checklist (current phase — next actions)

- [x] pnpm workspace scaffold (`apps/web`, `apps/api`, `packages/db|types|config`)
- [x] `packages/config`: shared eslint/prettier/tsconfig
- [x] docker-compose: postgres15+pgvector, redis7, mailpit
- [x] Drizzle wiring + `users`, `refresh_tokens`, `email_tokens` schema + first migration + admin seed script
- [x] Fastify bootstrap: `app.ts`/`index.ts`, env validation (`lib/env.ts`), redacting logger, error handler (Sentry wiring deferred to Phase 7 — TODO in `error-handler.ts`)
- [x] Auth routes: register / verify-email / login / refresh / logout / forgot / reset / onboarding / me
- [x] `requireAuth` + `requireRole` middleware + RBAC test matrix (`rbac.int.test.ts`)
- [ ] Minimal admin: create-faculty, suspend-user
- [x] React shell: Vite, router, nav, auth pages, api client, TanStack Query provider — styled with Figma tokens (`apps/web/src/styles/theme.css`, dark + light)
- [x] GitHub Actions: PR checks (lint/typecheck/migrate/test/build + raw-SQL grep) — staging deploy job deferred until droplet exists
- [ ] Droplet provisioned: Nginx + TLS + systemd units + staging subdomain
- [ ] **Exit demo:** teammate registers → verifies → onboards → empty feed on staging

## Requirement Ledger

P1 requirement checkboxes live per-phase; check them off as each lands. (Full IDs in `foundry_srs.md`.) Convention: a requirement is checked only when its `TESTING.md` coverage exists and it's been exercised on staging (see Definition of Done, `CONTRIBUTING.md` §7).

## Known Deviations from SRS

_None yet. Record any scope change here with a link to the `DECISIONS.md` entry._
