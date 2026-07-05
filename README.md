# Foundry

**College project archival, collaboration, and evaluation platform** — built for NTTF NEC Bangalore by a 5-member final-year team over 12 months.

Students post projects throughout their academics. Projects form a fork lineage. Faculty grade with AI assistance and human approval. Teams collaborate in project-aware rooms with an optional 2D live space. An Idea Hub surfaces unbuilt ideas.

## Documentation Map

**Start here:** [CLAUDE.md](CLAUDE.md) — hard rules and authoritative context (for humans too, not just AI).

| Understand the product | Build it | Team process | Plan & status |
|---|---|---|---|
| [Problem & Solution](foundry_problem_and_solution.md) | [TECH_STACK.md](TECH_STACK.md) | [CONTRIBUTING.md](CONTRIBUTING.md) | [ROADMAP.md](ROADMAP.md) |
| [SRS (full requirements)](foundry_srs.md) | [ARCHITECTURE.md](ARCHITECTURE.md) | [CONVENTIONS.md](CONVENTIONS.md) | [PROGRESS.md](PROGRESS.md) |
| | [DATABASE.md](DATABASE.md) | [TESTING.md](TESTING.md) | [DECISIONS.md](DECISIONS.md) |
| | [API.md](API.md) | [SECURITY.md](SECURITY.md) | [CHANGELOG.md](CHANGELOG.md) |
| | [WEBSOCKET_EVENTS.md](WEBSOCKET_EVENTS.md) | [DEPLOYMENT.md](DEPLOYMENT.md) | |

AI-assisted development: domain skills live in `.claude/skills/` (backend, frontend, database, realtime, grading, testing).

## Status

**Phase 0 — Foundations.** Documentation complete; code scaffold is the current task. See [PROGRESS.md](PROGRESS.md).

## Quick Start (once scaffolded)

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm --filter db migrate && pnpm --filter db seed
pnpm dev
```

Full setup: [CONTRIBUTING.md](CONTRIBUTING.md) §1.
