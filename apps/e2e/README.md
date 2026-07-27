# The rooms drive

Two committed checks that need a **running stack**, which is why they are not
in CI and not in `pnpm -r test`:

| Command | What it does |
|---|---|
| `pnpm --filter @retry/e2e drive` | Two browsers in one room: presence, nearby speech, room chat, typing, Escape, walking. Plus the phone gate. |
| `pnpm --filter @retry/e2e load` | 50 headless sockets moving in one map; reports p50/p95/p99 broadcast latency against the 150 ms budget (NFR-PERF-06). |

## Before you run either

```bash
pnpm --filter @retry/maps assets:check   # the licensed pack must be built
pnpm dev                                 # api + room-server + web, and docker compose up
```

The drive registers its own students through the real API and verifies them
through Mailpit, so it needs `docker compose up` for Postgres and Mailpit. It
does not seed the database and does not reuse accounts between runs — every run
is a fresh cohort, which is the only way the registration path stays tested.

## Why it drives Edge

`channel: 'msedge'`. The pack, the stack and the browser are all local
prerequisites here; adding a 150 MB Chromium download to a repo that already
requires a paid art pack helps nobody, and Edge is on every Windows machine
this project is developed on. Set `E2E_WEB_URL` if your Vite port differs.

## What it deliberately does not test

Rate limits, invalid emote keys, membership gates, knock flows. Those are
cheaper, sharper and faster one layer down, in `apps/room-server/test`. This
suite is for the things that only break when the pieces are assembled.
