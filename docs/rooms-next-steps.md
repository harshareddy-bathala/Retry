# Rooms — where the world stands, and what to do next

Written at the end of the "make the rooms real with the licensed art" track
(branch `worktree-rooms-pack-world`, five commits). This is the handover: what
exists now, what to do first when you sit down, and what is deliberately left.

---

## Do this first (15 minutes)

You have never seen this branch render. Before deciding anything else, look at it.

```bash
git checkout worktree-rooms-pack-world
pnpm install

# The art pack is REQUIRED now. If assets/moderninteriors-win/ is not in this
# checkout, copy or symlink it from wherever you keep it.
pnpm --filter @retry/maps assets:build
pnpm --filter @retry/maps assets:check      # must print "licensed pack present and built"

pnpm --filter @retry/db migrate             # migration 0006 moves avatars to users
pnpm dev
```

Then walk through this, in order. It takes about ten minutes and covers
everything the track changed:

1. Open `/world`. **The character creator opens** because you have never chosen.
   Cycle skin / eyes / outfit / hair / extra — the preview walks as you change it.
   Save.
2. Walk with WASD. Check all four facings look right, and that your **shadow**
   follows your feet.
3. Walk **behind** a bookshelf or a desk — your lower half should disappear
   behind it, and you should not be able to walk through its base.
4. Walk up to a **door** in the Commons — it swings open, and shuts when you
   leave. A knock/invite-only room's door has a lock plate.
5. Press `E` at an open door to enter that room.
6. In the lounge, watch the **coffee machine** brew and the **cat**.
7. Open a second browser as another student. Check you see each other's
   characters, that whoever stands further south draws in front, and that the
   video bubbles sit above the name tags rather than on them.
8. Click **Change look** in the bottom-left and rebuild your character. It
   should persist into a different room and across a reload.
9. Create a room of each template (Studio / Classroom / Lounge / Conference)
   and confirm each looks like a different place.

If any of that is wrong, that is the first thing to fix — the automated drives
cover it, but drives assert; eyes judge.

---

## What exists now

| Commit | What it did |
|---|---|
| `892549d` | The pack is required. All programmer art deleted. Character strips cropped from the generator. |
| `fbcebf9` | The character creator; avatars moved per-user (migration 0006). |
| `59dac01` | Y-sorting and the `objects_above` walk-behind layer. |
| `f74b9aa` | Five room templates, the prop-block catalogue, Tiled authoring. |
| `dd7855e` | Animated pack doors and ambient objects. |

Docs worth reading before you touch anything:
`docs/assets-setup.md` (the pack, and why CI can never render),
`docs/authoring-maps.md` (the layer contract and its traps),
`packages/maps/README.md` (the pipeline).

---

## Next steps, in the order I would do them

### 1. Spend an evening in Tiled — highest value per hour

This is the one thing I could not do for you, and it is now the biggest gap
between "the art is wired up" and "this feels like a place". The five maps are a
**programmatic first pass**: correct, furnished, and a bit regular. A human
placing furniture will beat it in an hour.

```bash
pnpm --filter @retry/maps tiled     # writes the project + .tsx tilesets
# open packages/maps/generated/tiled/retry.tiled-project
pnpm --filter @retry/maps validate  # after every session, before committing
```

Read the "Things that will bite you" section of `docs/authoring-maps.md` first —
especially: **do not convert the embedded tilesets to external ones**, because
Phaser cannot follow an external `.tsx` and will render an empty room without
erroring.

What to fix while you are in there, roughly in order of how much it shows:
- **The Commons is too empty in the middle.** It is the first room anyone sees.
- **Break up the grid.** Rows of identical desks read as generated. Rotate a
  chair, angle a rug, leave a mug out.
- **Wall decoration.** Every room has bare walls above the furniture line;
  the pack has posters, windows, whiteboards and shelves for exactly this.
- **The studio's floating globe** at (18,8) — its stand tile did not come with
  it. Either place the whole 1×2 block or move it onto a desk.

### 2. Finish the typing indicator (deliberately deferred)

The pack's UI atlas (`UI_thinking_emotes_animation_32x32.png`, 10×10 frames)
is catalogued and unused. Showing "someone is typing" over an avatar needs:

- a `typing` client→server message in `packages/protocol/src/events.ts`,
- fan-out in `RoomHub` (rate-limited — it will fire on every keystroke),
- a sprite above the avatar in `RoomScene`, cleared on a timeout.

I left it out because it is protocol work wearing an art costume, and it did
not belong in the commit that finished the art. It is a clean half-day.

### 3. Grow the tile catalogue as you need it

`packages/maps/tiles.catalog.ts` covers ~65 props out of 5,470 objects. The
workflow that works:

```bash
npx tsx scripts/preview-sheet.ts generated/tilesets/<sheet>.png out.png 0 16 2
npx tsx scripts/preview-blocks.ts out.png    # ALWAYS run after editing
```

**Run `preview-blocks` after every catalogue edit.** It caught a conference
table that was two shelf strips, audience chairs that were backpacks, and
several beds catalogued as tables — all before they reached a map. The pack's
grid is misleading and your eye is the only real check.

### 4. Things I would watch in the first week of real use

- **Texture memory.** Each distinct character costs ~393 KB of GPU memory. Fine
  for a room of twenty; if a Commons ever holds a hundred students with a
  hundred different looks, the cache in `compose-avatar.ts` will need an
  eviction policy. Today it only clears on scene shutdown.
- **The six-door ceiling.** The Commons has exactly six door slots, so the
  seventh public room silently fails to claim one (the API returns 409). That
  was fine as a demo constraint and is now a product decision to make: more
  doors, a second atrium, or a directory that is not spatial.
- **`room_members.last_position`.** Re-authoring a room moves the floor under
  stored positions. People spawn inside walls and get resynced out. Prefer
  editing rooms nobody is standing in.
- **The presence strip sometimes reads "RECONNECTING…" while the world is
  plainly working** — snapshot applied, other people visible, movement
  relaying. I saw it in two drive screenshots after rapid navigation. It looks
  like the socket status not settling back to `open` rather than a real
  disconnect, and it predates this track (nothing here touches
  `room-socket.ts`), but it is the kind of thing a student will screenshot and
  ask about. Worth ten minutes with `roomEvents.on('net:status')`.

### 5. Before this is student-facing

- **Mobile / small viewports.** Zoom is picked from viewport height and clamps
  at 2; nobody has looked at this on a phone.
- **Accessibility.** The world is a canvas with no keyboard-only alternative and
  no screen-reader story. The Workspace view is the accessible path today —
  that is worth being deliberate about rather than accidental.
- **The pack licence.** Credit is carried in `packages/maps/art/ATTRIBUTION.md`
  by project decision. If the product ever gets an about/credits screen,
  `limezu.itch.io` belongs on it.

---

## Things you should know that are not obvious

Measured during this work, and easy to get wrong later:

- Character frames are **32×64**, on a **56×20** grid. Row 1 is idle, row 2 is
  walk, and the direction order inside a row is **right, up, left, down** — not
  the order the old hand-drawn sheets used.
- **Body sheets are 1854 px wide; every other layer is 1792.** 57 columns
  against 56. Address frames by (column, row), never by linear index, or the
  body drifts one frame per row against the clothes.
- **Animated objects are palette-indexed PNGs**, unlike everything else in the
  pack. `art/png-decode.ts` handles both now.
- A map declares **only the sheets it uses** and pins its own `firstgid`s, so
  adding a tileset to `assets.config.ts` can never renumber an existing map.
- Catalogue ids (`body_03`, `outfit_07`) are **persisted per user**. Add freely;
  never rename or remove one that someone may have chosen.

---

## The verification that exists

- **130 automated tests** (`pnpm -r test`): 89 room-server WS, 17 map/validator,
  12 protocol, 12 API.
- `pnpm -r build` passes **with and without** the art pack — without it the app
  builds and shows a setup screen rather than throwing.
- Four browser drives were written and run against a real stack (8/8, 8/8, 6/6,
  7/7). They were throwaway scripts, not committed; if you want them as a
  permanent suite, that is a real piece of work (a Playwright harness) rather
  than a copy-paste of what I used.
