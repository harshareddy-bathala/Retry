# Authoring rooms

The five room templates in `packages/maps/maps/` are **the only source of
truth**. There is no generator and nothing regenerates them: you either edit
them in [Tiled](https://www.mapeditor.org/) or mutate them in place with
`packages/maps/src/tiled.ts`, and then you look at the render.

| Template | Room |
|---|---|
| `commons.json` | The atrium everyone arrives in. Twelve door slots along the north wall. |
| `studio_a.json` | The default project room — PC desks facing a whiteboard. |
| `classroom.json` | Desk rows and a blackboard, for crits and study groups. |
| `lounge.json` | Coffee bar, sofas, a fireplace. |
| `conference.json` | Projection screen, podium, big table — for rehearsing a demo. |

## Setup

You need the art pack built first (`docs/assets-setup.md`), then:

```bash
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
| `spawns` | object | yes | A **point** object named `default` — where people appear. |
| `interactables` | object | yes | Rectangles with an `interactive` property. |

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

- `interactive` (string) — one of `door`, `whiteboard`, `exit`, `seat`. Anything
  else is a validation error.
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
