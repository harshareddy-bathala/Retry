# @foundry/protocol

The shared contract for Foundry Rooms real-time multiplayer. **Both the client
(`apps/web`) and the room server (`apps/room-server`) import event shapes,
validators, and coordinate helpers only from here.** Never redefine an event
shape locally — that is how client and server drift apart.

## What lives here

| Module | Contents |
|--------|----------|
| `events.ts` | Every WebSocket message as a Zod schema + inferred TypeScript type, composed into `clientMessageSchema` / `serverMessageSchema` discriminated unions on the `t` field |
| `parse.ts` | `parseClientMessage` / `parseServerMessage` — non-throwing runtime validation for inbound frames. On failure the caller logs a warning and drops the frame; a malformed message must never crash a connection |
| `coords.ts` | `TILE_SIZE` and tile↔pixel conversion helpers |

## Event protocol

Client → server: `join`, `move`, `leave`, `chat`.
Server → client: `snapshot` (full state on join), `actorJoin`, `actorMove`, `actorLeave`, `error`.

The authoritative shapes are the Zod schemas in `src/events.ts`; the
human-readable registry is `WEBSOCKET_EVENTS.md` at the repo root (Hard
Rule 9). Adding an event means updating both in the same PR.

## Coordinate system

**Decision: the server reasons in tile coordinates; the client renders in
pixel coordinates. Tiles are 32×32 px.**

- **Tile size:** `TILE_SIZE = 32` px. All maps are authored in Tiled on a
  32×32 grid (`packages/maps`).
- **Server = tiles (integers).** Collision checks, movement validation, and
  proximity distances are all computed in tile units. Rationale: the SRS
  specifies proximity thresholds in tiles (Appendix 11.4 — `close ≤ 2`,
  `near ≤ 5`), so keeping the server in tile space means those constants are
  used verbatim, with no unit conversion to get subtly wrong.
- **Client = pixels.** Phaser positions sprites in pixel space, interpolating
  between updates for smooth rendering.
- **Conversion happens only through the helpers in `coords.ts`**
  (`tileToPixel`, `tileToPixelCenter`, `pixelToTile`), used by both sides.
  No hand-rolled `* 32` or `/ 32` anywhere else.

## Adding or changing an event

1. Add/modify the Zod schema in `src/events.ts` and include it in the
   relevant discriminated union.
2. Update `WEBSOCKET_EVENTS.md` in the same PR.
3. Add a parse test in `test/`.

Consumers get the type via `z.infer` automatically — never write an event
interface by hand.
