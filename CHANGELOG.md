# Changelog

All notable changes to Retry. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once releases begin. Each production deploy tag (`v*`) must have an entry here (CI-enforced, see `DEPLOYMENT.md`).

## [Unreleased]

### Changed
- **Rooms audio/video moved from Daily.co to self-hosted LiveKit** (ADR-012). Tokens are signed locally by the room server, so no third-party call sits in the room-entry path; AV stays off until a LiveKit server is configured. Deployment recipe in `docs/livekit-vps.md` (2026-07-25)
- **Renamed the product Foundry → Retry** (ADR-011): package scope `@foundry/*` → `@retry/*`, spec filenames, env vars, service and deploy names, refresh cookie, localStorage key, all user-facing copy. No domain is hard-coded — base URLs stay environment variables. Local dev needs `pnpm install` and a one-time `ALTER DATABASE`/`ALTER ROLE` (2026-07-25)

### Added
- Rooms: **emotes, typing notices and proximity speech** — eight reactions from the pack's thought-bubble atlas (click or number key), "Ana is typing…" in both the Live Space and the Workspace, and a nearby chat scope delivered only to the people proximity already says are close. Nearby lines are speech, not record: they appear over the speaker's head, are never persisted, and work in the Commons too, which keeps no chat log (2026-07-27)
- Rooms: **sittable furniture** — chairs carry a `seat` interactable and `E` sits, facing whichever way the map says. Client-side only: the server sees an ordinary position, so no new protocol and no new state (2026-07-27)
- Rooms: **a minimap** with a dot per person, drawn from the collision grid so the shape of the room is legible, and **click a name in the presence strip** to pan the camera to that person and back (2026-07-27)
- Rooms: **desktop-only gate** for the Live Space (build plan Phase 8.4, SRS §10) — under 1024px or a coarse pointer gets an explanation and a link to the room's Workspace instead of a canvas with no keyboard to drive it (2026-07-27)
- **A committed browser drive and load script** (`apps/e2e`): two students in one room over Edge, and 50 headless sockets measuring broadcast latency against the 150 ms budget. Replaces four throwaway scripts (2026-07-27)
- Rooms: real art — a 38-tile hand-authored tileset, both maps rebuilt around it, and six avatars a student picks by personality rather than appearance. The picker appears once per room and the choice is stored server-side (2026-07-26)
- Rooms: the Workspace view — project context (stage, domain tag), Project Blueprint, Build Journey timeline, and chat/board/whiteboard, all without entering the 2D world. A room is now useful when nobody else is online. Both views of a room share one socket, so an edit in either shows up in the other immediately (2026-07-25)
- Rooms: lifecycle and membership — invite by college email, accept/decline (a decline notifies nobody), leave, remove member, ownership transfer, rename, visibility flip, delete with cascade. Notification bell and a `/rooms/:id` room detail page. A removal now takes effect live: the room server walks the removed member out to the Commons on the same socket instead of leaving them standing in a room they were removed from (2026-07-25)
- Rooms: live presence — the room list and roster show who is in a room right now, from a heartbeat into `room_members.presence_seen_at`; no sessions table and no attendance history (2026-07-25)
- Rooms: persistent panels — chat with REST history, a Kanban board with fractional ordering, and a self-hosted tldraw whiteboard, all over the existing world socket (2026-07-25)
- Phase 0 scaffold: pnpm monorepo (`apps/api`, `apps/web`, `packages/db|types|config`), docker-compose dev stack, CI workflow (2026-07-06)
- Auth vertical slice: college-email registration with verification, argon2id + JWT login, rotating refresh-token families, password reset, student onboarding, `requireRole()` RBAC — FR-AUTH-01/02/03/04/07/08 (2026-07-06)
- Frontend shell styled with Figma design tokens (ADR-010): login, signup, verify, reset, onboarding pages + app shell, dark/light themes (2026-07-06)
- Complete project documentation suite: TECH_STACK, ARCHITECTURE, DATABASE, API, WEBSOCKET_EVENTS, CONVENTIONS, CONTRIBUTING, TESTING, DEPLOYMENT, SECURITY, DECISIONS, ROADMAP, PROGRESS (2026-07-03)
- Claude AI context: CLAUDE.md and domain skills in `.claude/skills/` (2026-07-03)
- `.env.example` environment variable contract (2026-07-03)

### Fixed
- The presence strip could read "Reconnecting…" while the world was plainly working. Socket status is now read from the socket rather than accumulated from events, so a component mounting after a transition sees the truth (2026-07-27)
- A half-open socket read as a permanently healthy world. Added an application-level ping/pong heartbeat; four unanswered beats reconnect (2026-07-27)
- A dropped connection deleted everyone else. Remote avatars now freeze and dim, local movement keeps working, and after five failed attempts the client offers an explicit Rejoin instead of retrying forever (build plan Phase 8.1) (2026-07-27)
- **The seventh public room could not be created at all** — every Commons door slot was taken and creation returned 409. Public rooms are now created doorless when the wall is full and take a door as soon as one frees; the Commons also went from six slots to twelve (2026-07-27)
- Re-authoring the Commons stranded every existing public room on coordinates that no longer name a slot, silently removing its door. The API now reconciles door slots at boot (2026-07-27)
- Escape with a chat panel open left the world entirely instead of closing the panel; the panels, character creator and a pending knock now take Escape in the capture phase and peel one layer at a time (2026-07-27)
- The composited-character texture cache never evicted (~393 KB each). Now LRU-capped with the live cast pinned, and the generated animation clips die with their texture (2026-07-27)
- A Phaser game torn down before its first step left its canvas behind, stacked over the live one — the world rendered as a black rectangle in React StrictMode (2026-07-27)
- Two of five rooms were laid on floor blocks that tile into a lattice of offset rectangles; `tableRound` pointed at a crate; conference seating faced the wrong way (2026-07-27)
- An invite-only room offered visitors an "Enter" button that only ever ended in a denial (2026-07-27)
- The world server accepted any string as an avatar sprite straight off the wire; sprites are now whitelisted against the preset list (2026-07-26)
- The whiteboard never opened and the Kanban board never loaded. Both WebSocket routes dropped the client's first frame — a `ws` socket emits `message` whether or not a listener is attached — and the board's one-shot state arrived before its lazily-mounted panel subscribed (2026-07-25)
- Chat sent from the Workspace was attributed to "Anonymous": the `watch` message carried no display name, unlike `join` (2026-07-25)
- Every bodyless `POST` from the browser returned 400: the API client sent a JSON content-type with no body, which Fastify rejects. Accepting an invite hit this (2026-07-25)
