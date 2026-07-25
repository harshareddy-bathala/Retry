# DEPLOYMENT.md — Retry

> Single DigitalOcean droplet + managed PostgreSQL. Deploys are boring on purpose: build on CI, rsync artifacts, restart systemd units.

---

## 1. Topology

| What | Where |
|---|---|
| Nginx (TLS, routing) | Droplet — 2 vCPU / 4 GB, Ubuntu 22.04 (~$24/mo) |
| `retry-api` (REST) | Droplet, systemd, port 3000 |
| `retry-worker` (BullMQ consumers) | Droplet, systemd |
| `retry-room-server` (world WS **and** tldraw whiteboard sync) | Droplet, systemd, port 4100 |
| Static frontend (Vite build) | Droplet, served by Nginx from `/var/www/retry` |
| Redis 7 | Droplet, localhost-only bind, password auth |
| PostgreSQL 15 + pgvector | DO Managed (~$15/mo), private networking, connection pool ≤20 (1 GB instance!) |
| LiveKit SFU (rooms AV) | **Separate VPS, not yet provisioned** — see `docs/livekit-vps.md` |

The room server is its own process (`apps/room-server`), not part of the API: it holds the
authoritative world state, the proximity engine, and the tldraw sync rooms. It hosts both WebSocket
endpoints — `/ws` for the world and `/whiteboard` for tldraw — so there is no separate tldraw
service. It shares `JWT_SECRET` with the API so access tokens verify on both.

Budget: ~$39/mo for the app droplet + managed Postgres, plus one VPS for LiveKit when AV goes live. $200 credit ≈ 5 months free. Fallback: college server (4 core/8 GB) — stack is plain Node + Postgres, portable by design.

## 2. Nginx Routing

```
retry.<domain>            → /var/www/retry (SPA, try_files → index.html)
/api/*                      → 127.0.0.1:3000
/ws                         → 127.0.0.1:4100  (Upgrade headers, proxy_read_timeout 120s)
/whiteboard                 → 127.0.0.1:4100  (Upgrade headers, proxy_read_timeout 120s)
HTTP → HTTPS 301 redirect (NFR-SEC-01); certs via certbot/Let's Encrypt with auto-renew
Client body limit 5 MB (cover images); gzip on; HSTS on
/uploads/* → /var/lib/retry/uploads (cover images, immutable cache headers)
```

## 3. Environments

| Env | Where | Notes |
|---|---|---|
| dev | each laptop | docker compose Postgres+Redis+Mailpit; `.env` local |
| staging | same droplet, `staging.` subdomain, ports 4000/4001, separate DB database + Redis db index | deployed on merge to `main` |
| production | droplet | deployed by tagging `v*` (manual promote) |

Secrets live in `/etc/retry/api.env` (root-owned, 600), loaded via systemd `EnvironmentFile`. Never in the repo, never in CI logs. The variable list is `.env.example`.

## 4. CI/CD (GitHub Actions)

**On PR:** lint, typecheck, tests, migration check (see `TESTING.md`).

**On merge to `main` → deploy-staging.yml:**
1. `pnpm install --frozen-lockfile && pnpm build`
2. rsync `apps/web/dist` and `apps/api/dist` + `packages/db/migrations` to droplet (SSH deploy key)
3. Run migrations: `node migrate.js` (against staging DB)
4. `systemctl restart retry-api-staging retry-worker-staging`
5. Smoke check: `curl /api/health` expects 200 with `{db: ok, redis: ok}`

**On tag `v*` → deploy-prod.yml:** same steps against production, plus:
- Migrations run **before** restart; migrations must be backward-compatible with the currently-running code (expand → migrate → contract pattern for destructive changes)
- Sentry release created with sourcemaps
- `CHANGELOG.md` entry required (CI checks the tag appears in it)

Rollback: `git tag` previous version and re-run deploy-prod; DB rollbacks are **not** automated — write forward-fixing migrations.

## 5. systemd Units

Each unit: `Restart=always`, `RestartSec=3`, memory limits (`api` 1.5G, `worker` 1G, `room-server` 1G), `EnvironmentFile=/etc/retry/*.env`, logs to journald (shipped to New Relic).

Worker concurrency: grading jobs are heavy (repo clone + Tree-sitter + LLM call) — **concurrency 2** on the 4 GB droplet. Queue depth is the scaling signal, exposed at `/api/admin/health`.

## 6. Backups & Monitoring

- DO Managed Postgres: daily automated backups, 30-day retention — **verify a restore once per semester** (NFR-REL-03).
- Redis: not backed up. Everything in Redis is reconstructible (cache, presence, queue re-enqueue). BullMQ job loss on Redis failure is acceptable at this scale — failed grading is retriable from the faculty UI.
- Uploads (`/var/lib/retry/uploads`): nightly cron rsync to DO Spaces or a second disk.
- New Relic: droplet metrics + APM on the API (alert: p95 > 1s, disk > 80%, memory > 85%).
- Sentry: frontend + backend errors; alert on new issue in production.
- Uptime: New Relic synthetic ping on `/api/health` every minute; target 99.5% during Aug–May (NFR-REL-01). Planned maintenance: outside class hours, 48 h notice.
- LiveKit (when provisioned): Prometheus metrics from the SFU; alert on CPU and on participant count approaching the sizing in `docs/livekit-vps.md`. Self-hosted means a fixed VPS cost, not per-minute billing — there is no usage meter to watch (ADR-012).
