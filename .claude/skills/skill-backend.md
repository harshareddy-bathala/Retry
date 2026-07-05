# Skill: Backend Routes & Services

Use when creating or modifying anything under `apps/api/src/routes/` or `apps/api/src/services/`.

## Recipe for a new endpoint

1. Define the Zod schema in `packages/types/src/<domain>.ts` (input + response). Derive TS types with `z.infer`. Add any new error codes to `packages/types/src/errors.ts`.
2. Add the service function in `apps/api/src/services/<domain>.service.ts`:
   - Load the resource, check ownership/membership/state **before** mutating
   - Throw `new AppError('CODE', status, 'human message')` — never throw raw
   - Multi-write → `db.transaction()`; update denormalised counters inside it
3. Register the route in `apps/api/src/routes/<domain>.routes.ts`:
   ```ts
   app.post('/posts/:id/submit', {
     preHandler: [requireAuth, requireRole(['student'])],
   }, async (req, reply) => {
     const params = submitParamsSchema.parse(req.params);
     const result = await postsService.submit(params.id, req.user);
     return reply.code(200).send(result);
   });
   ```
4. Update `API.md` (same PR). Add service tests; add one happy + one 403 route test.

## Checklist (every route PR)

- [ ] Zod parse on body/query/params — no raw `request.body` (Hard Rule 4)
- [ ] `requireRole()` in preHandler — zero role checks in service/handler bodies (Hard Rule 6)
- [ ] Errors: typed envelope only; unexpected → Sentry + `INTERNAL_ERROR` (Hard Rule 5)
- [ ] No Anthropic import (Hard Rule 2 — worker only)
- [ ] Drizzle only; raw SQL belongs solely in `packages/db/src/queries/` (Hard Rule 7)
- [ ] Logging via `lib/logger.ts`, object-first, no secrets (Hard Rule 10)
- [ ] State transitions go through the transition table in the service, never `status` assignment
- [ ] Cursor pagination on lists (`?cursor&limit`, default 20)
- [ ] SRS ID cited in a comment for requirement-driven behavior

## Sharp edges

- Post editing must 409 when status is `submitted`/`graded` — check state, not just ownership.
- `frozen_demo_url`: written only if currently null, on first submit. Withdraw never clears it (FR-POST-05).
- Comment replies: reject if the parent comment already has a `parent_comment_id` (one level, FR-SOCIAL-03).
- Idea claims: guard with a conditional UPDATE (`WHERE claimed_by_id IS NULL`) — two students clicking claim must produce exactly one winner.
- Faculty have NO access to room routes; students have NO access to pending grades. When in doubt, check the role tables in CLAUDE.md.
- Alumni can comment/upvote/post open ideas — but never fork, claim, create posts, or touch rooms.
