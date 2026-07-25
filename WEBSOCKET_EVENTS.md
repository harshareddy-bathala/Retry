# WEBSOCKET_EVENTS.md — Retry Room Protocol

> The complete, exact WebSocket event contract for Collaboration Rooms. **Hard Rule 9: no ad-hoc event names.** Every event here has a Zod schema in `packages/types/src/ws.ts`; server and client both parse against it. Adding an event = updating this file + the Zod schema in the same PR.

---

## 1. Connection

```
wss://<host>/rooms/:roomId/ws?ticket=<one-time-ticket>
```

- Ticket obtained via `POST /api/rooms/:id/ws-ticket` (JWT-authenticated, member-only, 30 s TTL, single use). JWTs never appear in URLs.
- Server verifies membership on connect; non-members are closed with code `4403`.
- Whiteboard uses the **separate tldraw sync server** — not this protocol.
- Daily.co audio/video uses Daily's own SDK connection — this protocol only orchestrates who is in which call.

### Envelope

Every message both directions:

```json
{ "type": "namespace:event", "payload": { }, "ts": 1699999999999 }
```

Server→client broadcasts include `"from": "<userId>"` where user-originated. Malformed messages are dropped and logged; the connection is closed after 5 consecutive invalid messages (code `4400`).

### Heartbeat

- Client sends `presence:ping` every 10 s.
- Missed for 30 s → server clears presence and broadcasts `presence:leave` (NFR-REL-02).

---

## 2. Client → Server Events

| Type | Payload | Notes |
|------|---------|-------|
| `presence:ping` | `{}` | Heartbeat |
| `context:update` | `{ projectName?, projectStage?, projectDomain? }` | Any member; persisted then broadcast (FR-ROOM-10) |
| `blueprint:update` | `{ field: "problem"\|"audience"\|"existing", value: string }` | Persisted + appended to `blueprint_history`; first-ever edit per field also creates a Build Journey entry |
| `chat:send` | `{ body: string }` | Plain text, 1–2000 chars |
| `kanban:card:create` | `{ title, description?, column, position }` | |
| `kanban:card:update` | `{ cardId, title?, description?, assigneeId? }` | |
| `kanban:card:move` | `{ cardId, column, position, moveNote? }` | `moveNote` only meaningful for done/parked (FR-ROOM-21) |
| `kanban:card:delete` | `{ cardId }` | |
| `kanban:column:rename` | `{ key, label }` | |
| `avatar:join` | `{ sprite?: 0-5 }` | Entering Live Space; sprite required on first-ever entry |
| `avatar:move` | `{ x, y, direction: "up"\|"down"\|"left"\|"right"\|"idle" }` | Client throttles to max 10/s; server rate-limits at 15/s |
| `avatar:leave` | `{}` | Leaving Live Space back to Workspace (still connected/present) |
| `media:state` | `{ audio: boolean, video: boolean }` | Mute/camera toggles (FR-ROOM-31) |

## 3. Server → Client Events

| Type | Payload | Notes |
|------|---------|-------|
| `presence:sync` | `{ present: [{ userId, name, avatarUrl, inLiveSpace }] }` | Sent once on connect |
| `presence:join` / `presence:leave` | `{ userId }` | Ephemeral — Redis only, never persisted |
| `context:updated` | full context object | Echo of persisted state (authoritative) |
| `blueprint:updated` | `{ field, value, editedBy, ts }` | |
| `chat:message` | `{ id, senderId, body, createdAt }` | Includes sender's own echo (client renders from echo only) |
| `kanban:card:created` / `updated` / `moved` / `deleted` | full card / `{ cardId }` | Authoritative persisted state |
| `kanban:column:renamed` | `{ key, label }` | |
| `journey:entry` | `{ id, type, payload, createdAt }` | New Build Journey entries push live |
| `avatar:joined` | `{ userId, sprite, x, y, direction }` | Spawn at last_position or default desk zone (FR-ROOM-27) |
| `avatar:moved` | `{ userId, x, y, direction }` | Relayed ≤150 ms (NFR-PERF-06); **never persisted per-move** |
| `avatar:left` | `{ userId }` | |
| `proximity:enter` | `{ callId, peers: [userId] }` | Server-side Euclidean check (default 5 tiles); client joins Daily call `callId` |
| `proximity:update` | `{ callId, peers: [userId] }` | Membership of your current call changed |
| `proximity:leave` | `{ callId }` | Client leaves the Daily call |
| `media:updated` | `{ userId, audio, video }` | Render mute/camera badges on avatars |
| `room:member:added` / `removed` | `{ userId }` | `removed` for self → close connection, revoke Daily token |
| `room:deleted` | `{}` | Owner deleted room; clients navigate away |
| `error` | `{ code, message }` | e.g. `RATE_LIMITED`, `INVALID_PAYLOAD`, `NOT_MEMBER` |

---

## 4. Proximity Rules (server-authoritative)

| Distance (tiles, Euclidean) | State | Client behaviour |
|---|---|---|
| 0–2 | Close | Full-size video bubble, full volume |
| 3–5 | In proximity | Smaller bubble, audio on |
| 6+ | Out of range | No call connection |

- Threshold configurable via admin config — no deploy needed (SRS §11.4).
- Distance is computed **only** server-side on each `avatar:move`; clients never decide call membership.
- Call grouping: transitive — if A↔B and B↔C are in proximity, all three share one call.

## 5. Scaling Note

All broadcasts publish to Redis pub/sub channel `room:<roomId>`; each server instance relays to its local sockets. This works identically with 1 instance (V1) or N instances — never broadcast by iterating a local-only socket map.

---

## 6. Movement Protocol (Rooms multiplayer — `packages/protocol`)

The real-time 2D multiplayer rebuild (`retry_rooms_build_plan.md`) carries its own wire protocol, established in rooms Phase 0. **Its authoritative definition is the Zod schemas in `packages/protocol/src/events.ts`** — client (`apps/web`) and room server (`apps/room-server`) both import shapes and validators only from there, never redefine them locally.

Unlike the namespaced envelope above, these are flat messages discriminated on `t`:

| Direction | Events |
|---|---|
| Client → server | `join`, `move`, `leave`, `chat`, `media`, `transition`, `knockRespond`, `knockCancel`, `kanbanCreate`, `kanbanUpdate`, `kanbanMove`, `kanbanDelete`, `kanbanRenameColumn` |
| Server → client | `snapshot`, `actorJoin`, `actorMove`, `actorLeave`, `proximity`, `mediaState`, `doors`, `knock`, `knockPending`, `knockResult`, `avToken`, `chatMessage`, `kanbanState`, `kanbanCard`, `kanbanCardRemoved`, `kanbanColumn`, `error` |

Proximity (rooms Phase 3): the server computes pairwise Euclidean tile distance on every accepted move — `≤ 2` close, `≤ 5` near (SRS §11.4) — with 0.5-tile exit hysteresis and a 300 ms debounce before any transition is emitted. `proximity` goes only to the two clients whose pair changed, carrying only their own pairs. `media` reports the sender's mic/camera toggles; the server broadcasts `mediaState` to the rest of the map and folds current state into `snapshot` actors.

Connection (rooms Phase 2): `ws://<room-server>/ws?token=<access JWT>`. The server verifies the JWT (shared `JWT_SECRET`, HS256) and derives `userId` from `sub` — a userId appearing anywhere in a message body is never trusted. `join.displayName`/`join.sprite` are cosmetic only. Server-side guards: 20 `move`/s per connection (excess silently dropped), moves that jump >2 tiles or land in a collision tile are rejected and answered with a fresh `snapshot` resync. `actorMove` is broadcast to every connection in the map except the sender.

Multi-map world (rooms Phase 4): map ids are **instances** — `commons`, the `studio_a` sandbox, or a room uuid rendered from the room's `map_template`; `snapshot.template` names the Tiled file to draw. `join.mapId` is optional: a bare join asks the server to resolve the spawn (last-active room from `room_members.current_map_id`, else the Commons) or, while joined, to resync the current map. `transition` moves the SAME connection between map registries — the socket is never torn down at a door. Access policy is enforced server-side on every join/transition: members always enter, `open` admits any student, `knock` opens an access request (`knockPending` to the requester, `knock` prompts to online members, `knockRespond` first-answer-wins, 60 s timeout, `knockResult` to everyone involved; a grant admits that session only), `invite_only` rejects with `ROOM_ACCESS_DENIED`. Faculty/alumni are rejected from the whole live space (`FORBIDDEN`). `doors` carries the Commons door slots (assigned public room, access policy, live occupancy) on commons entry and re-broadcasts when occupancy or assignment changes; private rooms never appear in it. Proximity and presence are map-instance-scoped — pairs never form across maps.

AV (rooms Phase 5; self-hosted LiveKit since ADR-012): one LiveKit room per map instance, named `retry-<mapId>` and created implicitly on first join. `avToken` carries `{serverUrl, room, token}` after every map-entry snapshot — a per-user, 2 h token (SECURITY.md/NFR-SEC-02) signed **locally**, with no REST round-trip and therefore no third-party outage in the room-entry path. The token grants `roomJoin` + publish + subscribe and denies `roomRecord` (FR-ROOM-32), `canPublishData` (proximity, chat and presence ride this socket; LiveKit carries media only) and every admin capability. The API secret lives only in the room server; when `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` are not all set the message is simply never sent and the placeholder bubbles remain — a supported state, not an error. LiveKit participant **identity is the Retry userId**, so a participant maps onto an actor with no side-channel lookup. The client connects with `autoSubscribe: false` and calls `setSubscribed` on a peer's publications only while proximity reports `close`/`near` (gain 1.0 / 0.5, ramped 200 ms through WebAudio rather than LiveKit's instant `setVolume`) — bandwidth scales with proximity, not room population. A door transition disconnects the old room and connects the new one; mic/cam state carries across unchanged.

Persistent panels (rooms Phase 6): chat and Kanban ride the **same world socket** — no second channel. `chat` is accepted only inside a room instance (the Commons is a corridor, not a workspace), sanitised on write (control characters stripped, trimmed; empty after sanitising = dropped), persisted, then broadcast as `chatMessage` **including the sender** — clients never echo locally, so the server's id and timestamp are the only ones that ever render. Full history is REST, not WS: `GET /api/rooms/:id/messages` (member-only, 50/page, `?before=` cursor). Kanban mutations are member-gated (`store.isMember`; a visitor gets a `FORBIDDEN` error frame and a read-only board) and every accepted mutation is persisted before it is broadcast: `kanbanCard` upserts, `kanbanCardRemoved` deletes, `kanbanColumn` renames. `kanbanState` carries the whole board **once, on room entry** — clients must therefore track it above any lazily-mounted panel, not inside one. Card `position` is a fractional `real`: a drag writes one row and never reindexes a column, so two members dragging at once cannot collide.

Whiteboard (rooms Phase 6): its own endpoint, `ws://<room-server>/whiteboard?roomId=&token=&sessionId=`, speaking the tldraw sync protocol (`@tldraw/sync-core` `TLSocketRoom`, one per room, lazily created) rather than our envelope. Same JWT auth; **membership is required** (4403 otherwise, 4401 for a missing or non-student token). The document is persisted to `rooms.whiteboard_state` debounced to at most one write per 5 s, flushed on shutdown, and reloaded for the next reader; a corrupt stored document warns and starts empty rather than bricking the board.

**Both WS routes pause the socket while their handler awaits.** A `ws` socket emits `message` whether or not a listener is attached and the event is then lost forever, so any handler that awaits (JWT verification, a membership query) before attaching its listener races the client's first frame. The whiteboard lost its entire handshake this way — the tldraw client sends `connect` the instant the socket opens, it arrived during the membership query and vanished, and the board spun forever with no error on either side. `socket.pause()`/`resume()` around handler setup is mandatory for every new WS route.

Every inbound message on both sides is runtime-validated (`parseClientMessage` / `parseServerMessage`); an unparseable frame is dropped with a logged warning, never a crashed connection. Coordinates on the wire are **tile units** (server-authoritative); the client converts to pixels via `packages/protocol/src/coords.ts` (32 px tiles).

As later build-plan phases land (proximity, transitions), their events are added to the discriminated unions in `packages/protocol` and mirrored here in the same PR. The `avatar:*` / `proximity:*` rows in §2–3 describe the pre-rebuild design and are superseded phase-by-phase by this protocol.
