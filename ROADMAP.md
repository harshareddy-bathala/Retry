# ROADMAP.md — Retry 12-Month Development Plan

> Phase-by-phase plan for the 5-member team. Constraint from the SRS: **all P1 complete by end of Month 10, P2 by end of Month 12, P3 only if time permits.** Months 1–10 therefore carry P1 scope; P2 items are explicitly deferred into Months 10–12 even when they belong to an earlier module. Each phase ends with its features deployed to staging and demoed to the team.

Sprint cadence: 2-week sprints, 2 sprints per month. `PROGRESS.md` tracks requirement-level status; this file tracks phase-level intent and doesn't change unless we re-plan.

---

## Phase 0 — Foundations (Month 1)

**Goal: a deployed walking skeleton — login on the real domain, CI green, one table round-trip.**

- Monorepo scaffold: pnpm workspaces, `apps/web`, `apps/api`, `packages/db|types|config`, ESLint/Prettier/tsconfig bases
- Docker compose for local Postgres 15 + pgvector, Redis 7, Mailpit
- Drizzle setup + initial schema: `users`, `refresh_tokens`; migration + seed pipeline
- Auth complete: register (domain-restricted) → verify email → login → refresh rotation → password reset → onboarding form (FR-AUTH-01…04, 07, 08)
- `requireAuth` / `requireRole` middleware + global error handler + logger + Sentry wiring
- Admin bootstrap: create faculty accounts, suspend users (FR-AUTH-05, minimal admin routes)
- React shell: router, layout, nav bar, auth screens, TanStack Query + api client
- CI: lint, typecheck, tests, migration check, AI-boundary grep; staging deploy workflow; droplet provisioned (Nginx, TLS, systemd)

**Exit criteria:** a teammate registers with a college email on staging, verifies, onboards, and sees an empty feed shell.

## Phase 1 — Posts & Profiles (Month 2)

**Goal: the archive exists — students can post work.**

- `posts` schema + full CRUD, slugs, Markdown editor with preview (FR-POST-01…03, 06, 07)
- Status state machine Draft ↔ Published (submit comes in Phase 3) (FR-POST-04)
- Readiness Checklist (FR-POST-08)
- Cover image upload (sharp re-encode, Nginx-served)
- Post card + post detail page (FR-POST-09, 10)
- Team invitations: mention, accept/decline, team section, Team Projects on profile (FR-TEAM-01…03)
- Profile page: info, post grid (FR-PROFILE-01)
- Latest feed (reverse-chronological, infinite scroll) as the first feed mode (part of FR-FEED-02, 04)

## Phase 2 — Lineage, Social & Feed (Month 3)

**Goal: posts connect — forking, upvotes, discovery.**

- Fork flow with mandatory rationale; immutable `parent_post_id`; fork counts + attribution (FR-LINEAGE-01, 02, 06, 07)
- Recursive-CTE traversal API (FR-LINEAGE-03, 04) — `packages/db/src/queries/lineage.ts`
- Mini lineage tree on post detail (FR-POST-12 pulled forward — it sells the product)
- Upvotes, comments (one-level replies), saves, share (FR-SOCIAL-01…06)
- Feed ranking job (15-min Redis recompute) + For You / Department / Discover / Trending modes + composable filters (FR-FEED-01, 02, 03, 06†)
- Notifications core: bell, unread count, comment/upvote-milestone/fork events (FR-NOTIF-01, 02)

† FR-FEED-06 is P2 but the Redis cache is the cheapest way to build FR-FEED-01, so it lands here.

## Phase 3 — Grading Pipeline (Months 4–5) ⚠ highest-risk phase, two months on purpose

**Goal: submit → AI first-pass → faculty approval → released grade, end to end.**

- Submitted/Graded states + demo-URL freeze + withdraw (FR-POST-05, submit action of FR-POST-04)
- Rubric CRUD + default rubric + global/assignment scoping (FR-GRADE-01…03)
- BullMQ queue + worker skeleton with retries/backoff/timeout states (FR-GRADE-05, 10, NFR-SCALE-01)
- Repo clone + Tree-sitter signals; graceful no-repo degradation (FR-GRADE-06, 11; FR-GRADE-08 signals as feasible)
- Embedding worker + pgvector similarity vs ancestors + plagiarism flag (FR-GRADE-09) — `queries/similarity.ts`
- **The one Anthropic call** with structured output (FR-GRADE-07) in `grading.worker.ts`
- Faculty grading review screen: approve / modify-with-reason / override (FR-GRADE-12…15)
- Grading queue view + post browser (FR-FACULTY-02, 03), faculty comments/badge (FR-FACULTY-08)
- Grade release notifications, in-app + email via SMTP (FR-GRADE-17, FR-TEAM-04, FR-NOTIF-03 grade part)
- Grade badge on posts (FR-POST-11 badge; detailed breakdown view)

**Exit criteria:** a real repo graded on staging in <5 min; faculty modifies one criterion with a reason; student sees the released grade and gets the email.

## Phase 4 — Rooms: Workspace (Months 6–7)

**Goal: teams live in Retry while building — everything except the 2D world.**

- Rooms CRUD, invites, leave/transfer/remove, room list with presence (FR-ROOM-01…06)
- WS server: ticket auth, presence + heartbeat, Redis pub/sub broadcast (FR-ROOM-07, 08; protocol per `WEBSOCKET_EVENTS.md`)
- Workspace view: project context header with live edits (FR-ROOM-09, 10)
- Blueprint panel + edit history (FR-ROOM-11; history FR-ROOM-12)
- Fork-aware creation + ancestor snapshot panel (FR-ROOM-14, 15)
- Kanban: columns, cards, realtime moves, rename (FR-ROOM-18…20)
- Persistent chat sidebar (FR-ROOM-33…36)
- Build Journey auto-entries: creation, first blueprint edits, stage changes, weekly done counts (FR-ROOM-17)

## Phase 5 — Rooms: Live Space (Month 8)

**Goal: proximity presence that feels alive.**

- Phaser canvas, fixed tilemap, 6 avatar sprites, WASD movement + animation (FR-ROOM-22…25)
- Position broadcast + reconnect-to-last-position (FR-ROOM-26, 27)
- Server-side proximity detection + zones (FR-ROOM-28, SRS §11.4)
- Daily.co integration: scoped tokens, call membership orchestration, video bubbles, mute/camera state (FR-ROOM-29…32, NFR-SEC-02)
- tldraw sync server deployed; whiteboard persisted to Postgres, reachable from both views (FR-ROOM-37…39)

**Exit criteria:** two laptops, two avatars walk up to each other on staging → video connects <2 s; walk apart → disconnects.

## Phase 6 — Idea Hub + P1 Hardening (Months 9–10)

**Goal: close out every P1 requirement; launch-ready.**

- Open Ideas: post, upvote, claim→draft link, built transition, unclaim (FR-IDEA-01…05)
- Feature Requests: post on projects, FR tab, notify author, accept→fork prompt (FR-IDEA-08…11, 13)
- Alumni role end-to-end: admin batch-graduation, read access, badged comments (FR-ALUMNI-01, 03; FR-AUTH-06 admin flow)
- Remaining P1 sweep + full RBAC matrix test green
- Performance pass against NFR-PERF targets (feed FCP 2 s, canvas 3 s, 200-user load test with k6)
- Security pass per `SECURITY.md`; backup-restore drill
- Mobile pass: feed + post detail at 375 px (NFR-USE-02)
- **🚀 End of Month 10: P1 launch to a pilot cohort**

## Phase 7 — P2 + Pilot Feedback (Months 11–12)

Priority order (feedback from the live pilot may reorder — that's expected):

1. Assignments: manager, banners, deadline reminder emails (FR-FACULTY-05, FR-NOTIF-03)
2. Grade export CSV + lineage viewer for faculty (FR-FACULTY-06, 07); grading audit-trail hardening (FR-GRADE-16); rubric clone (FR-GRADE-04)
3. Follows + feed personalisation + From Your Seniors (FR-SOCIAL-07, FR-PROFILE-04, FR-FEED-05)
4. Profile depth: skills auto-gen, lineage stats, saved tab (FR-PROFILE-02, 03, 05)
5. Full-page lineage visualiser (FR-LINEAGE-05)
6. AI-suggested Feature Requests (FR-IDEA-12 — worker-side, reuses grading infra)
7. Idea filters, alumni ideas, kanban move-notes, blueprint prefill, tag-overlap notice, markdown preview polish (FR-IDEA-06, FR-ALUMNI-02/04, FR-ROOM-21, FR-ROOM-13, FR-ROOM-16, FR-POST-03)

**P3 (only if Months 11–12 leave room):** faculty analytics dashboard, idea pinning, notification preferences.

---

## Standing Risks

| Risk | Mitigation |
|---|---|
| Grading pipeline complexity (clone + AST + embeddings + LLM) | Two full months (Phase 3); fake-AI mode so UI work never blocks on the worker |
| Live Space is novel territory (Phaser + WebRTC) | Isolated to one month with Workspace already shipped; Daily.co handles all WebRTC; cut-line = ship Workspace-only rooms, Live Space post-launch, if Phase 5 slips |
| Daily.co free-tier overrun | Usage on admin health page from day one of Phase 5 |
| 5 students + coursework ≠ 5 FTE | P1-only focus through Month 10; P2 explicitly parked; every phase has a demo checkpoint to catch slips early |
| Anthropic API cost during dev | Fake in tests; worker runs against real API only on staging + a capped dev key |
