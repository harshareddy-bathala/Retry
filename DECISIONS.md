# DECISIONS.md — Architecture Decision Records

> Append-only log of decisions that shape the codebase. One entry per decision. Never delete — supersede with a new entry that links back. Format: context → decision → consequences.

---

## ADR-001: pnpm workspaces for the monorepo (2026-07-03)

**Context:** 2 apps + 3 packages need shared types, configs, and a single install.
**Decision:** pnpm workspaces, no Turborepo/Nx for now.
**Consequences:** All commands use `pnpm --filter`. Strict node_modules will surface phantom deps early. If task caching becomes painful (>30 s CI rebuilds), revisit Turborepo — it layers on top without restructuring.

## ADR-002: Drizzle over Prisma (2026-07-03)

**Context:** ORM choice for a team that must also write recursive CTEs and pgvector queries.
**Decision:** Drizzle ORM; raw SQL allowed in exactly two files (`queries/lineage.ts`, `queries/similarity.ts`).
**Consequences:** SQL-shaped API keeps the team close to Postgres. No Prisma engine binary on the droplet. Migrations via drizzle-kit are plain SQL and reviewable.

## ADR-003: API server and room WS server share one process in V1 (2026-07-03)

**Context:** SRS requires horizontal scalability of the room server (NFR-SCALE-02) but V1 targets only 200 concurrent users on one droplet.
**Decision:** One Fastify instance hosts REST + WS. All room broadcasts go through Redis pub/sub from day one.
**Consequences:** One process to deploy/monitor now; splitting later is a deploy-topology change, not a code change, because no code assumes a local-only socket map.

## ADR-004: Vitest + Playwright; real Postgres in integration tests (2026-07-03)

**Context:** Test stack for a Vite/TS codebase where DB behavior (state machine, CTEs, constraints) is the risk center.
**Decision:** Vitest everywhere, Playwright for 5 critical E2E journeys, Dockerized Postgres+Redis in integration tests, mock only true externals (Anthropic, Daily, GitHub, SMTP).
**Consequences:** Slower integration suite (~minutes) but real constraint/transaction coverage. Canned Anthropic fake keeps grading UI development unblocked and free.

## ADR-005: React Flow (not D3) for the lineage visualiser (2026-07-03)

**Context:** SRS §6.1 allows either.
**Decision:** React Flow — declarative, React-native, custom nodes are just components (post cards as nodes drop straight in).
**Consequences:** Less control over exotic layouts; acceptable — lineage trees are shallow (a handful of generations). Layout via `dagre`.

## ADR-006: Cover images on droplet disk, not object storage (2026-07-03)

**Context:** Only user-uploaded binary in V1 is the optional post cover image (videos/demos are external links by SRS).
**Decision:** Store under `/var/lib/retry/uploads`, re-encoded with sharp, served by Nginx; nightly rsync backup.
**Consequences:** Zero extra cost/complexity. Revisit (DO Spaces) only if uploads exceed disk or a second app server appears — same trigger as ADR-003's split.

## ADR-007: WS auth via one-time ticket, not JWT-in-URL (2026-07-03)

**Context:** Browsers can't set headers on WebSocket connects; tokens in query strings leak into logs.
**Decision:** `POST /rooms/:id/ws-ticket` issues a 30 s single-use ticket; the WS URL carries only the ticket.
**Consequences:** One extra round-trip on room entry; no long-lived credential ever appears in a URL.

## ADR-008: Embedding generation is a separate worker job from grading (2026-07-03)

**Context:** FR-GRADE-09 needs ancestor embeddings at grading time; ancestors may never be submitted for grading themselves.
**Decision:** Embeddings are generated on **publish** (every published post), by an `embedding` queue job; the grading job only reads them.
**Consequences:** Similarity data is ready before any descendant submits. Publish gets a small async cost. Embedding model choice is isolated in the embedding worker; vector dimension pinned in `post_embeddings` (1024) — changing models requires a re-embed migration, noted here when it happens.

## ADR-009: Argon2id for password hashing (2026-07-03)

**Context:** FR-AUTH requirements name no algorithm; bcrypt is the tutorial default.
**Decision:** argon2id with OWASP-recommended parameters.
**Consequences:** Current best practice, memory-hard. The `argon2` npm package needs a native build on the droplet (prebuilt binaries cover Ubuntu 22.04).

## ADR-010: Adopt the team's Figma design as the V1 design system (2026-07-05)

**Context:** Two candidate design directions existed: a standalone `retry-design-system.html` token sheet and the team's Figma file (`YOK9jClUSuv3QVDYhNugpJ`). The user confirmed the Figma file does **not** follow the HTML sheet and the HTML file is void. Validation of all Figma frames (Feed, Idea Hub Open Ideas + Feature Requests, Compose, Notifications, Profile — each in light and dark) against the SRS found it exceptionally SRS-faithful: post cards carry upvotes/comments/fork-count/bookmark/grade badge/fork attribution; Feed implements all five SRS modes plus the seniors strip (FR-FEED-05); Compose is the §6.1 split-pane editor with a non-gating readiness checklist (FR-POST-08); Idea Hub covers the claim lifecycle (FR-IDEA-03/04) and FR scope badges (FR-IDEA-08–12); Profile shows lineage stats and derived skills (FR-PROFILE-02/03).
**Decision:** Adopt the Figma design as the single design source of truth. Delete `retry-design-system.html`. Because the file defines no Figma variables, extract colors/typography/spacing from the frames into the Tailwind v4 theme in `apps/web` — the Tailwind theme file becomes the canonical token record.
**Consequences:** Frontend work styles directly against extracted tokens. Known design debt to hand back to the designer before Phases 3–4: post detail page, lineage tree view, faculty grading panel, room Workspace + Live Space, auth/onboarding, admin screens, mobile layouts. Two small post-card additions required to satisfy FR-POST-09: a domain tag and a Live Demo button.

## ADR-011: Renamed Foundry → Retry (2026-07-25)

**Context:** The product shipped its first six rooms phases under the working name **Foundry**. Before beta testers see it, the team settled on **Retry** — the name a student gives the second attempt at a project, which is what the lineage/fork model is actually about. A domain has not been chosen yet; availability decides it.
**Decision:** Rename every layer in one mechanical pass: package scope `@foundry/*` → `@retry/*`, the root package, spec filenames (`foundry_srs.md` → `retry_srs.md` and siblings), env vars, systemd/service names, deploy paths, the refresh-cookie name, the localStorage key, and all user-facing copy. **No domain is hard-coded anywhere** — `API_BASE_URL`/`WEB_BASE_URL` remain environment variables and the deploy docs say `<domain>`, so choosing the domain later is a config change, not a code change. This ADR is the one place the old name is kept on purpose, so the git history stays readable.
**Consequences:** Local dev needs `pnpm install` (package scope changed) and a one-time database rename (`ALTER DATABASE`/`ALTER ROLE`), not a volume wipe. Existing dev refresh cookies and the persisted mic/cam localStorage entry are invalidated once — both re-create themselves on next use. Commits before this one refer to Foundry; that is expected.

## ADR-012: Self-hosted LiveKit replaces Daily.co for room AV (2026-07-25)

**Context:** SRS FR-ROOM-29 names Daily.co explicitly ("The platform shall use Daily.co for all WebRTC audio and video. No custom WebRTC implementation shall be built"). Phase 5 shipped against it and works, but live AV never got exercised: the Daily account is blocked on `account-missing-payment-method`. Meanwhile the target population grew to 4000–5000 NTTF students across India, where Daily's per-participant-minute pricing is the one unbounded variable cost in a project whose entire infrastructure budget is ~$39/month.
**Decision:** Replace Daily.co with **self-hosted LiveKit** behind the existing `AvProvider` interface. The second half of FR-ROOM-29 — "no custom WebRTC implementation shall be built" — is honoured and is the requirement that actually mattered; LiveKit is an established open-source SFU, not a bespoke stack. The provider swap is contained: `av/livekit.ts` implements the same interface, and `avToken` carries `{serverUrl, room, token}` instead of `{roomUrl, token}`.
**Consequences:** Cost becomes a fixed VPS line rather than usage-based, and media stays on infrastructure the college controls — which also removes a student-data-leaves-the-country question. Minting a grant is now **local JWT signing with no REST round-trip**, so the Daily room-creation cache and its failure modes are gone and a third-party outage is no longer in the room-entry path. LiveKit identity is the Retry userId, deleting the session-id bookkeeping the Daily client needed. In exchange we now operate an SFU: a VPS with a public IP, TLS for signalling, UDP 50000–60000, and — **treat as mandatory, not optional** — the embedded TURN server on TCP/443, because Indian campus and mobile networks block plain UDP for a meaningful fraction of users. Deployment recipe in `docs/livekit-vps.md`. Until `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` are all set, AV is simply off and the placeholder proximity bubbles remain — the same clean degradation the no-key Daily path had. Recorded as a deviation in `PROGRESS.md`.

---

_Add new entries below. Next number: ADR-013._
