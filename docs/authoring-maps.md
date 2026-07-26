# Authoring rooms

The five room templates in `packages/maps/maps/` are **hand-authored source**.
They were produced once by `scripts/seed-maps.ts` to give every room a furnished
first pass; from here on you edit them in [Tiled](https://www.mapeditor.org/) and
the JSON is the truth. Nothing regenerates them.

| Template | Room |
|---|---|
| `commons.json` | The atrium everyone arrives in. Six door slots along the north wall. |
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
```

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

- `interactive` (string) — one of `door`, `whiteboard`, `exit`. Anything else is
  a validation error.
- `door_slot` (int) — **required on doors**, unique per map. A Commons door slot
  is anonymous in the map; which room owns it is assigned from the database at
  runtime, never baked in.

Pressing `E` within one tile of the rectangle activates it.

## Things that will bite you

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

## The tile catalogue

`packages/maps/tiles.catalog.ts` names floors, wall styles and ~65 furniture
blocks by sheet coordinate, because the pack ships 5,470 objects numbered rather
than named. It is what the seeder drew from, and the place to record any prop you
find worth reusing. Two tools help:

```bash
npx tsx scripts/preview-sheet.ts generated/tilesets/<sheet>.png out.png 0 16 2
npx tsx scripts/preview-blocks.ts out.png    # contact sheet of the catalogue
npx tsx scripts/preview-walls.ts walls 23 0 13 out.png   # wall row-pair candidates
```

`preview-blocks` is worth running after any catalogue edit — it caught a
"conference table" that was two shelf strips, and several beds catalogued as
tables, before either reached a map.
