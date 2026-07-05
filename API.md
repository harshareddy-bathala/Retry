# API.md — Foundry REST API

> Every route lives in `apps/api/src/routes/<domain>.routes.ts`, validates input with Zod, and enforces roles via `requireRole()` middleware. This document is the endpoint contract. Adding/changing a route = updating this file in the same PR.

---

## 1. Conventions

- Base path: `/api`. JSON in/out. Auth via `Authorization: Bearer <access-token>`.
- IDs are UUIDs. Lists paginate with `?cursor=<id>&limit=20` (cursor-based; feed uses its own ranking cursor).
- **Success envelope:** resource or `{ items, nextCursor }` for lists. HTTP 200/201/204.
- **Error envelope (always):**
```json
{ "error": { "code": "POST_NOT_EDITABLE", "message": "Submitted posts are locked. Withdraw first." } }
```
  Codes are SCREAMING_SNAKE, defined in `packages/types/src/errors.ts`. Raw DB/stack errors never reach the client (Hard Rule 5); unexpected errors → Sentry + generic `INTERNAL_ERROR` 500.
- Standard status usage: 400 validation, 401 unauthenticated, 403 role/ownership, 404 missing, 409 state conflict (e.g. illegal status transition, duplicate claim), 429 rate-limited.
- Roles column: S=student, F=faculty, AL=alumni, AD=admin, ✱=any authenticated.

## 2. Auth — `auth.routes.ts`

| Method + Path | Roles | Purpose |
|---|---|---|
| POST `/auth/register` | public | College-email signup (`@nttf.co.in` enforced); sends verification email |
| GET `/auth/verify-email?token=` | public | Activates account |
| POST `/auth/login` | public | → `{ accessToken, refreshToken, user }` |
| POST `/auth/refresh` | public | Rotate refresh token |
| POST `/auth/logout` | ✱ | Revoke refresh token |
| POST `/auth/forgot-password` / `/auth/reset-password` | public | Time-limited email link |
| POST `/auth/onboarding` | S | Name, department, batch year, semester, bio (FR-AUTH-04) |
| GET `/auth/me` | ✱ | Current user |

## 3. Users & Profiles — `users.routes.ts`

| Method + Path | Roles | Purpose |
|---|---|---|
| GET `/users/:id` | ✱ | Profile: info, published posts, team projects, lineage stats, skills (derived from post tags) |
| PATCH `/users/me` | S, F, AL | Bio, avatar |
| GET `/users/search?q=` | S, F | Name/email search for team mentions + room invites |
| POST / DELETE `/users/:id/follow` | S | Follow / unfollow |
| GET `/users/me/saved` | ✱ | Saved posts (owner only) |

## 4. Posts — `posts.routes.ts`

| Method + Path | Roles | Purpose |
|---|---|---|
| POST `/posts` | S | Create draft |
| GET `/posts/:slugOrId` | ✱ | Detail incl. team, parent + rationale, mini lineage, grade badge |
| PATCH `/posts/:id` | S (author/team) | Edit — 409 if `submitted`/`graded` |
| DELETE `/posts/:id` | S (author), AD | 409 if submitted/graded (admin override allowed) |
| POST `/posts/:id/publish` / `/posts/:id/unpublish` | S (author) | Draft ↔ Published |
| POST `/posts/:id/submit` | S (author) | → Submitted; freezes demo URL; enqueues grading |
| POST `/posts/:id/withdraw` | S (author) | Submitted → Draft; frozen_demo_url kept |
| POST `/posts/:id/fork` | S | Rationale ≥50 chars required → new draft with `parent_post_id` |
| GET `/posts/:id/readiness` | S (author) | Checklist state (draft only, informational, FR-POST-08) |
| POST / DELETE `/posts/:id/upvote` | ✱ | Toggle |
| POST / DELETE `/posts/:id/save` | ✱ | Bookmark |
| GET `/posts/:id/comments` · POST `/posts/:id/comments` | ✱ | One-level reply nesting enforced |
| DELETE `/comments/:id` | author, post owner, F | Per FR-SOCIAL-04 |
| POST `/posts/:id/team` | S (author) | Invite teammate |
| POST `/team-invites/:id/respond` | S | accept / decline |

## 5. Lineage — `lineage.routes.ts`

| Method + Path | Roles | Purpose |
|---|---|---|
| GET `/lineage/:postId` | ✱ | Full tree: ancestors + descendants with depth (recursive CTE) — powers visualiser & faculty viewer |

## 6. Feed — `feed.routes.ts`

| Method + Path | Roles | Purpose |
|---|---|---|
| GET `/feed?mode=for-you\|department\|discover\|trending\|latest` | ✱ | Redis-ranked, 20/page; filters: `department, projectType, techStack, domain, semester, batchYear` |
| GET `/feed/seniors` | S | "From Your Seniors" pinned section (FR-FEED-05) |

## 7. Grading & Faculty — `grading.routes.ts`, `faculty.routes.ts`

| Method + Path | Roles | Purpose |
|---|---|---|
| GET `/faculty/queue` | F | Submitted posts awaiting review, oldest first, queue stats |
| GET `/faculty/posts` | F | Post browser with filters incl. grading status |
| GET `/grades/:postId` | F; author+team after release | Pending grades are faculty-only (FR-GRADE-12) |
| POST `/grades/:id/approve` | F | Release as-is |
| POST `/grades/:id/modify` | F | Criterion changes; reason required per change |
| POST `/grades/:id/override` | F | Full manual grade |
| POST `/grades/:postId/retry` | F | Re-enqueue failed grading job |
| GET/POST `/rubrics` · PATCH/DELETE `/rubrics/:id` · POST `/rubrics/:id/clone` | F | Rubric management |
| GET/POST `/assignments` · PATCH `/assignments/:id` | F | Assignment manager; students see banner via GET `/assignments/mine` (S) |
| GET `/faculty/export/grades.csv?batch=&department=&assignment=` | F | CSV export |

## 8. Idea Hub — `ideas.routes.ts`

| Method + Path | Roles | Purpose |
|---|---|---|
| GET `/ideas?type=open_idea\|feature_request&status=&difficulty=&techStack=` | ✱ | Ranked by upvotes |
| POST `/ideas` | S, F, AL | Open Idea (AL allowed) or FR on a post |
| POST / DELETE `/ideas/:id/upvote` | ✱ | Toggle |
| POST `/ideas/:id/claim` | S | Links/creates draft post; 409 if already claimed |
| POST `/ideas/:id/unclaim` | S (claimer) | Back to open |
| POST `/ideas/:id/accept` | S (target post author) | FR accept → pre-filled fork prompt (FR-IDEA-11) |
| POST `/ideas/:id/dismiss` | S (target post author) | AI-suggested FRs only; never reappears |

## 9. Rooms — `rooms.routes.ts` (REST part; realtime in `WEBSOCKET_EVENTS.md`)

| Method + Path | Roles | Purpose |
|---|---|---|
| GET `/rooms` | S | My rooms, sorted by last activity, with live presence counts (from Redis) |
| POST `/rooms` | S | Create; origin new/fork; fork origin captures ancestor snapshot; triggers tag-overlap notice query (FR-ROOM-16) |
| GET `/rooms/:id` | S (member) | Full Workspace payload: context, blueprint, journey, kanban, columns, members |
| PATCH `/rooms/:id` | S (owner) | Rename / description |
| DELETE `/rooms/:id` | S (owner) | Confirmed, permanent cascade |
| POST `/rooms/:id/invites` · POST `/room-invites/:id/respond` | S | Invite by name/email; accept/decline |
| POST `/rooms/:id/leave` · POST `/rooms/:id/transfer-ownership` | S (member/owner) | FR-ROOM-05 |
| DELETE `/rooms/:id/members/:userId` | S (owner) | Remove member (also revokes Daily.co access) |
| GET `/rooms/:id/messages?cursor=` | S (member) | Chat history pagination |
| POST `/rooms/:id/ws-ticket` | S (member) | Short-lived one-time WS auth ticket |
| POST `/rooms/:id/daily-token` | S (member) | Scoped per-room per-session Daily.co token (NFR-SEC-02) |

Faculty have **no** room routes — rooms are private to members (SRS §3.2).

## 10. Notifications — `notifications.routes.ts`

| Method + Path | Roles | Purpose |
|---|---|---|
| GET `/notifications?cursor=` | ✱ | List + unread count |
| POST `/notifications/read` | ✱ | Mark ids (or all) read |

## 11. Admin — `admin.routes.ts`

| Method + Path | Roles | Purpose |
|---|---|---|
| GET `/admin/users` · PATCH `/admin/users/:id` | AD | Activate, suspend, reset password, edit role |
| POST `/admin/faculty` | AD | Create faculty accounts (FR-AUTH-05) |
| POST `/admin/graduate-batch` | AD | Migrate a batch's students → alumni (FR-AUTH-06) |
| GET/PATCH `/admin/config` | AD | Departments, tag list, proximity threshold, similarity threshold |
| GET `/admin/health` | AD | Queue depth, Daily.co usage, DB/Redis status |
