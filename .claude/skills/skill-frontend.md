# Skill: Frontend Components & Features

Use when working under `apps/web/src/`. Read `CONVENTIONS.md` §4 first.

## Recipe for a new feature view

1. Work inside `src/features/<domain>/` — components, hooks, and api functions colocated. Promote to `src/components/` only on 2nd consumer.
2. Data: define query hooks wrapping the shared client:
   ```ts
   export function usePost(slug: string) {
     return useQuery({ queryKey: ['posts', slug], queryFn: () => api.get(`/posts/${slug}`) });
   }
   ```
   Query keys: `['domain', ...identifiers]`. Mutations invalidate by prefix (`['posts']`) or `setQueryData` for optimistic updates (upvotes, saves, kanban).
3. Forms: react-hook-form + `zodResolver` with the **same schema from `packages/types`** the API validates with. Client and server can never disagree on validation.
4. Every data view ships loading (skeleton, not spinner), error, and empty states.
5. UI primitives: Radix + Tailwind via existing `src/components` (Button, Dialog, Tabs, Toast, DropdownMenu). Don't hand-roll accessible widgets.

## Checklist

- [ ] No `any`; no default exports (except lazy route components)
- [ ] Server state in TanStack Query only — no server data in context/useState
- [ ] `fetch` only via `src/lib/api.ts` (handles auth header, refresh retry, error envelope)
- [ ] Markdown rendered through the shared `<Markdown>` component (react-markdown + rehype-sanitize) — never `dangerouslySetInnerHTML`
- [ ] No direct DOM manipulation; refs only for Phaser mount / tldraw container (Hard Rule 8)
- [ ] Tailwind classes through `cn()`; class order per CONVENTIONS.md
- [ ] Errors → Sentry; no `console.log`
- [ ] Role-gated UI is cosmetic only — the API is the real gate; hide faculty links from students but never rely on it
- [ ] Feed/post views usable at 375 px (rooms are desktop-only by design)

## Domain notes

- **Feed**: five modes are URL state (`?mode=trending`); filters persist in session storage. Infinite scroll via `useInfiniteQuery` + intersection observer, 20/page.
- **Post editor**: split-pane Markdown with live preview; Readiness Checklist renders only in Draft and is purely informational.
- **Lineage**: React Flow with post-card custom nodes, `dagre` layout, node color by project type; clicking a node navigates.
- **Rooms**: `useRoomSocket(roomId)` is the single WS owner; incoming events patch the Query cache so Workspace panels re-render from one source of truth. Server echo is authoritative — render chat/kanban from the echo, not local input.
- **Live Space**: Phaser mounts in a fixed-aspect container via ref; React overlays (chat, video bubbles) position from canvas-emitted coordinates. Keep Phaser state out of React state — bridge via an event emitter.
