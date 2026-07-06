# Changelog

All notable changes to Foundry. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once releases begin. Each production deploy tag (`v*`) must have an entry here (CI-enforced, see `DEPLOYMENT.md`).

## [Unreleased]

### Added
- Phase 0 scaffold: pnpm monorepo (`apps/api`, `apps/web`, `packages/db|types|config`), docker-compose dev stack, CI workflow (2026-07-06)
- Auth vertical slice: college-email registration with verification, argon2id + JWT login, rotating refresh-token families, password reset, student onboarding, `requireRole()` RBAC — FR-AUTH-01/02/03/04/07/08 (2026-07-06)
- Frontend shell styled with Figma design tokens (ADR-010): login, signup, verify, reset, onboarding pages + app shell, dark/light themes (2026-07-06)
- Complete project documentation suite: TECH_STACK, ARCHITECTURE, DATABASE, API, WEBSOCKET_EVENTS, CONVENTIONS, CONTRIBUTING, TESTING, DEPLOYMENT, SECURITY, DECISIONS, ROADMAP, PROGRESS (2026-07-03)
- Claude AI context: CLAUDE.md and domain skills in `.claude/skills/` (2026-07-03)
- `.env.example` environment variable contract (2026-07-03)
