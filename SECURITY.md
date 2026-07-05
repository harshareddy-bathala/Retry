# SECURITY.md — Foundry

> Security posture and the concrete rules that implement it. Every item here maps to an NFR-SEC requirement or a hard rule in CLAUDE.md.

---

## 1. Authentication

- **College email only**: registration restricted to `@nttf.co.in` (configurable via `ALLOWED_EMAIL_DOMAIN`). Domain checked server-side at signup; account inactive until the emailed verification link is clicked (FR-AUTH-01/02).
- Passwords: **argon2id** (memory 19 MiB, iterations 2, parallelism 1 — OWASP defaults). Min length 10; checked against a small common-password list. No composition rules.
- **JWT via `jose`**: access token 7 d, refresh token 30 d (FR-AUTH-03). Access tokens carry `{ sub, role }` and are stateless. Refresh tokens are opaque, stored **hashed** in `refresh_tokens`, rotated on every use; reuse of a rotated token revokes the whole family.
- Storage on the client: access token in memory, refresh token in an `httpOnly; Secure; SameSite=Strict` cookie scoped to `/api/auth`. Never localStorage.
- Password reset + email verification tokens: single-use, 1 h TTL, hashed at rest.
- Faculty/admin accounts are created by admin only — no self-registration path can produce a privileged role (FR-AUTH-05).

## 2. Authorization (RBAC)

- Enforced **only** in `requireRole()` middleware at the route layer (Hard Rule 6, NFR-SEC-05). Role comes from the verified JWT, never from headers, body, or query.
- Ownership/membership checks (author-of-post, member-of-room) happen in services immediately after load, before any mutation — 403 on failure, 404 if the resource shouldn't be visible at all.
- The RBAC matrix is tested exhaustively (`rbac.int.test.ts`, see TESTING.md §3.2).
- Room privacy: faculty and non-members have **no** read path to any room data. Pending grades have no student-visible read path until approval.

## 3. Input Handling & XSS

- Every route input parses through Zod (Hard Rule 4). Unknown keys stripped (`.strict()` on all schemas).
- **Stored XSS defense (NFR-SEC-04), two layers:**
  1. On write: sanitize Markdown-bearing fields (descriptions, comments, chat, blueprint) with `sanitize-html` — strip scripts/event handlers/iframes.
  2. On render: `react-markdown` + `rehype-sanitize` with an explicit allowlist. Never `dangerouslySetInnerHTML`.
- URLs (`github_url`, `demo_url`, `demo_video_url`): must parse as `https:` URLs; `github_url` must be a `github.com` repo path. Demo links open with `rel="noopener noreferrer" target="_blank"` — they are untrusted third-party pages by design.
- Cover image uploads: max 2 MB, content-type sniffed (magic bytes, not extension), re-encoded via `sharp` on upload (strips EXIF + neutralizes polyglots), served from `/uploads` with `Content-Disposition` safe defaults and no execute permissions.
- SQL injection: Drizzle parameterizes everything; the two raw-SQL files use parameter placeholders only — never string interpolation (CI grep for `${` inside those files' SQL templates).

## 4. Secrets (NFR-SEC-03)

- All secrets from environment only (Hard Rule 3). Canonical list: `.env.example`. Production: `/etc/foundry/*.env`, root-owned `600`.
- Never logged: the Pino logger has redact paths for `authorization`, `password`, `token`, `apiKey`. Sentry `beforeSend` scrubs the same.
- DO Managed Postgres and droplet disks are encrypted at rest by the provider; app-level AES-256 applies to any stored third-party token (GitHub OAuth tokens in DB, if/when per-student tokens land — encrypted with `SECRET_ENCRYPTION_KEY`).
- Key rotation: JWT signing secret and encryption key rotatable via dual-key envelope (`JWT_SECRET`, `JWT_SECRET_PREVIOUS`).

## 5. Realtime & Third-Party

- **WS auth**: one-time 30 s ticket from `POST /rooms/:id/ws-ticket`; JWTs never in URLs (they leak via logs/referrers). Membership re-verified on connect; removal from a room force-closes the socket.
- **Daily.co (NFR-SEC-02)**: meeting tokens are scoped per-room, per-user, per-session, short-lived (2 h), minted server-side only. Removing a member revokes their token and ejects them via Daily REST API. No recordings — disabled at Daily domain level (FR-ROOM-32).
- **Grading worker repo clones**: `git clone --depth 1` into a tmp dir, 200 MB size cap, 60 s clone timeout, deleted after analysis. Cloned code is **data, never executed** — Tree-sitter parses it; no `npm install`, no running student code. The Anthropic prompt treats repo content as untrusted (prompt-injection from a README must not change grading-tool behavior — the worker has no tools, single structured completion only).
- Rate limits (`@fastify/rate-limit`, Redis-backed): auth endpoints 5/min/IP; writes 30/min/user; reads 300/min/user; WS `avatar:move` 15/s/connection (server-side).

## 6. Transport & Headers

- HTTPS everywhere; HTTP → 301 (NFR-SEC-01). TLS via Let's Encrypt. HSTS `max-age=31536000`.
- `@fastify/helmet`: CSP (`default-src 'self'`; `connect-src` self + Sentry + Daily; `frame-src` Daily), `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`.
- CORS: exact origin allowlist (prod domain + staging), credentials on.

## 7. Incident Response (student-team scale)

1. Sentry/New Relic alert → whoever is on rotation triages within the day.
2. Credential leak → rotate the affected secret, revoke all refresh tokens (`revoked_at = now()` sweep), post-mortem note in `DECISIONS.md`.
3. Vulnerable dependency → Dependabot PRs auto-open; security-labelled ones merge within 72 h.
4. Data incident affecting students → inform the faculty sponsor immediately; the college owns disclosure.
