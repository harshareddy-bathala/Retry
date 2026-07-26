# Art assets — one-time setup (required)

The world's art is **LimeZu "Modern Interiors"**, a paid pixel-art pack. Its licence
lets us use and edit it in this project but **not redistribute it**, and this repository
is public — so the pack is not in git, and neither is anything generated from it.

**The pack is required to run the app.** There is no placeholder art: a clone without
the pack still builds and passes tests, but the Rooms world shows a setup screen
instead of rendering. Every developer needs their own copy.

It costs about **$8** (it was $1.20 at launch; check the page).

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
     15 tilesets
     9 body / 7 eyes / 20 outfit / 20 hair / 12 accessory
     coverage: 83 sheets in use, 5470 single objects available to draw on
   ```

4. Before a browser drive, `pnpm --filter @retry/maps assets:check` confirms the
   licensed art is what's on disk (exits 1 otherwise).

`assets/` and `packages/maps/generated/` are both gitignored. Nothing you download and
nothing the build produces from it can be committed.

## Without the pack

`pnpm -r build` and every test suite still pass: the asset build emits typed stubs
(`source: 'absent'`, empty tileset and character catalogues) so imports resolve. The
Rooms routes detect the stub and render a screen pointing here. The API and room
server are unaffected — they read map geometry, never pixels.

This is also what CI uses: `pnpm -r build` must pass on a machine that has never seen
the pack, and CI can never render the world. That is deliberate; do not "fix" it by
committing pack-derived files or fetching the pack in CI — both distribute art the
licence says we cannot.

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

`packages/maps/assets.config.ts` is the only list — tilesets *and* the character
creator's curated catalogue. Adding a themed tileset, an outfit or a hairstyle is an
edit there and a rebuild — never a stray file copied by hand. Catalogue ids are
persisted per user, so entries may be added but never renamed or removed once chosen.

Constraints that are not obvious:

- **Never load `Interiors_32x32.png`.** It is 512×34,048 px, taller than the 16,384 px
  texture limit on a lot of GPUs and most mobile chips. It would fail to upload as a
  single WebGL texture — on some machines silently. Use the per-theme sheets, which top
  out at 512×3,904. The build enforces this.
- **Character frames are 32×64**, one tile wide and two tall, so a head can overlap the
  tile behind it.
- **Character sheets must be addressed by (column, row), never linear frame index.**
  Body sheets are 1854 px wide (57 columns); every other layer is 1792 (56). The build
  crops everything to a common 768×128 strip (idle + walk, 24 frames per row in
  right/up/left/down order) so downstream code never sees the mismatch.

## Credit

The pack's licence line reads `Credits required (limezu.itch.io)`. By project decision the
credit is carried in `packages/maps/art/ATTRIBUTION.md` rather than in the product UI.
