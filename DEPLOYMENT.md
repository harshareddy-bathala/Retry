# DEPLOYMENT.md — Foundry

> Single DigitalOcean droplet + managed PostgreSQL. Deploys are boring on purpose: build on CI, rsync artifacts, restart systemd units.

---

## 1. Topology

| What | Where |
|---|---|
| Nginx (TLS, routing) | Droplet — 2 vCPU / 4 GB, Ubuntu 22.04 (~$24/mo) |
| `foundry-api` (REST + room WS) | Droplet, systemd, port 3000 |
| `foundry-worker` (BullMQ consumers) | Droplet, systemd |
| `foundry-tldraw` (whiteboard sync) | Droplet, systemd, port 3001 |
| Static frontend (Vite build) | Droplet, served by Nginx from `/var/www/foundry` |
| Redis 7 | Droplet, localhost-only bind, password auth |
| PostgreSQL 15 + pgvector | DO Managed (~$15/mo), private networking, connection pool ≤20 (1 GB instance!) |

Budget: ~$39/mo; $200 credit ≈ 5 months free. Fallback: college server (4 core/8 GB) — stack is plain Node + Postgres, portable by design.

## 2. Nginx Routing

```
foundry.<domain>            → /var/www/foundry (SPA, try_files → index.html)
/api/*                      → 127.0.0.1:3000
/rooms/*/ws                 → 127.0.0.1:3000  (Upgrade headers, proxy_read_timeout 120s)
/tldraw/*                   → 127.0.0.1:3001  (Upgrade headers)
HTTP → HTTPS 301 redirect (NFR-SEC-01); certs via certbot/Let's Encrypt with auto-renew
Client body limit 5 MB (cover images); gzip on; HSTS on
/uploads/* → /var/lib/foundry/uploads (cover images, immutable cache headers)
```

## 3. Environments

| Env | Where | Notes |
|---|---|---|
| dev | each laptop | docker compose Postgres+Redis+Mailpit; `.env` local |
| staging | same droplet, `staging.` subdomain, ports 4000/4001, separate DB database + Redis db index | deployed on merge to `main` |
| production | droplet | deployed by tagging `v*` (manual promote) |

Secrets live in `/etc/foundry/api.env` (root-owned, 600), loaded via systemd `EnvironmentFile`. Never in the repo, never in CI logs. The variable list is `.env.example`.

## 4. CI/CD (GitHub Actions)

**On PR:** lint, typecheck, tests, migration check (see `TESTING.md`).

**On merge to `main` → deploy-staging.yml:**
1. `pnpm install --frozen-lockfile && pnpm build`
2. rsync `apps/web/dist` and `apps/api/dist` + `packages/db/migrations` to droplet (SSH deploy key)
3. Run migrations: `node migrate.js` (against staging DB)
4. `systemctl restart foundry-api-staging foundry-worker-staging`
5. Smoke check: `curl /api/health` expects 200 with `{db: ok, redis: ok}`

**On tag `v*` → deploy-prod.yml:** same steps against production, plus:
- Migrations run **before** restart; migrations must be backward-compatible with the currently-running code (expand → migrate → contract pattern for destructive changes)
- Sentry release created with sourcemaps
- `CHANGELOG.md` entry required (CI checks the tag appears in it)

Rollback: `git tag` previous version and re-run deploy-prod; DB rollbacks are **not** automated — write forward-fixing migrations.

## 5. systemd Units

Each unit: `Restart=always`, `RestartSec=3`, memory limits (`api` 1.5G, `worker` 1G, `tldraw` 512M), `EnvironmentFile=/etc/foundry/*.env`, logs to journald (shipped to New Relic).

Worker concurrency: grading jobs are heavy (repo clone + Tree-sitter + LLM call) — **concurrency 2** on the 4 GB droplet. Queue depth is the scaling signal, exposed at `/api/admin/health`.

## 6. Backups & Monitoring

- DO Managed Postgres: daily automated backups, 30-day retention — **verify a restore once per semester** (NFR-REL-03).
- Redis: not backed up. Everything in Redis is reconstructible (cache, presence, queue re-enqueue). BullMQ job loss on Redis failure is acceptable at this scale — failed grading is retriable from the faculty UI.
- Uploads (`/var/lib/foundry/uploads`): nightly cron rsync to DO Spaces or a second disk.
- New Relic: droplet metrics + APM on the API (alert: p95 > 1s, disk > 80%, memory > 85%).
- Sentry: frontend + backend errors; alert on new issue in production.
- Uptime: New Relic synthetic ping on `/api/health` every minute; target 99.5% during Aug–May (NFR-REL-01). Planned maintenance: outside class hours, 48 h notice.
- Daily.co usage: admin checks participant-minutes weekly against free-tier (the one variable cost).
