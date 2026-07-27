# Why the rooms look broken — diagnosis and the correct approach

Written after seeing `studio_a` in the browser. The world renders, moves and
sorts correctly, but the **furniture and walls are wrong**, and the cause is one
decision, not many small bugs.

## The single root cause

`packages/maps/scripts/seed-maps.ts` builds rooms by **slicing rectangles out of
the packed theme sheets** at `(col, row, width, height)` coordinates picked by
eye in `packages/maps/tiles.catalog.ts`.

That is "coding the tiles". The packed sheets are **display arrangements**, not a
grid of neatly boxed objects — objects have irregular footprints, share tiles
with their neighbours, and are grouped into wide compositions. A tidy 1×3 or 2×2
rectangle almost never corresponds to one object.

Everything that looks whole in the screenshots (characters, the cat, the coffee
machine, the rugs, the floors) comes from a **whole file or a whole frame**.
Everything that looks half-finished comes from a **slice**. That is the pattern.

## Exactly what is wrong

### 1. Furniture — rectangles cut across object boundaries

| Catalogue entry | What I claimed | What that region actually is |
|---|---|---|
| `deskPc` = `classroom (3,10) 1×3` | "desk with a monitor" | **one column out of a 4-tile-wide reception counter** — hence a monitor floating over a white blob over an orange box |
| `sofaRed` = `generic (6,10) 3×2` | "red three-seater sofa" | **beds** (the pink things bottom-right of screenshot 2) |
| `shelfBooks` = `classroom (4,7) 1×3` | "filled bookshelf" | grocery/vending shelving with bottles |
| `globe` = `classroom (13,0) 1×2` | globe on a stand | the globe only — its stand is not in that box |
| `notice` = `classroom (0,6) 1×1` | cork noticeboard | a 1-tile fragment |

The `preview-blocks` contact sheet *did* render these. At 2× in a six-column
grid a one-tile slice of a wide counter still reads as a plausible desk, so my
eye passed them. The tool was fine; the method was wrong.

### 2. Walls — the front-facing tile was used for the side walls

`Room_Builder_Walls_32x32.png` provides, per style: a **3-wide horizontal run**
(left / middle / right), a **separate narrow vertical piece** for side walls, and
corner pieces. Verified by rendering rows 6–11 at 3×.

The seeder takes a single `(upper, lower)` pair and repeats `lower` down the left
and right columns and along the bottom. So the front face — including its orange
baseboard strip — repeats vertically. That is precisely the blue-block-and-orange-
stripe ladder on both edges of screenshot 1, and why the south wall reads as a
floor stripe instead of a wall.

Floors are the one thing that works, because they genuinely *are* 3×2 tileable
blocks — the only case where the sheet's grid matches what I assumed.

## What the pack already gives you (use these instead)

1. **`1_Interiors/32x32/Theme_Sorter_Singles_32x32/` — 5,470 PNGs, one whole
   object per file.** Classroom alone has 249. This folder exists specifically so
   nobody has to guess a bounding box. **This is the correct source for every
   piece of furniture.** No slicing, no footprint guessing.

2. **`6_Home_Designs/` — 14 complete rooms the artist composed**, as layered
   PNGs: Museum ×5, Gym ×2, Generic Home, Japanese Home, Condominium ×2, Ice
   Cream Shop, TV Studio, Shooting Range. Correct walls, correct furniture,
   correct composition — finished rooms, free.

3. **`Room_Builder_32x32.png`** (2432×3616, safe as one texture) with Tiled
   **terrain / Wang sets**, which is the intended way to paint walls so corners
   and edges resolve themselves instead of being hand-indexed.

## The brief for the next chat

**Delete, don't patch:**
- `packages/maps/scripts/seed-maps.ts`
- the `BLOCKS`, `WALLS` and per-room `FLOORS` coordinate tables in
  `packages/maps/tiles.catalog.ts`
- the five seeded maps in `packages/maps/maps/` (`commons`, `studio_a`,
  `classroom`, `lounge`, `conference`) — they are made of the bad slices

**Rebuild the art side as:**
- an asset step that takes **Singles** (object-per-file) and emits them as Tiled
  tiles / image objects placed whole — one file, one object, never a sub-rectangle
- rooms sourced from **Home Designs** (drop the composed layers in as the room's
  art, with a hand-authored `collision` layer on top), or painted in **Tiled with
  terrain sets** for walls
- no coordinate tables written by hand

**Keep — these are correct and verified:**
- the whole character pipeline: 32×64 whole frames from the generator, the
  runtime compositor, the creator UI, per-user persistence (migration 0006)
- animated objects (whole strips: doors, coffee, cat, candle, server, sprout)
- y-sorted depth, the `objects_above` walk-behind layer, shadows
- the map contract validator, door open/shut logic, per-map tileset subsetting
- `art/png-decode.ts` (RGBA + palette-indexed)
- the CI art-stub step

**Constraint to state up front:** every pixel comes from the bought pack, used as
whole assets. Nothing is drawn in code, and no room layout is generated from
coordinate tables.

## Useful context for whoever picks this up

- Sheets and their real dimensions are in `packages/maps/generated/manifest.json`.
- `scripts/preview-sheet.ts`, `preview-strip.ts` and `preview-map.ts` are still
  useful — they are how the above was diagnosed. `preview-blocks.ts` becomes
  obsolete along with the block table.
- The geometry facts worth not rediscovering are in
  `packages/maps/art/ATTRIBUTION.md` (32×64 frames, 56×20 grid,
  right/up/left/down direction order, 1854px body sheets, palette-indexed
  animated objects).
