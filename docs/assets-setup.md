# Art assets — one-time setup

The world's art is **LimeZu "Modern Interiors"**, a paid pixel-art pack. Its licence
lets us use and edit it in this project but **not redistribute it**, and this repository
is public — so the pack is not in git, and neither is anything generated from it.

You need your own copy. It costs about **$8** (it was $1.20 at launch; check the page).

## Setup

1. Buy and download the **full** pack from <https://limezu.itch.io/moderninteriors>.
   Get the Windows/generic download, not the RPG Maker one.
2. Extract it into `assets/` at the repository root so the path
   `assets/moderninteriors-win/LICENSE.txt` exists.
3. Run the asset build:

   ```bash
   pnpm --filter @retry/maps assets:build
   ```

   It prints what it took and how much of the pack is still untouched:

   ```
   art: LimeZu Modern Interiors
     9 tilesets
     9 body / 7 eyes / 24 outfit / 24 hair / 12 accessory
     coverage: 85 sheets in use, 5470 single objects available to draw on
   ```

`assets/` and `packages/maps/generated/` are both gitignored. Nothing you download and
nothing the build produces from it can be committed.

## Without the pack

The build still works. It emits a small placeholder set — flat tiles and a stick figure,
drawn by us and licence-free — so a fresh clone can `pnpm build`, run the tests, and walk
around a (very ugly) world. The app logs a warning at boot saying which art is loaded.

This is also what CI uses: `pnpm -r build` must pass on a machine that has never seen the
pack.

## Two licences live in that download — this matters

The archive contains **both** versions:

| Directory | Licence |
|---|---|
| `assets/moderninteriors-win/` | Full version. Commercial use allowed. **Use this.** |
| `assets/Modern_Interiors_Free_v2.2/` | Free version. **Non-commercial only.** |

Building from the free version would put non-commercially-licensed art into a product
serving 5,000 students. `assets.config.ts` names the full pack explicitly, the build
refuses to read from the free directory, and it verifies `LICENSE.txt` says
`MODERN INTERIORS FULL VERSION LICENSE` before it copies a single file. Do not work
around that check.

## What we take, and how to take more

`packages/maps/assets.config.ts` is the only list. Adding a themed tileset or more
outfits is an edit there and a rebuild — never a stray file copied by hand.

Two constraints that are not obvious:

- **Never load `Interiors_32x32.png`.** It is 512×34,048 px, taller than the 16,384 px
  texture limit on a lot of GPUs and most mobile chips. It would fail to upload as a
  single WebGL texture — on some machines silently. Use the per-theme sheets, which top
  out at 512×3,904. The build enforces this.
- **Character frames are 32×64**, one tile wide and two tall, so a head can overlap the
  tile behind it. That is not the same as the 32×32 avatars the world used before.

## Credit

The pack's licence line reads `Credits required (limezu.itch.io)`. By project decision the
credit is carried in `packages/maps/art/ATTRIBUTION.md` rather than in the product UI.
