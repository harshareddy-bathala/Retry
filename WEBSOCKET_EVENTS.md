# WEBSOCKET_EVENTS.md — Retry Room Protocol

> The wire contract for Collaboration Rooms. **Hard Rule 9: no ad-hoc event names.**
>
> **The authoritative definition is the Zod schemas in `packages/protocol/src/events.ts`.** This file explains them; it does not define them. The client (`apps/web`) and the room server (`apps/room-server`) both import shapes and validators only from there and never redefine them locally. Adding an event = updating the schema and this file in the same PR.

An earlier draft of this document described a colon-namespaced protocol with ticket auth and Redis fan-out. **None of it was built.** See the appendix — it is listed there so a future reader knows those names were rejected, not forgotten.

---

## 1. Connection

```
ws://<room-server>/ws?token=<access JWT>
```

The room server is a **separate Node process** (`apps/room-server`, port 4100), not part of `apps/api`. It verifies the JWT itself — HS256 against the shared `JWT_SECRET` — and derives `userId` from `sub`. **A userId appearing anywhere in a message body is never trusted.** `join.displayName` and `join.sprite` are cosmetic only.

Faculty and alumni are rejected from the entire live space (`FORBIDDEN`); rooms are a student surface.

Close codes: `4401` unauthorized (missing or invalid token — terminal, the client does not retry), `4403` not a member, `4000` superseded by a newer connection of the same user.

### The pause rule — mandatory for every new WS route

**Both WS routes pause the socket while their handler awaits.** A `ws` socket emits `message` whether or not a listener is attached, and the event is then lost forever. Any handler that awaits — JWT verification, a membership query — before attaching its listener races the client's first frame.

The whiteboard lost its entire handshake this way: the tldraw client sends `connect` the instant the socket opens, it arrived during the membership query and vanished, and the board spun forever with no error on either side. `socket.pause()` / `socket.resume()` around handler setup is not optional.

### Envelope

Flat messages discriminated on `t`. No wrapper, no `payload`, no `ts`:

```json
{ "t": "move", "x": 12.5, "y": 7, "dir": "down", "moving": true }
```

Coordinates on the wire are **tile units** and server-authoritative; the client converts to pixels via `packages/protocol/src/coords.ts` (32 px tiles). Every inbound message on both sides is runtime-validated (`parseClientMessage` / `parseServerMessage`); an unparseable frame is dropped with a logged warning, never a crashed connection. Max payload 16 KB.

---

## 2. Client → server (21)

| `t` | Payload | Notes |
|---|---|---|
| `join` | `mapId?`, `displayName?`, `sprite?` | Bare join resolves the spawn server-side; while joined it is a resync request |
| `move` | `x`, `y`, `dir`, `moving` | 20/s cap; >2-tile jumps and collision tiles rejected |
| `leave` | — | Leave the map |
| `transition` | `toMapId` | Walk through a door. The socket is **not** torn down |
| `chat` | `body` (1–2000), `scope?` | `room` (persisted) or `nearby` (speech, never persisted) |
| `emote` | `key` | Whitelisted against the built catalogue; 1 per 1.5 s |
| `typing` | — | 1 per 2 s, server-side |
| `media` | `audio`, `video` | Mic/camera toggles |
| `avatar` | `sprite` | The deliberate character choice, persisted **per user** |
| `knockRespond` | `requestId`, `grant` | Any member; first response wins |
| `knockCancel` | `requestId` | Requester withdrawing |
| `kanbanCreate` | `title`, `description?`, `column`, `position` | Member-gated |
| `kanbanUpdate` | `cardId`, `title?`, `description?`, `assigneeId?` | |
| `kanbanMove` | `cardId`, `column`, `position`, `moveNote?` | `position` is fractional — see §7 |
| `kanbanDelete` | `cardId` | |
| `kanbanRenameColumn` | `key`, `label` | |
| `watch` | `roomId` (**uuid**), `displayName?` | Workspace mode — no actor, no proximity, no AV |
| `unwatch` | — | |
| `contextUpdate` | `stage?`, `domainTag?` (nullable) | `null` clears the tag; omitted leaves it |
| `blueprintUpdate` | `field`, `value` (≤4000) | Empty string is a legitimate value |
| `ping` | — | Liveness. First case in the switch, holds no locks |

> `watch` validates `roomId` as a **uuid**. A non-uuid frame is dropped as unparseable with **no reply at all**, so a client waits forever. Three tests failed silently on this before anyone noticed.

## 3. Server → client (26)

| `t` | Payload | Notes |
|---|---|---|
| `snapshot` | `mapId`, `template`, `actors[]` | `template` names the Tiled file; `mapId` alone is not enough |
| `actorJoin` | `actor` | |
| `actorMove` | `userId`, `x`, `y`, `dir`, `moving` | Broadcast to the map except the sender |
| `actorLeave` | `userId` | |
| `proximity` | `pairs[{ userId, zone }]` | Only **your own** changed pairs. The adjacency map is never broadcast |
| `mediaState` | `userId`, `audio`, `video` | |
| `doors` | `doors[{ slot, x, y, room? }]` | Commons plaques. Private rooms never appear |
| `knock` | `requestId`, `roomId`, `roomName`, `requesterName` | To online members |
| `knockPending` | `requestId`, `roomId`, `roomName` | Ack to the requester |
| `knockResult` | `requestId`, `status` | `granted` \| `denied` \| `timeout` \| `cancelled` |
| `avToken` | `mapId`, `serverUrl`, `room`, `token` | After every map-entry snapshot |
| `chatMessage` | `id`, `userId`, `displayName`, `body`, `createdAt`, `scope?` | Includes the sender — clients never echo locally |
| `actorEmote` | `userId`, `key` | |
| `actorTyping` | `userId`, `displayName` | To the **room channel**, not the map. Never echoed to the typist |
| `kanbanState` | `columns[]`, `cards[]` | The whole board, **once, on room entry** |
| `kanbanCard` | card | Upsert |
| `kanbanCardRemoved` | `cardId` | |
| `kanbanColumn` | `key`, `label` | |
| `workspaceState` | name, stage, domain tag, blueprint, journey, who is in the live map | Reply to `watch` |
| `contextState` | stage, domain tag | |
| `blueprintField` | `field`, `value`, … | |
| `journeyEntry` | entry | Milestones only |
| `avatarState` | `sprite` | |
| `evicted` | `roomId`, `reason` | `removed` \| `roomDeleted` |
| `pong` | — | |
| `error` | `code`, `message` | e.g. `FORBIDDEN`, `ROOM_ACCESS_DENIED` |

`RoomHub.broadcast` is the single fan-out point. It reaches map sessions **and** watchers, but watchers only for the allow-listed `WATCHER_EVENTS` — chat, board, workspace edits, and `actorJoin`/`actorLeave`. Movement and proximity stop at the map boundary: they are the highest-volume messages on the wire and mean nothing to a page with no canvas. **Adding a server→client event a Workspace should see means adding it to `WATCHER_EVENTS` too**; `actorTyping` was missed exactly once.

---

## 4. Proximity

Pairwise Euclidean tile distance, recomputed on every accepted move. Thresholds are **constants** in `apps/room-server/src/rooms/proximity.ts` — not admin-configurable, and not transitive.

| Distance | Zone | Client behaviour |
|---|---|---|
| ≤ 2 tiles | `close` | 72 px bubble, gain 1.0 |
| ≤ 5 tiles | `near` | 48 px bubble, gain 0.5 |
| beyond | `out` | Unsubscribed, gain 0 |

Two anti-flicker guards, which are the single most common failure in Gather-like clones: **0.5-tile exit hysteresis** (you must walk half a tile past the boundary to leave a zone) and a **300 ms debounce** before any transition is emitted. A `proximity` message goes only to the two clients whose pair changed, and carries only their own pairs.

Zones are map-instance-scoped. Pairs never form across maps.

### Map zones override distance

A map may declare a `zones` object layer (`packages/maps`, `docs/authoring-maps.md`).
Three of its kinds are enforced here, and they replace the distance rule
entirely rather than adjusting it:

| Zone | Effect on a pair |
|---|---|
| `quiet` | Either occupant → `out`, at any distance. |
| `spotlight` | Either occupant → `close`, at any distance, across the whole map. |
| `booth` | Same booth → `close`. Different booths, or one in and one out → `out`. |

**Precedence is quiet → spotlight → booth → distance.** Someone standing in the
quiet corner asked not to be in a call, and no stage and no booth overrides a
person's own choice. `spotlight` exists because plain proximity audio cannot do
a demo at all: a presenter five tiles from the back row is inaudible to it.

The hysteresis and debounce still apply on top, so walking onto a stage is a
debounced transition like any other. The `proximity` message is unchanged —
it has only ever carried the outcome, never the reason — so **no protocol
change was needed for any of this**.

`ProximityEngine` itself knows nothing about maps: the zone travels with the
position, resolved by `RoomHub.positionsIn` via `zoneAt`. That ignorance is what
keeps the hysteresis and debounce rules testable with plain numbers.

**Grouping is pairwise, not transitive.** There is one LiveKit room per *map*; who you hear is decided per pair by subscription, not by a shared call object. If A↔B and B↔C are close but A↔C is not, A and C do not hear each other.

---

## 5. Guards and liveness

- **20 `move`/s per connection.** Excess silently dropped.
- **Moves that jump >2 tiles or land in a collision tile** are rejected and answered with a fresh `snapshot` resync.
- **`emote` 1 per 1.5 s, `typing` 1 per 2 s**, server-side. Clients also debounce, but none of these can be made safe by asking the client nicely — a client that debounces badly cannot be talked out of flooding, only refused.
- **Liveness: `ping` → `pong`, nothing else in either.** A TCP socket can go half-open — the browser still reports `OPEN`, sends succeed into a void and nothing ever arrives — which the client used to render as a permanently healthy world. RFC 6455's own ping frame is no help: a browser page can neither send one nor answer one, so liveness has to ride the JSON channel. The client beats every 20 s and treats four unanswered beats as death; **any** inbound frame resets the counter, because a busy room is proof of life without a pong. The client reconnects with exponential backoff (1 s → 30 s cap), stops after five attempts and offers a Rejoin button. `4401` is terminal — a stale token never becomes valid by retrying.

**Known gap:** the server is authoritative for move *legality* but not for *position*. It writes whatever the client sends if it passes the step and collision checks, so a client could walk at up to 2 tiles × 20 messages/s. `WALK_SPEED` (4 tiles/s) lives only on the client. Low stakes, but real, and untested.

---

## 6. The multi-map world

Map ids are **instances**: `commons`, the `studio_a` sandbox, or a room uuid rendered from the room's `map_template`. `snapshot.template` names the Tiled file to draw.

`join.mapId` is optional — a bare join asks the server to resolve the spawn (last-active room from `room_members.current_map_id`, else the Commons). `transition` moves the **same connection** between map registries; the socket is never torn down at a door.

Access policy is enforced server-side on every join *and* transition: members always enter; `open` admits any student; `knock` opens an access request (`knockPending` to the requester, `knock` to online members, `knockRespond` first-answer-wins, 60 s timeout, `knockResult` to everyone involved — a grant admits that session only); `invite_only` rejects with `ROOM_ACCESS_DENIED`.

`doors` carries the Commons door slots — assigned public room, access policy, live occupancy — on Commons entry, and re-broadcasts when occupancy or assignment changes. **Private rooms never appear in it: privacy by absence.**

One avatar per user: a second connection supersedes the first, but **only for sessions standing on a map**. A Workspace open in another tab is not a competing avatar and must survive.

---

## 7. Panels — chat, board, whiteboard

Chat and Kanban ride the **same world socket**. No second channel.

**Chat.** `scope: 'room'` is accepted only inside a room instance (the Commons is a corridor, not a workspace), sanitised on write (control characters stripped, trimmed; empty after sanitising = dropped), persisted, then broadcast **including the sender** — clients never echo locally, so the server's id and timestamp are the only ones that ever render. Full history is REST, not WS: `GET /api/rooms/:id/messages` (member-only, 50/page, `?before=` cursor).

`scope: 'nearby'` is **speech**: delivered only to the peers the proximity engine already says are `close` or `near`, echoed to the speaker, and never written down. It reuses the same zone state that drives the audio bubbles, so what you can hear and what you can read agree **by construction** rather than by two rules that have to be kept in step. A watcher is on nobody's proximity list and therefore hears nothing said nearby — right, because they are reading the room, not standing in it.

> `chatMessage.id` for a nearby line is **session-scoped**. Nothing persists it and the client only needs a React key for the few seconds the bubble is up. Anything that tries to reference a nearby line by id is referencing nothing.

**The scope decides the requirement, not the map.** Speech needs an avatar; a chat log needs a room. Both `chat` and `typing` used to ask "am I in a room?" first and were therefore refused in the Commons — precisely where students run into each other.

**Kanban.** Mutations are member-gated (a visitor gets a `FORBIDDEN` frame and a read-only board) and every accepted mutation is persisted before it is broadcast. `kanbanState` carries the whole board **once, on room entry** — clients must therefore track it above any lazily-mounted panel, not inside one. Card `position` is a fractional `real`: a drag writes one row and never reindexes a column, so two members dragging at once cannot collide.

**Whiteboard.** Its own endpoint, `ws://<room-server>/whiteboard?roomId=&token=&sessionId=`, speaking the tldraw sync protocol (`@tldraw/sync-core` `TLSocketRoom`, one per room, lazily created) rather than our envelope. Same JWT auth; **membership required** (4403 otherwise, 4401 for a missing or non-student token). The document persists to `rooms.whiteboard_state`, debounced to at most one write per 5 s, flushed on shutdown, reloaded for the next reader; a corrupt stored document warns and starts empty rather than bricking the board.

---

## 8. Workspace (watch mode)

A room is two views of one thing, and only one of them needs a canvas.

`{ t: 'watch', roomId, displayName }` subscribes a **member** to a room's channel with no actor, no proximity and no AV — over the same socket the Live Space uses, which is what lets the Workspace reuse the chat, board and whiteboard components unchanged. A session watches at most one room, because the Workspace is one page; `unwatch`, a second `watch`, or the socket closing all release it. Non-members get `FORBIDDEN` and learn nothing else about the room.

The reply is `workspaceState` — name, stage, domain tag, blueprint, journey, and who is standing in the live map right now — followed by `kanbanState`.

`contextUpdate` and `blueprintUpdate` are member-gated exactly like kanban and work identically from either view. A Build Journey entry is written for a room's creation, a **field's first-ever answer**, and each stage change — never for a re-edit, and never by a client. The weekly Done count is computed from the board at read time rather than stored, so a card moving out of Done stops being counted.

**Watching is not presence.** Opening a room's page must never put your avatar in it.

---

## 9. AV — self-hosted LiveKit (ADR-012)

One LiveKit room per map instance, named `retry-<mapId>`, created implicitly on first join. `avToken` carries `{ serverUrl, room, token }` after every map-entry snapshot — a per-user, 2 h token signed **locally**, with no REST round-trip and therefore no third-party outage in the room-entry path.

The token grants `roomJoin` + publish + subscribe and denies `roomRecord` (FR-ROOM-32), `canPublishData` (proximity, chat and presence ride this socket; **LiveKit carries media only**) and every admin capability. The API secret lives only in the room server. When `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` are not all set the message is simply never sent and the placeholder bubbles remain — a supported state, not an error.

LiveKit participant **identity is the Retry userId**, so a participant maps onto an actor with no side-channel lookup.

The client connects with `autoSubscribe: false` and calls `setSubscribed` on a peer's publications only while proximity reports `close` or `near` — **bandwidth scales with proximity, not room population.** Never a full mesh hidden with CSS. Gain (1.0 / 0.5 / 0) is ramped over 200 ms through a WebAudio `GainNode` rather than LiveKit's instant `setVolume`, because a step is audible. A door transition disconnects the old room and connects the new one; mic/cam state carries across unchanged.

> **AV has never run against a real server.** LiveKit is coded and unit-tested but no SFU has been provisioned. See `docs/livekit-vps.md`.

---

## 10. Membership and presence

The API owns membership and runs in a different process, so a removal that only lands in Postgres would leave the removed member walking around the room. `POST /internal/evict` on the room server closes that gap — private network, `INTERNAL_API_SECRET` compared with `timingSafeEqual`, never through Nginx.

Targets are `userIds` (a removal), `except` (a room turning private keeps its members and drops visitors), or neither (a deleted room empties). Each target is sent `evicted { roomId, reason }` and then **moved to the Commons on the same socket** — the connection is the user's whole session and killing it would read as a crash — with their session-scoped knock grant revoked so they cannot immediately walk back in. `POST /internal/doors-changed` rebuilds the Commons plaques after a visibility change, which is otherwise invisible until someone moves.

**Presence** is one mutable cell. The hub refreshes `room_members.presence_seen_at` every 20 s for everyone standing in a map and NULLs it on socket close (skipped when a newer connection superseded the old one). That is what lets the REST API answer "who is in this room right now" with a 30 s staleness window and **no sessions table**. Chat, board mutations and whiteboard saves also bump `rooms.last_activity_at` for the room list's ordering.

There is no attendance history, and there must not be one.

---

## 11. Scaling — read this before promising anything

**The room server is single-process and in-memory.** `RoomHub.broadcast` iterates a local `Map` of sockets. Session state, map registries, the proximity engine and knock requests all live in process memory.

**Redis is used for nothing in rooms.** Horizontal scaling would require a fan-out layer that does not exist. Running two instances today would silently split the world in half: two people on different instances would not see each other, and neither would error.

The measured headroom on one instance: 50 concurrent sockets moving at the real client's 50 ms cadence give **p50 1.9 ms, p95 67.8 ms, p99 100.4 ms** against the 150 ms NFR-PERF-06 budget (`apps/e2e/load/move-latency.ts`).

---

## 12. Deliberately not in this protocol

**Seating.** A seat is a map interactable (`interactive: 'seat'` plus a `facing`); sitting moves the avatar onto a walkable tile and sends an ordinary `move`. The server needs no new state and no new message — which is why sittable chair blocks carry no collision. A solid chair would be rejected by the same collision check that guards every move, and would fail silently as a resync. The map validator rejects a seat placed on a collision tile.

---

## Appendix — names that were rejected, not forgotten

An earlier draft of this file specified a protocol that was never implemented. It is recorded here so nobody reintroduces it believing it was lost:

- **`POST /api/rooms/:id/ws-ticket`** — a 30 s single-use ticket so JWTs never appear in URLs. Not built; the access JWT goes in the query string.
- **The `{ type, payload, ts }` envelope** and colon-namespaced names: `presence:ping`, `presence:sync`, `presence:join`, `presence:leave`, `avatar:join`, `avatar:move`, `avatar:leave`, `avatar:joined`, `avatar:moved`, `avatar:left`, `chat:send`, `chat:message`, `context:update`, `context:updated`, `blueprint:update`, `blueprint:updated`, `kanban:card:create`/`update`/`move`/`delete`, `kanban:column:rename`/`renamed`, `journey:entry`, `proximity:enter`/`update`/`leave`, `media:state`/`updated`, `room:member:added`/`removed`, `room:deleted`.
- **Redis pub/sub fan-out** on `room:<roomId>`. See §11.
- **Transitive call grouping** (A↔B and B↔C ⇒ one call for three). Grouping is pairwise.
- **Admin-configurable proximity thresholds.** They are module constants.
- **Closing a connection after 5 consecutive invalid messages** (`4400`). Invalid frames are dropped and logged, indefinitely.
- **Daily.co.** Replaced by self-hosted LiveKit in ADR-012.
