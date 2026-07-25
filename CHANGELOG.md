# Changelog

All notable changes to Retry. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once releases begin. Each production deploy tag (`v*`) must have an entry here (CI-enforced, see `DEPLOYMENT.md`).

## [Unreleased]

### Changed
- **Rooms audio/video moved from Daily.co to self-hosted LiveKit** (ADR-012). Tokens are signed locally by the room server, so no third-party call sits in the room-entry path; AV stays off until a LiveKit server is configured. Deployment recipe in `docs/livekit-vps.md` (2026-07-25)
- **Renamed the product Foundry → Retry** (ADR-011): package scope `@foundry/*` → `@retry/*`, spec filenames, env vars, service and deploy names, refresh cookie, localStorage key, all user-facing copy. No domain is hard-coded — base URLs stay environment variables. Local dev needs `pnpm install` and a one-time `ALTER DATABASE`/`ALTER ROLE` (2026-07-25)

### Added
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
- The whiteboard never opened and the Kanban board never loaded. Both WebSocket routes dropped the client's first frame — a `ws` socket emits `message` whether or not a listener is attached — and the board's one-shot state arrived before its lazily-mounted panel subscribed (2026-07-25)
- Every bodyless `POST` from the browser returned 400: the API client sent a JSON content-type with no body, which Fastify rejects. Accepting an invite hit this (2026-07-25)
