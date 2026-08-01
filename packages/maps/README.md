# @retry/maps

The world's data: the five room templates, the art pipeline that turns the
licensed LimeZu pack into what the app imports, and the map contract validator.

Maps are shared by the client (rendering) and the room server (collision,
spawns, interactables) — both load the **same JSON**, so the two can never
disagree about where a wall is.

## You need the art pack

Nothing here renders without it, and it cannot be committed. One-time setup:
[`docs/assets-setup.md`](../../docs/assets-setup.md). Then:

```bash
pnpm --filter @retry/maps assets:build   # pack → generated/ (gitignored)
pnpm --filter @retry/maps assets:check   # is real art built? (exits 1 if not)
```

Without the pack the build emits typed **stubs** so `pnpm -r build` and the
tests still pass; the app shows a setup screen instead of a world.

## Layout

| Path | What |
|---|---|
| `maps/*.json` | The five templates. **The only source of truth** — nothing regenerates them. |
| `assets.config.ts` | The only list of what we take from the pack: tilesets, character catalogue, animation rows. |
| `src/validate.ts` | The map contract. Pure, no fs — the CLI, the API and the room server all reuse it. |
| `src/tiled.ts` | Surgical mutations on a committed map: place tiles, stamp props, add a tileset, resize. |
| `art/` | PNG encode/decode + a pixel canvas. Used by the asset build and the preview tool, not at runtime. |
| `generated/` | Everything derived from the pack. Gitignored; never commit. |

## Authoring maps

See [`docs/authoring-maps.md`](../../docs/authoring-maps.md) for the layer
contract and the traps. In short:

```bash
pnpm --filter @retry/maps tiled       # writes the Tiled project + .tsx tilesets
pnpm --filter @retry/maps validate    # run before committing a map
pnpm --filter @retry/maps preview lounge out.png 2
pnpm --filter @retry/maps preview:all # every map to generated/preview/*.png
```

Edit them in [Tiled](https://www.mapeditor.org/), or mutate them in place with
`src/tiled.ts` and **look at the PNG**. There is no generator: the JSON in
`maps/` is the source, and the loop that converges is edit → validate →
preview → look.

## The map contract

Tile layers, named exactly:

| Layer | Required | Purpose |
|---|---|---|
| `ground` | yes | The floor. |
| `ground_overlay` | no | Rugs, floor shadows, paths. |
| `objects` | yes | Furniture drawn behind people; wall-hung things. |
| `objects_above` | no | The parts you **walk behind** — drawn over every avatar. |
| `collision` | yes | Invisible; **any non-empty tile blocks movement**. |

Object layers: `spawns` (a **point** named `default`) and `interactables`
(rectangles with `interactive: 'door' | 'whiteboard' | 'exit'`; doors also need
an integer `door_slot`).

The validator enforces all of that plus 32 px tiles and that **every gid
resolves inside a declared tileset** (flip flags masked) — the failure mode a
human editing in a GUI will actually hit.
`test/fixtures/studio_a_broken.json` is a deliberately broken copy that keeps
the negative path tested — do not "fix" it.

## The five templates

| Map | Size | Room |
|---|---|---|
| `commons` | 40×16 | The atrium everyone arrives in; twelve door slots north. |
| `studio_a` | 20×15 | Default project room — PC desks facing a whiteboard. |
| `classroom` | 20×15 | Desk rows and a blackboard. |
| `lounge` | 20×15 | Coffee bar, sofas, a fireplace. |
| `conference` | 20×15 | Projection screen, podium, meeting table. |

Each declares only the sheets it draws from and pins its own `firstgid` values,
so adding a tileset to `assets.config.ts` can never renumber an existing map.

## Picking tiles out of 5,470 objects

The pack numbers its objects rather than naming them, so finding the tile you
want is a matter of looking. Render a map and read it:

```bash
pnpm --filter @retry/maps preview commons out.png 1
```

Judge every tile choice from a rendered map, never from the sheet. Most of this
pack's "floors" are 3×2 units with a lit edge that looks flat in a sheet and
tiles into a lattice of offset rectangles across a room — see the floor trap in
`docs/authoring-maps.md`.
