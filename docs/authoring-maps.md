# Authoring rooms

The five room templates in `packages/maps/maps/` are **the only source of
truth**. There is no generator and nothing regenerates them: you either edit
them in [Tiled](https://www.mapeditor.org/) or mutate them in place with
`packages/maps/src/tiled.ts`, and then you look at the render.

| Template | Size | Shape | Room |
|---|---|---|---|
| `commons.json` | 44×20 | atrium + gallery | Everyone arrives here. Twelve door slots along the gallery's north wall. |
| `studio_a.json` | 24×20 | T | The default project room — desk rows, a whiteboard, two booths in the alcove. |
| `classroom.json` | 24×20 | L | Desks all facing the front, and a quiet reading corner in the wing. |
| `lounge.json` | 24×20 | L | A bar run, three separate seating groups, a quiet snug. |
| `conference.json` | 26×22 | T | Stage, screen, audience rows, and a green room behind. |

**None of them is a rectangle, and that is deliberate.** A rectangle has no
corner to be around, and under proximity audio a room with no corners is one
conversation everybody is in. The alcoves are where the zones live.

## Setup

The generated art is included in the private repository. Verify it, then:

```bash
pnpm --filter @retry/maps assets:check
pnpm --filter @retry/maps tiled
```

That writes `packages/maps/generated/tiled/` — one `.tsx` tileset per sheet plus
`retry.tiled-project`. Open the project file in Tiled; `File ▸ Open` will start
in `packages/maps/maps/`.

After every edit:

```bash
pnpm --filter @retry/maps validate     # the map contract — run this before committing
pnpm --filter @retry/maps preview lounge out.png 2   # render a map to PNG to eyeball it
pnpm --filter @retry/maps preview:all  # all five to generated/preview/*.png
```

## Editing a map without Tiled

Nobody edits a 300-entry flat gid array by hand, and there is no generator to
fall back on. `packages/maps/src/tiled.ts` is the middle path: it performs
**surgical mutations on the committed file** and writes it back in Tiled's own
format, with a stable diff.

```ts
const map = loadMap('lounge');
addTileset(map, 'shadows');                        // appends; never renumbers
fillRect(map, 'ground', 2, 2, 6, 4, woodTile);
stamp(map, 11, 5, sofa);                           // objects + above + collision
addObject(map, 'zones', { name: 'bar', zone: 'quiet', x: 32, y: 96, width: 160, height: 64 });
save(map, 'lounge');
```

It **never regenerates a map from scratch.** That distinction is the whole
point: a script that can rebuild a map will eventually be run, and will
silently eat every hand edit. If you find yourself wanting one, author the
tiles instead.

## The layer contract

The validator enforces this, and both the renderer and the room server depend on
it. Layer **names matter**; order in the Tiled panel does not.

| Layer | Type | Required | What it is |
|---|---|---|---|
| `ground` | tile | yes | The floor. Every cell filled. |
| `ground_overlay` | tile | no | Rugs, floor shadows, paths — drawn over the floor, under everything else. |
| `objects` | tile | yes | Furniture drawn **behind** people: the base of anything you bump into, and wall-hung things. |
| `objects_above` | tile | no | The parts you **walk behind** — monitor tops, shelf tops, wall caps. Drawn over every avatar. |
| `collision` | tile | yes | Hidden. Any non-empty tile blocks movement. |
| `spawns` | object | yes | **Point** objects. One must be named `default`; the rest are alternate entrances. |
| `interactables` | object | yes | Rectangles with an `interactive` property. |
| `zones` | object | no | Named regions that change who hears whom. |

### The rule that makes rooms feel 3D

A tall prop is split across two layers. Its **bottom row** goes in `objects` and
is marked in `collision`; everything above it goes in `objects_above`. So a
person can stand behind a bookshelf and be hidden by its upper half, but cannot
walk through its base. Get this backwards and people walk over the furniture
(which is exactly how the world looked before this was fixed).

Wall faces stay in `objects`, deliberately: a head overlapping a wall reads as
standing against it, which is right.

### Interactables

Rectangles on the `interactables` layer, with custom properties:

- `interactive` (string) — one of `door`, `whiteboard`, `exit`, `seat`, `board`,
  `podium`. Anything else is a validation error.
- `label` (string, optional) — the hint text. Without it the renderer falls back
  to a generic string per kind.
- `door_slot` (int) — **required on doors**, unique per map. A Commons door slot
  is anonymous in the map; which room owns it is assigned from the database at
  runtime, never baked in.
- `facing` (string) — **required on seats**: `up`, `down`, `left` or `right`.
  Which way the sitter looks.

Pressing `E` within one tile of the rectangle activates it. The **nearest**
interactable wins, not the first in map order — a chair you are standing on has
to beat a door one tile away, or sitting at a desk beside a doorway walks you
into the next room.

### Seats

A seat is a one-tile rectangle on the tile a sitter occupies, which for the
catalogue's 1×2 chair blocks is the **lower** tile.

**The tile must be walkable.** Sitting moves the avatar onto it and the server
validates every position against the collision layer, so a seat on a solid
chair is a seat nobody can use — and it fails silently, as a resync that shoves
the sitter back out. That is why the sittable chair blocks (`seatFrontA`,
`seatFrontB`, `seatRight`, `seatLeft`) are `layer: 'decor'`: drawn in `objects`,
behind the avatar, with no collision. The validator rejects a seat on a
collision tile, and caught one overlapping a table the first time it ran.

Match the model to the facing. The pack's side chairs at generic (4,11) and
(5,11) have their backs on opposite sides, and a sitter with the backrest in
front of them reads as floating.

### Zones

Rectangles on the optional `zones` layer, with a `zone` property. Two kinds are
drawn by the client and mean nothing to the server; three change who hears whom
and are enforced by the proximity engine.

| `zone` | Enforced by | What it does |
|---|---|---|
| `whiteboard` | client | Camera hint: favour the board. |
| `audience` | client | Camera hint: favour the stage. |
| `spotlight` | server | Occupants are `close` to **the entire map**. |
| `booth` | server | Occupants are `close` to each other and `out` to everyone else. |
| `quiet` | server | Occupants are `out` to everyone, full stop. |

Precedence, and it is the whole design: **quiet beats spotlight beats booth
beats distance.** Someone who walked into the quiet corner asked not to be in a
call, and no stage overrides a person's own choice. `spotlight` exists because
plain proximity audio cannot do a demo at all — a presenter five tiles from the
back row is inaudible to it.

Two people in **different** booths are `out`, however close they stand. That is
what makes a booth a room rather than a rug, and the validator rejects
overlapping booths so a tile is never in two.

### Spawns

`default` is required; extra points are alternate entrances.

A new arrival lands on `default` **unless four or more people are already
standing within two tiles of it**, and only then takes the first free
alternate. The obvious rule — "the first entrance nobody is on" — is wrong
here: in a world where being near someone is being in a call with them, two
people opening the same room together would land forty tiles apart and hear
nothing. Landing on top of whoever is already there is correct; the pile it
makes is cosmetic and resolves the moment anyone walks. The alternates are for
the case they were needed for, which is a class of thirty arriving at once.

Spawn points sit at tile **centres** (`x + 0.5`). Positions on the wire are the
avatar's feet, so a spawn on a tile corner puts them on the seam between four
tiles and which tile the server thinks you are in is floating-point luck.

## Authoring with scripts

`packages/maps/authoring/` holds one script per room plus `kit.ts`, the shared
vocabulary — wall shells, floor materials, furniture placement, zones.

```bash
pnpm --filter @retry/maps author              # every room
pnpm --filter @retry/maps author lounge       # one
pnpm --filter @retry/maps preview:sheet walls3d 0 0 8 7 --scale 4
```

The scripts are **disposable**; the maps they write are the artefact. Re-running
one is how you iterate on a room you are looking at, not how the maps are
produced — open the JSON in Tiled afterwards and nudge a chair, and nothing
will erase it unless someone re-runs the script on purpose.

### The order inside a room script

It is not arbitrary, and getting it wrong is not a crash:

1. `blank` + `resize`
2. `shell` for each rectangle, then `opening` through the shared walls
3. `floor` for each region
4. **`seal`** — anything with no floor becomes solid, which is what legalises a
   non-rectangular room
5. **`castShadows`** — derived from the collision layer as it stands *now*
6. furniture, seats, zones, spawns
7. `dropUnusedTilesets` + `save`

Steps 4–6 are the ones that matter. Cast shadows *after* the furniture and every
desk and bookshelf gets one too, which sounds better and looks far worse: the
pack already draws each object's own contact shadow, and the floor becomes a
field of grey smudges with a room somewhere underneath.

### The wall kit

`walls3d` is not a set of wall tiles. It is a nine-slice of a wall **solid**
seen from slightly above, with a lit cap and a shaded face — which is what gives
a room height instead of an outline. Of its six materials only `wood` and
`plaster` read as walls; the rest come out as a coloured band round the floor.

Every part of a wall goes on `objects`, **not** `objects_above`. The
walk-behind layer is for things you can stand on the tile of; nobody stands
inside a wall, so putting caps above the player buys nothing.

## Things that will bite you

- **Judge a floor by rendering a map, never by the tile.** Most of this sheet's
  "floors" are designed as 3×2 units with a lit edge around the unit. They look
  perfectly flat in a sheet preview and tile into a lattice of offset
  rectangles across a whole room. The Commons and the conference room shipped
  that way. Where a material has that edge, repeat a single interior tile
  (`FLOORS.carpet` is one tile, not a block); where it genuinely tiles — the
  wood boards — the 3×2 block gives a better grain.
- **Re-authoring the Commons moves its door slots**, and the room server maps
  rooms onto slots BY COORDINATE. Every existing public room would keep a door
  nobody can see. The API reconciles at boot (`reconcileDoors`), so this
  self-heals — but if you change the slot layout, restart the API before
  wondering where the doors went.

- **Do not convert embedded tilesets to external ones.** Our map JSON embeds its
  tilesets. Phaser's Tiled parser cannot follow an external `.tsx` reference and
  will render an empty room without erroring. The `.tsx` files are for Tiled's
  palette only.
- **Only declare tilesets you use.** Each map pins its own `firstgid` values, so
  a map that uses three sheets should declare three. This is also why adding a
  sheet to `assets.config.ts` never renumbers an existing map.
- **Tile size is 32×32** and the validator rejects anything else.
- **Every gid must resolve** inside a declared tileset. The validator checks this
  (flip/rotate flags masked off), because a stray gid renders as garbage.
- **Moving furniture moves people.** `room_members.last_position` stores where
  someone stood; if you delete the floor under a stored position, they will spawn
  inside a wall and get resynced out of it. Prefer editing rooms nobody is in.
- **The room server reads these files too** — `collision`, `spawns` and
  `interactables` only, never the art. A map that fails `pnpm validate` will
  crash the room server at boot rather than degrade.

## Adding a template

1. Author the map as `packages/maps/maps/<name>.json`.
2. Export it from `packages/maps/package.json`.
3. Register it in `templates` in `apps/room-server/src/world/maps.ts` (geometry)
   and in `ROOM_MAP_TEMPLATES` + `ROOM_MAP_TEMPLATE_LABELS` in
   `packages/types/src/rooms.ts` (what the create form offers).
4. Add it to `TEMPLATES` in `apps/web/src/features/rooms/game/RoomScene.ts`.
5. `pnpm --filter @retry/maps validate` and `pnpm -r test`.

## Finding a tile in 5,470 numbered objects

There is no catalogue. The pack numbers its objects rather than naming them, so
the only reliable method is to render and look:

```bash
pnpm --filter @retry/maps preview conference out.png 2
```

Judge every choice from a rendered map, never from a sheet preview. The pack's
grid is actively misleading — earlier passes shipped a "conference table" that
was two shelf strips, audience chairs that were backpacks, and a "round table"
that was a crate stacked on a sofa arm. All three looked correct in the sheet.
