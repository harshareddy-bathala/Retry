# Skill: Database & Schema Changes

Use when touching `packages/db/`. Read `DATABASE.md` first — it is the schema contract.

## Recipe for a schema change

1. Edit `packages/db/src/schema.ts` (single file, all tables).
2. `pnpm --filter db generate` → **read the generated SQL** before committing. drizzle-kit occasionally generates drop-and-recreate where an ALTER was intended.
3. Update `DATABASE.md` tables/enums in the same PR.
4. If seed data is affected, update `seed.ts`.
5. Never edit a merged migration — write a new one. Destructive prod changes use expand → migrate → contract (see DEPLOYMENT.md §4).

## Rules

- snake_case tables/columns; uuid PKs; `created_at` everywhere, `updated_at` only on mutable rows
- New enum value = new migration with `ALTER TYPE ... ADD VALUE` (cannot run inside a transaction — drizzle-kit needs the `--no-transaction` annotation)
- Every FK declares `ON DELETE` intentionally: cascade for owned children (room content, post social rows), restrict for referenced actors (users), set null for optional refs
- Unique constraints over service-layer checks for one-per-user facts (upvotes, saves, follows, membership)
- Denormalised counters (`upvote_count`, `fork_count`, `comment_count`) exist for feed performance — they are maintained transactionally in services, never by trigger
- **No soft deletes. No attendance/session tables — ever** (rooms are ephemeral-presence by SRS design)
- `posts.parent_post_id` is immutable after insert; `grades` rows are immutable after `approved_at` is set

## Raw SQL — the only two homes

- `queries/lineage.ts` — recursive CTEs (ancestors/descendants with depth). Canonical SQL in SRS §8.2.
- `queries/similarity.ts` — pgvector cosine similarity scoped to ancestor IDs (SRS §8.3).

Both use parameter placeholders exclusively. Anything else needing raw SQL → redesign it as Drizzle, or make the case in `DECISIONS.md` first.

## Testing schema changes

- Migration must apply cleanly in the CI scratch-DB check
- Constraint behavior (uniques, checks, cascades) gets an integration test when it encodes a business rule — e.g. `UNIQUE(post_id, user_id)` on upvotes, follow self-reference CHECK
- Seeded lineage tree (4 generations) must keep `lineage.test.ts` green
