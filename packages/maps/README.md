# @foundry/maps

Tiled map JSON + tileset assets for Foundry Rooms, plus the map contract
validator. Maps are data shared by the client (rendering) and the room server
(collision, spawns) — both load the **same JSON** so they can never disagree
about where a wall is.

## Authoring workflow

1. Author maps in [Tiled](https://www.mapeditor.org/) on a **32×32 px** grid
   (the coordinate contract lives in `packages/protocol/README.md`).
2. Export as **JSON** (`.json`), never TMX. File name = map id
   (`studio_a.json` → mapId `studio_a`), saved into `maps/`.
3. Tilesets live in `tilesets/` and are referenced relatively
   (`../tilesets/<name>.png`).
4. Run `pnpm --filter @foundry/maps validate` before committing. CI runs it on
   every push and fails the build on an invalid map.

## Required structure — every map, no exceptions

Tile layers, named exactly:

| Layer | Purpose |
|-------|---------|
| `ground` | Visual floor tiles |
| `objects` | Visual props (desks, plants, whiteboard stand) |
| `collision` | Invisible tile layer; **any non-empty tile blocks movement** |

Object layers:

| Layer | Purpose |
|-------|---------|
| `spawns` | Must contain at least one **point** object named `default` — where an avatar appears on entry |

The validator (`src/validate.ts`, CLI in `scripts/validate-maps.ts`) enforces
all of the above plus the 32 px tile size, and fails loudly listing every
problem. `test/fixtures/studio_a_broken.json` is a deliberately broken copy
that keeps the negative path tested — do not "fix" it.

## Current maps

| Map | Description |
|-----|-------------|
| `studio_a` | 20×15 stub room: bordered walls, four desk clusters, centre spawn. The default room template (`rooms.map_template`) |

The `placeholder.png` tileset is 3 flat-colour tiles (floor, wall, prop) —
enough for collision-correct rendering until real art lands.
