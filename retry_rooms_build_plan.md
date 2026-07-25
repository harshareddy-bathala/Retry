# Retry — Collaboration Rooms
## Phased Build Plan & Fable 5 Prompts

**Build order is not negotiable.** Each phase produces a working, demoable artifact and every later phase depends on contracts established earlier. Do not start Phase N+1 until Phase N passes its acceptance criteria.

---

## Architecture Decisions (locked before Phase 0)

| Decision | Choice | Rationale |
|---|---|---|
| World topology | Multi-map: one **Commons** map + N **Room** maps | Enables the office-floor metaphor |
| Spawn behaviour | User spawns inside their last-active room; exits via door to Commons | Room is the home, Commons is the corridor |
| Private rooms | No door rendered in Commons; unlisted; invite-only | Privacy by absence, not by lock |
| Public room access | Door carries a policy: `open` / `knock` / `invite_only` | Gate at the door, not at the map |
| Project awareness | **Derived read-model.** No FK from `rooms` to `posts` | Preserves SRS §4.7 room/post independence |
| Position authority | Server-authoritative broadcast, client-side interpolation | SRS FR-ROOM-16 forbids P2P |
| AV integration point | Phase 5, after portals exist | Avoids rebuilding session handoff |

### Data model delta (additions to SRS §8.1)

```
rooms
  + visibility        enum('public','private')      default 'private'
  + access_policy     enum('open','knock','invite_only') default 'invite_only'
  + door_x, door_y    int, nullable    -- position in Commons; NULL if private
  + map_template      text             default 'studio_a'

room_members
  + current_map_id    text, nullable   -- 'commons' or the room id

room_access_requests   -- NEW (knock flow)
  id, room_id, requester_id, status enum('pending','granted','denied'),
  created_at, resolved_at, resolved_by

room_project_context   -- NEW (derived cache, Phase 7)
  room_id PK, summary text, active_card_count int, last_activity_at timestamptz,
  top_contributors jsonb, computed_at timestamptz
```

`room_project_context` is a **cache of computed values**. It is never written by a user. It can be dropped and rebuilt at any time without data loss. This is what keeps you compliant with your own SRS.

---

## PHASE 0 — Foundation & Contracts

No gameplay. This phase exists purely to prevent rework. Skipping it is the single most expensive mistake available here.

```
You are setting up the foundation for a real-time 2D multiplayer collaboration
system called Retry Rooms. This phase produces NO gameplay and NO visuals.
It establishes shared contracts that every later phase depends on.

TECH CONSTRAINTS (fixed, do not substitute):
- Frontend: React 18 + TypeScript + Vite, Phaser 3 for the canvas
- Backend: Fastify + TypeScript, @fastify/websocket
- Database: PostgreSQL 15
- Package manager: pnpm workspaces

DELIVERABLES:

1. Monorepo structure:
   /apps/web        React + Phaser client
   /apps/room-server Fastify WebSocket server
   /packages/protocol  shared TypeScript types (the contract)
   /packages/maps      Tiled map JSON + tileset assets

2. In /packages/protocol, define the complete WebSocket event protocol as
   discriminated unions. Both client and server import ONLY from here.
   Never redefine an event shape locally.

   Client to server:
     { t: 'join',    mapId: string }
     { t: 'move',    x: number, y: number, dir: 'up'|'down'|'left'|'right', moving: boolean }
     { t: 'leave' }
     { t: 'chat',    body: string }

   Server to client:
     { t: 'snapshot', mapId: string, actors: Actor[] }   // full state on join
     { t: 'actorJoin', actor: Actor }
     { t: 'actorMove', userId: string, x: number, y: number, dir: Dir, moving: boolean }
     { t: 'actorLeave', userId: string }
     { t: 'error',   code: string, message: string }

   type Actor = {
     userId: string; displayName: string; sprite: string;
     x: number; y: number; dir: Dir; moving: boolean;
   }

   Include a runtime validator (zod) for every inbound message on BOTH sides.
   An unparseable message must be dropped with a logged warning, never crash
   the connection.

3. Tilemap pipeline:
   - Document the workflow: author maps in Tiled, export as JSON (not TMX)
   - Every map must contain these named layers, exactly:
       'ground'    visual floor tiles
       'objects'   visual props (desks, plants, whiteboard stand)
       'collision' invisible tile layer; any non-empty tile blocks movement
   - Every map must contain an object layer 'spawns' with at least one point
     object named 'default'
   - Write a validation script that loads a map JSON and fails loudly if any
     required layer or the default spawn is missing. Run it in CI.

4. Coordinate system decision, documented in a README:
   - Tile size: 32x32 px
   - The server reasons in TILE coordinates (integers)
   - The client renders in PIXEL coordinates
   - Conversion helpers live in /packages/protocol and are used by both sides
   - Rationale: proximity thresholds in the SRS are specified in tiles

5. A single stub map 'studio_a' with all required layers, and a health-check
   WebSocket endpoint that accepts a connection, echoes a snapshot with zero
   actors, and closes cleanly.

ACCEPTANCE CRITERIA:
- `pnpm build` succeeds across all workspaces with zero TypeScript errors
- Map validation script passes on studio_a and fails on a deliberately
  broken copy
- A websocket client can connect, receive an empty snapshot, and disconnect
  without leaking a server-side handle

DO NOT BUILD YET: rendering, avatars, movement, multiple maps, chat UI,
proximity, database tables.
```

---

## PHASE 1 — Single-Player Room

One room, one avatar, no network. Get the feel right here — movement that feels bad at this stage will feel bad forever.

```
Build the single-player room canvas for Retry Rooms. No networking in this
phase. One local avatar in one map.

BUILD ON: the Phase 0 monorepo, protocol package, and studio_a map.

DELIVERABLES:

1. React-Phaser bridge:
   - A <RoomCanvas /> React component that mounts a Phaser.Game into a ref'd
     div and destroys it correctly on unmount (no double-mount in StrictMode,
     no orphaned canvas, no memory leak on route change)
   - Communication between React and Phaser goes through a typed EventBus
     module. React NEVER reaches into Phaser internals and Phaser NEVER
     imports React components.

2. RoomScene (Phaser.Scene):
   - Load studio_a from the Tiled JSON
   - Render 'ground' and 'objects' layers
   - Build a collision set from the 'collision' layer
   - Camera follows the local avatar with lerp 0.1, and is clamped to map
     bounds so it never shows empty space past the walls

3. Avatar:
   - Sprite sheet with 4 directions x 3 walk frames + 1 idle frame per direction
   - Movement: WASD and arrow keys, both active simultaneously
   - Speed: 4 tiles/second, frame-rate independent (use delta time, never
     assume 60fps)
   - Diagonal movement normalised so it is not faster than cardinal movement
   - Collision resolved per-axis, so sliding along a wall works instead of
     sticking
   - Idle animation plays when input stops, facing the last direction

4. Name tag:
   - A white rounded pill above the avatar with dark text, rendered as a
     Phaser container that follows the sprite
   - Must stay crisp — render text at device pixel ratio, do not scale up a
     low-res texture

5. Interaction affordance:
   - Place a whiteboard object in the map's 'objects' layer with a Tiled
     custom property `interactive: 'whiteboard'`
   - When the avatar is within 1 tile of it, show a floating hint: "Press E"
   - Pressing E emits an EventBus event `interact:whiteboard`. React logs it.
     Nothing else happens yet.

ACCEPTANCE CRITERIA:
- Movement feels responsive with zero input lag
- Walking into a wall slides rather than sticks
- Diagonal speed equals cardinal speed
- Camera never reveals area outside the map
- Navigating away and back does not leak a Phaser instance (verify in
  DevTools memory profiler)
- Movement speed is identical on a 144Hz and a 60Hz display

DO NOT BUILD YET: other players, WebSocket, proximity, video, panels,
multiple maps.
```

---

## PHASE 2 — Multiplayer Sync

```
Add real-time multiplayer to the Retry room from Phase 1. Multiple users
in one map, seeing each other move.

BUILD ON: Phase 1 client, Phase 0 protocol.

DELIVERABLES:

1. Room server (Fastify + @fastify/websocket):
   - A connection registry: Map<mapId, Map<userId, Connection>>
   - On 'join': add to registry, send 'snapshot' of all current actors to the
     joiner, broadcast 'actorJoin' to everyone else in that map
   - On 'move': validate, update authoritative position, broadcast 'actorMove'
     to all OTHER connections in the map (never echo back to the sender)
   - On disconnect (clean or unclean): remove from registry, broadcast
     'actorLeave'
   - Auth: accept a JWT in the connection query string, verify it, derive
     userId from the token. Never trust a userId sent in a message body.

2. Rate limiting and validation, server-side:
   - Cap 'move' messages at 20/second per connection. Excess messages are
     dropped silently, not queued.
   - Reject any move that teleports more than 2 tiles from the last known
     position. Respond with a 'snapshot' to resync the offending client.
   - Reject moves into collision tiles. The server owns the collision map too,
     loaded from the same map JSON the client uses.

3. Client networking layer:
   - A RoomSocket module with automatic reconnect using exponential backoff
     (1s, 2s, 4s, 8s, capped at 30s)
   - Local avatar sends 'move' on a fixed 50ms tick while input is active,
     plus one final message when input stops. Do NOT send on every frame.
   - Local avatar renders from local input immediately (client-side
     prediction). Do not wait for server confirmation to move.

4. Remote avatars:
   - Rendered from 'actorMove' events
   - Interpolate between the last two received positions over 100ms. Never
     snap. Snapping is what makes multiplayer feel cheap.
   - If no update arrives for 200ms, set moving=false so the walk animation
     stops rather than looping in place
   - Remote avatars get name tags identical to the local one

5. Presence UI in React:
   - A member strip showing avatars of everyone currently in the map
   - Updates live on actorJoin / actorLeave

ACCEPTANCE CRITERIA:
- Two browser windows show each other moving smoothly
- Movement propagates in under 150ms on localhost (SRS NFR-PERF-06)
- Killing one browser's network shows that avatar leave within 5 seconds
- Restoring the network reconnects and resyncs position correctly
- A crafted WebSocket message claiming another user's ID is rejected
- A crafted message teleporting across the map is rejected and resynced

DO NOT BUILD YET: proximity, video, portals, panels, persistence.
```

---

## PHASE 3 — Proximity Engine (Placeholder AV)

Real AV is deliberately deferred. This phase builds and proves the *logic*.

```
Build server-side proximity detection for Retry Rooms, with placeholder
video bubbles. No real WebRTC in this phase.

BUILD ON: Phase 2 multiplayer.

DELIVERABLES:

1. Server-side proximity engine:
   - On every position update, compute Euclidean distance in TILE coordinates
     between the moved actor and every other actor in the same map
   - Zone thresholds, from SRS Appendix 11.4:
       distance <= 2   -> 'close'
       distance <= 5   -> 'near'
       distance >  5   -> 'out'
   - Maintain a per-map adjacency map of current pair states

2. Hysteresis — this is the part that is easy to get wrong:
   - A pair transitions to a closer zone at the threshold, but only exits at
     threshold + 0.5 tiles
   - Rationale: an avatar standing exactly on a boundary must not emit a
     rapid stream of enter/exit events. Without this, a user standing still
     at distance 5.0 will flicker in and out of a call.
   - Additionally debounce: a pair must hold a new zone for 300ms before the
     transition is emitted

3. New protocol events (add to /packages/protocol):
     { t: 'proximity', pairs: Array<{ userId: string, zone: 'close'|'near'|'out' }> }
   Emitted to a client only when ITS OWN pair states change. Do not broadcast
   the full adjacency map to everyone.

4. Placeholder bubble UI:
   - For each actor in 'close' or 'near' zone, render a circular bubble
     positioned above their avatar on the canvas
   - 'close' -> 72px diameter, full opacity
   - 'near'  -> 48px diameter, 70% opacity
   - Bubble content: a solid colour block with the user's initials. This
     stands in for a video track.
   - Bubbles follow the avatar smoothly and never overlap the name tag
   - Bubbles must be rendered as a React overlay positioned from Phaser
     coordinates, NOT inside the Phaser canvas. Real video elements in Phase 5
     will be DOM <video> nodes and must live in the same layer.

5. Local AV control state:
   - Mic and camera toggle buttons in the room top bar
   - State persists in localStorage and is restored on rejoin (SRS FR-ROOM-21)
   - Muted state renders as a small icon badge on your own bubble and is
     broadcast so others see it

ACCEPTANCE CRITERIA:
- Walking two avatars together produces exactly one 'near' then one 'close'
  transition, never a burst
- Standing precisely on a zone boundary produces no flicker
- Three avatars in a cluster produce correct pairwise states for all
- A user's bubble list is correct after a reconnect
- Proximity computation for 20 actors in one map completes in under 5ms per
  update (measure it; if it does not, add spatial partitioning before moving on)

DO NOT BUILD YET: Daily.co, real video, portals, panels.
```

---

## PHASE 4 — Multi-Map World: Commons, Doors, Private Rooms

This is the phase that delivers the concept you described.

```
Build the multi-map world for Retry Rooms: a shared Commons space, room
maps, doors between them, and access control.

BUILD ON: Phases 0-3.

WORLD MODEL:
- 'commons' is a single shared map: an office-floor corridor with doors
- Each room is its own map instance
- A user spawns in their last-active room; if none, in the Commons
- A PUBLIC room renders a door in the Commons at (door_x, door_y)
- A PRIVATE room renders NO door anywhere. It is unlisted. It is reachable
  only from the Rooms tab by an invited member. Privacy is by absence from
  the world, not by a locked door.

DELIVERABLES:

1. Schema migration:
   rooms: + visibility enum('public','private') default 'private'
          + access_policy enum('open','knock','invite_only') default 'invite_only'
          + door_x int null, door_y int null
          + map_template text default 'studio_a'
   room_members: + current_map_id text null
   NEW room_access_requests:
     id, room_id, requester_id, status enum('pending','granted','denied'),
     created_at, resolved_at, resolved_by

2. Commons map:
   - Author a 'commons' Tiled map: a corridor/atrium with an array of door
     objects on the 'objects' layer, each with custom property
     `door_slot: <int>`
   - Doors are assigned to public rooms by slot at runtime, not baked into
     the map file
   - A door renders: the room name on a plaque, a small live occupancy count,
     and a lock glyph if access_policy is not 'open'
   - Unassigned door slots render as a plain closed door with no plaque

3. Map transition ('portal') flow:
   - Walking onto a door tile and pressing E initiates a transition
   - Client sends { t: 'transition', toMapId: string }
   - Server checks access policy (below), then:
       a. broadcasts 'actorLeave' to the OLD map
       b. persists last_position for the old map and updates current_map_id
       c. adds the connection to the NEW map registry
       d. sends a fresh 'snapshot' of the new map to the transitioning client
       e. broadcasts 'actorJoin' to the new map
   - The connection is NEVER torn down and re-established. One socket, many
     maps. Re-handshaking on every door would make transitions feel slow.
   - Client plays a 200ms fade-out / fade-in and swaps the Phaser scene's
     tilemap without destroying the Scene instance

4. Access policy enforcement (server-side, always):
   - 'open'        any authenticated student may enter
   - 'knock'       non-members create a room_access_request; every current
                   member gets a live prompt "X wants to join"; any member may
                   grant or deny; granting admits them for that session only
   - 'invite_only' non-members are rejected outright with a clear error
   - Members always enter their own rooms regardless of policy
   - Faculty and Alumni are rejected from ALL rooms (SRS §3.2, §3.3).
     Enforce this at the API layer, not in the UI.

5. Knock UX:
   - Requester sees a waiting state with a cancel option, and a 60s timeout
   - Members see a non-blocking toast with Grant / Deny
   - Denial returns the requester to the Commons with a plain message, never
     a raw error code

6. Proximity and presence become map-scoped:
   - Proximity is computed only among actors sharing a map. Two people in
     different rooms are never in proximity, regardless of tile distance.
   - The Rooms tab presence indicator now reads current_map_id

ACCEPTANCE CRITERIA:
- Walking from a room to the Commons and into another room works with no
  socket reconnect (verify in the Network tab: one persistent WS)
- Transition completes in under 800ms including fade
- A private room's door is absent from the Commons for everyone, including
  its own members
- A knock request reaching a room with zero members online times out cleanly
- Attempting a transition to an invite_only room via a crafted WebSocket
  message is rejected server-side
- Proximity does not leak across maps
- Position in map A is restored correctly after visiting map B and returning

DO NOT BUILD YET: Daily.co, panels, project context.
```

---

## PHASE 5 — Daily.co Integration

```
Replace the placeholder proximity bubbles from Phase 3 with real Daily.co
audio and video.

BUILD ON: Phases 3 and 4. Integrating now, after portals exist, means the
session handoff is built once against the final topology.

DELIVERABLES:

1. Daily.co room provisioning:
   - One Daily room per Retry room map, created lazily on first join and
     cached
   - The Commons gets its own Daily room
   - Tokens are minted server-side, scoped per room AND per session, with a
     short TTL (SRS NFR-SEC-02). The client never sees the Daily API key.
   - On a member being removed or an invite revoked, revoke the token
     immediately

2. Track subscription driven by proximity:
   - Join the Daily call for the current map on map entry, with all tracks
     unsubscribed by default
   - Subscribe to a peer's audio+video only when the proximity engine reports
     'close' or 'near'
   - Unsubscribe on 'out'
   - This is the mechanic: bandwidth scales with proximity, not with room
     population. Do not join a full mesh and hide the streams with CSS.

3. Volume attenuation:
   - 'close' -> gain 1.0
   - 'near'  -> gain 0.5
   - Apply via Web Audio GainNode, ramped over 200ms. An abrupt gain change
     is audible and unpleasant.

4. Map transition handoff:
   - On transition: unsubscribe all, leave the old Daily room, join the new
     one, resubscribe per new proximity state
   - Mic and camera enabled/disabled state carries across the transition
     unchanged
   - Total AV interruption during a transition must stay under 1 second

5. Bubble rendering:
   - Replace the placeholder colour block with a real <video> element in the
     same React overlay layer built in Phase 3
   - Audio-only peers show their avatar sprite with an animated speaking ring
   - Handle the no-camera-permission case gracefully: initials, never a black
     rectangle

6. Guardrails:
   - No recording, no transcripts, nothing persisted (SRS FR-ROOM-22)
   - Log participant-minutes to a counter so free-tier usage can be monitored
     (SRS §3.4)

ACCEPTANCE CRITERIA:
- Two users walking together connect audio within 1 second
- Walking apart disconnects cleanly with no lingering audio
- A user in a 5-person room subscribed to 1 nearby peer shows bandwidth
  proportional to 1 peer, not 4 (verify in chrome://webrtc-internals)
- Volume ramps audibly and smoothly between zones
- Walking through a door and back does not require re-granting camera
  permission
- Denying camera permission entirely leaves the room fully usable

DO NOT BUILD YET: panels, project context.
```

---

## PHASE 6 — Persistent Panels

```
Build the four persistent panels for Retry Rooms: chat, Kanban, whiteboard,
and activity log. All state persists in PostgreSQL.

BUILD ON: Phases 0-5.

DELIVERABLES:

1. Panel shell:
   - A right-side rail with four icons, matching the design frames
   - Exactly one panel open at a time; opening another replaces it
   - Panels overlay the canvas. The canvas stays live and the avatar stays
     visible; movement input is captured by the panel while it holds focus
   - Escape closes the active panel and returns input to the canvas

2. Chat (SRS FR-ROOM-23 to 26):
   - Table: room_messages (id, room_id, sender_id, body, created_at)
   - Plain text only. Sanitise on write AND on render (SRS NFR-SEC-04).
   - Full history loads for any member, including those who joined later
   - Live delivery over the existing WebSocket, not a separate channel
   - Paginate history at 50 messages with scroll-up loading
   - Unread badge on the rail icon when the panel is closed

3. Kanban (SRS FR-ROOM-30 to 32):
   - Table: kanban_cards (id, room_id, column, title, description,
     assignee_id, position, created_at)
   - Three default columns, names editable by any member
   - Drag to reorder and move between columns
   - Use fractional indexing for `position`, not integer reindexing.
     Integer reindexing rewrites every row on each drag and will race between
     two users dragging simultaneously.
   - All mutations broadcast over WebSocket for live sync

4. Whiteboard (SRS FR-ROOM-27 to 29):
   - Self-hosted tldraw sync server
   - Document persisted to rooms.whiteboard_state as JSONB
   - Opens as a full-screen overlay, triggered by the E-press on the
     whiteboard object from Phase 1, or from the rail
   - Debounce persistence to at most one write per 5 seconds

5. Activity log (SRS FR-ROOM-07 to 10):
   - Table: room_sessions (id, room_id, user_id, joined_at, left_at)
   - Written on map entry and exit, including transitions between maps
   - Reverse-chronological list: name, joined, left or "Active now", duration
   - Plain-English formatting throughout (SRS NFR-USE-03) — "2:00 PM",
     "Yesterday", never an ISO string
   - A background job closes sessions left open for 30+ minutes
     (SRS NFR-REL-02)

ACCEPTANCE CRITERIA:
- Two users dragging different Kanban cards simultaneously produce no lost
  updates and no position collision
- Chat history survives a server restart
- Whiteboard edits from two users merge without conflict
- A browser crash leaves a session row that the background job closes
- Panel state does not leak between rooms
- Typing in chat never moves the avatar
```

---

## PHASE 7 — Project Awareness (Derived)

This is where the concept pays off. Note carefully what it does *not* do.

```
Add derived project context to Retry Rooms.

CRITICAL CONSTRAINT: rooms remain completely independent of posts. There is
NO foreign key from rooms to posts, no link field, and no user-facing action
that associates a room with a post. SRS §4.7 states rooms and posts are
unrelated, and this feature must not violate that. Everything here is COMPUTED
from activity already inside the room.

BUILD ON: Phase 6 panels, which supply the source data.

DELIVERABLES:

1. Derived context cache table:
   room_project_context (
     room_id PK, summary text, active_card_count int,
     stalled_card_count int, last_activity_at timestamptz,
     top_contributors jsonb, momentum text, computed_at timestamptz
   )
   This table is a cache. It must be safely droppable and fully rebuildable
   from room_messages, kanban_cards, room_sessions, and whiteboard_state.
   Never accept a user write to it.

2. Computation job (BullMQ, runs on room activity, debounced to 10 minutes):
   Inputs, all already inside the room:
     - Kanban card titles and column distribution
     - Card movement velocity over the last 7 days
     - Chat message volume and participants
     - Whiteboard shape count and last edit time
     - Session durations per member
   Outputs:
     - summary: one sentence, generated by the Anthropic API from Kanban card
       titles only. Prompt it to describe what the team is building, never to
       evaluate or judge. Chat content is NOT sent to the API.
     - momentum: 'active' | 'steady' | 'stalled', from card velocity and
       session recency
     - stalled_card_count: cards in In Progress with no movement in 7+ days
     - top_contributors: members ranked by combined card and session activity

3. Room header strip (inside the room, below the top bar):
   - The one-sentence summary, in muted text
   - Small stat chips: "6 cards active", "2 stalled", "Last worked on Tuesday"
   - Collapsible, and the collapsed state persists per user
   - When there is not enough activity to compute anything, show a genuine
     empty state that invites action: "Add a few Kanban cards and this will
     start tracking what you're building." Never show a fabricated summary.

4. Rooms tab enrichment:
   - Each room card gains the summary line and a momentum dot
     (green active / amber steady / gray stalled)
   - Sortable by momentum

5. Privacy boundaries, enforced:
   - Context is visible ONLY to room members
   - Never exposed on any public surface, profile, or feed
   - Faculty cannot see it (SRS §3.2 bars faculty from rooms entirely)
   - Chat message CONTENT never leaves the room, including to the AI. Only
     aggregate counts derived from chat are used.

ACCEPTANCE CRITERIA:
- Truncating room_project_context and rerunning the job restores identical
  output
- A room with no Kanban cards shows the empty state, not a hallucinated summary
- A non-member API request for a room's context returns 403
- The job for a room with 200 cards and 2000 messages completes in under 30s
- No chat message body appears in any Anthropic API request payload (verify
  by logging outbound request bodies in development)
```

---

## PHASE 8 — Resilience & Scale

```
Harden Retry Rooms for real use.

DELIVERABLES:

1. Reconnection:
   - On socket drop, the client shows a non-blocking "Reconnecting…" banner,
     freezes remote avatars rather than removing them, and retains local
     movement
   - On reconnect, request a fresh snapshot and reconcile
   - If reconnection fails after 5 attempts, offer an explicit "Rejoin" action
     rather than retrying forever

2. Horizontal scale (SRS NFR-SCALE-02):
   - Move the connection registry to Redis
   - Broadcast position, chat, Kanban, and proximity events over Redis pub/sub
     so members of one map may connect to different server nodes
   - Proximity computation is owned by a single designated node per map to
     avoid duplicate transition events. Elect it via a Redis lock.

3. Performance budget, measured and enforced in CI:
   - Room canvas interactive within 3s of join (SRS NFR-PERF-03)
   - Position broadcast under 150ms (SRS NFR-PERF-06)
   - 200 concurrent users without exceeding 20% baseline degradation
     (SRS NFR-PERF-05)
   - Write a load-test script that spawns 50 headless clients moving randomly
     in one map, and record the numbers

4. Desktop-only gate (SRS §10):
   - Detect viewport width under 1024px or a coarse pointer
   - Show a clear explanatory screen, not a broken canvas: rooms need a
     keyboard, open on a laptop
   - The rest of Retry stays fully mobile-usable; only this module gates

5. Graceful degradation:
   - Daily.co unavailable: rooms remain fully functional without AV, with a
     visible banner
   - tldraw sync unavailable: whiteboard opens read-only from the last
     persisted state
   - Anthropic API unavailable: project context shows the last computed value
     with its timestamp

ACCEPTANCE CRITERIA:
- Killing one of two server nodes moves its users to the other with under 5s
  disruption
- The load test passes the stated budgets
- Every third-party outage is survivable without the room becoming unusable
```

---

## What to watch for

**Phase 3 hysteresis is the single most common failure.** Every Gather-like clone gets this wrong and ships a product where standing near a boundary produces an audio strobe. Build the hysteresis and the debounce together, and test by parking an avatar at exactly 5.0 tiles.

**Phase 4's one-socket rule matters more than it looks.** Tearing down and re-establishing the WebSocket on every door makes transitions feel like page loads, which destroys the illusion the whole concept depends on.

**Phase 7 is where you can quietly break your own SRS.** The moment someone suggests "let's just add a `post_id` to rooms, it'd be easier" — that's the SRS violation. The derived model is more work and it is the correct answer.

---

*Retry — Collaboration Rooms Build Plan — July 2026*
