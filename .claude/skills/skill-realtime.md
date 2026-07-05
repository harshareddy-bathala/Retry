# Skill: Room Server & Realtime (WS, Phaser, Proximity, Daily.co)

Use when working under `apps/api/src/room/` or the Live Space frontend. The protocol contract is `WEBSOCKET_EVENTS.md` — **Hard Rule 9: no event exists until it's in that file + `packages/types/src/ws.ts`.**

## Recipe for a new WS event

1. Add the event + payload to `WEBSOCKET_EVENTS.md` (client→server or server→client table).
2. Add the Zod schema to `packages/types/src/ws.ts`; extend the discriminated-union message type.
3. Server: handler in `apps/api/src/room/handlers/<namespace>.ts` — validate → persist (if stateful) → **publish to Redis `room:<roomId>`**, never write directly to local sockets.
4. Client: handle in `useRoomSocket`'s dispatcher → patch TanStack Query cache.
5. Add a round-trip case to `room.ws.int.test.ts`.

## Invariants (violating these breaks the SRS)

- **Presence is ephemeral**: Redis only. No session rows, no timestamps, no attendance, no duration logs — anywhere. `room_members.last_position` is written once, on disconnect, and that's the only position ever persisted.
- **Broadcast via Redis pub/sub always** (NFR-SCALE-02) — code must not assume all room sockets live in this process.
- **Proximity is server-authoritative**: Euclidean distance on tile coords, threshold from admin config (default 5). Clients never decide call membership. Grouping is transitive (A↔B, B↔C ⇒ one call for all three).
- **Membership gates everything**: verify on connect (close `4403`), and on every message (membership may have been revoked mid-session). Member removal ⇒ force-close socket + revoke Daily token + eject via Daily REST.
- Heartbeat: 10 s ping, 30 s timeout ⇒ clear presence, broadcast `presence:leave`. Persistent state is untouched by disconnects (NFR-REL-02).
- `avatar:move`: client throttles to 10/s, server enforces 15/s. Position relay target ≤150 ms — do no DB work on the move path.
- Server echo is authoritative: persist first, then broadcast the persisted shape (including to the sender).

## Daily.co rules

- Tokens minted server-side only: per-room, per-user, per-session, 2 h TTL (NFR-SEC-02)
- The room server orchestrates call membership from proximity transitions; the client just joins/leaves the `callId` it's told about
- Nothing is ever recorded (FR-ROOM-32) — recordings disabled at the Daily domain level
- No custom WebRTC, no exceptions (FR-ROOM-29)

## Phaser (Live Space frontend)

- Phaser owns the game loop and avatar state; React owns overlays. Bridge with an event emitter — never setState per frame.
- Fixed single tilemap in V1; desk zones are named spawn points; 6 preset sprites, selection persisted per room per member (`avatar_sprite`).
- Remote avatars interpolate between position updates (lerp) — don't teleport on each event.
- Reconnect: spawn at `last_position` or default desk zone (FR-ROOM-27).

## Build Journey (server-side, automatic)

Entries are created only by service code on: room creation, each blueprint field's **first-ever** edit, stage changes, and a weekly done-count job. Never expose an endpoint that writes journey entries directly (FR-ROOM-17).
