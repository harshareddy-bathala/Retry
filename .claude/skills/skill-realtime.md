# Skill: Room Server & Realtime (WS, Phaser, Proximity, LiveKit)

Use when working under `apps/room-server/src/` or `apps/web/src/features/rooms/`.

**The room server is its own process** — `apps/room-server`, Fastify + `ws`, port 4100. It is *not* a plugin scope inside `apps/api`. `apps/api` is REST only and reaches the world over `POST /internal/*` on the private network.

**Hard Rule 9: the contract is `packages/protocol/src/events.ts`.** Both sides import shapes and validators from `@retry/protocol` and never redefine a message locally. `WEBSOCKET_EVENTS.md` documents that contract; the Zod schema enforces it.

## Recipe for a new WS event

1. Add the schema to `packages/protocol/src/events.ts` and extend `clientMessageSchema` / `serverMessageSchema`.
2. Handle it in the switch in `apps/room-server/src/rooms/hub.ts` — validate → persist (if stateful) → broadcast.
3. **If a Workspace should see it, add it to `WATCHER_EVENTS` in `hub.ts`.** `broadcast` reaches watchers only for allow-listed events; `actorTyping` was missed exactly once.
4. Client: it arrives on `roomEvents.emit('net:server-message')` via `net/room-socket.ts`. Phaser reads it in `RoomScene.onServerMessage`; React reads it through a hook or an external store.
5. Add a round-trip case to the relevant `apps/room-server/test/*.ws.test.ts`. These are real sockets against a real server, not mocks.
6. Document it in `WEBSOCKET_EVENTS.md` in the same PR.

## Invariants (violating these breaks the SRS)

- **No attendance history, ever.** Presence is one mutable cell — `room_members.presence_seen_at`, refreshed every 20 s, NULLed on close, read with a 30 s staleness window. No session rows, no durations, no append-only log. `room_members.last_position` is written on transition, leave and disconnect only, never per move.
- **Identity comes from the token, only.** `userId` is `payload.sub`. A userId in a message body is never trusted; `displayName` and `sprite` on `join`/`watch` are cosmetic.
- **`socket.pause()` / `resume()` around any handler that awaits.** A `ws` socket emits `message` with or without a listener and the event is then gone forever. Awaiting JWT verification before attaching listeners races the client's first frame — this silently cost the whiteboard its entire tldraw handshake.
- **Proximity is server-authoritative and pairwise.** Euclidean tile distance, `≤2` close / `≤5` near — **module constants in `rooms/proximity.ts`, not admin config**. 0.5-tile exit hysteresis and a 300 ms debounce, both of which exist because zone flicker is the classic failure in this kind of world. Grouping is **not** transitive. A `proximity` message goes only to the pair that changed.
- **`move`: client sends on a fixed 50 ms tick, server caps at 20/s** and drops the excess silently. Jumps >2 tiles or landings on a collision tile are rejected and answered with a resync `snapshot`. **Do no DB work on the move path** — the budget is 150 ms (NFR-PERF-06) and the measured p95 is 67.8 ms.
- **Server echo is authoritative**: persist first, then broadcast the persisted shape, including back to the sender. Clients never echo locally.
- **Membership gates content writes**, checked per message rather than only on connect — membership can be revoked mid-session. A removal reaches the world through `POST /internal/evict`, which moves the person to the Commons **on their existing socket**; killing the connection would read as a crash.
- **Fan-out is in-process.** `RoomHub.broadcast` iterates a local `Map`. There is no Redis in rooms, so the room server is single-instance. Do not write code that assumes otherwise — but do not add a Redis layer casually either; it is a real project, not a flag.

## LiveKit rules

- Tokens are minted **locally** in `av/livekit.ts` (`livekit-server-sdk`, HS256, 2 h TTL) — no REST round-trip, so no third-party outage sits in the room-entry path.
- One room per **map instance**, named `retry-<mapId>`. Participant **identity is the Retry userId**, so a participant maps onto an actor with no lookup.
- The grant allows `roomJoin` + publish + subscribe and denies `roomRecord` (FR-ROOM-32, nothing is ever recorded), `canPublishData` (proximity, chat and presence ride our socket; LiveKit carries media only) and every admin capability.
- The client connects with **`autoSubscribe: false`** and calls `setSubscribed` per publication only while proximity says `close`/`near`. Bandwidth scales with proximity, not room population — never a full mesh hidden with CSS.
- Gain (1.0 / 0.5 / 0) is ramped over 200 ms through a WebAudio `GainNode`, not LiveKit's instant `setVolume`, because a step is audible.
- AV is **off unless all three of `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` are set** — a half-configured AV is worse than none. This is a supported state, not an error.
- **It has never run against a real server.** See `docs/livekit-vps.md`; TURN on TCP/443 is mandatory on Indian campus networks.

## Phaser (Live Space frontend)

- **Phaser owns the game loop; React owns the HUD.** The only bridge is the typed `roomEvents` bus in `features/rooms/event-bus.ts` — ad-hoc channels are not allowed. Per-frame data (avatar screen/tile positions) goes through plain module maps in `avatar-positions.ts` and **never** through React state.
- **Keyboard ownership goes through `features/rooms/input/input-layers.ts`**, a refcounted layer stack with one capture-phase window listener. Never add a bare `window.addEventListener('keydown')` in a room component: that is how Escape inside tldraw used to close the whole whiteboard and how `3` used to pick a tool *and* broadcast an emote.
- **The world is a Tiled tilemap**, not code. `packages/maps/maps/*.json`, loaded by the client for rendering and by the room server for collision — the two cannot disagree about where a wall is. There is no generator; see `docs/authoring-maps.md`.
- **Characters are composited at runtime** from five LimeZu layer strips (`game/compose-avatar.ts`), cached LRU at 40. The selection string is validated server-side against the curated catalogue — a client may not invent a character. Catalogue ids are persisted per user: **add freely, never rename or remove one someone may have chosen.**
- Local movement is predicted immediately; remotes **interpolate over 100 ms** — never snap, snapping is what makes multiplayer feel cheap.
- Depth is y-sorted by the **feet**, not the sprite origin: frames are 32×64 and the head overhangs the tile. `objects_above` draws over everyone so you can walk behind furniture.

## Build Journey (server-side, automatic)

Entries are created only by server code, on: room creation, each blueprint field's **first-ever** answer, and stage changes. Never expose an endpoint or event that writes a journey entry directly (FR-ROOM-17). The weekly Done count is computed from the board at read time, so a card moving out of Done stops being counted.
