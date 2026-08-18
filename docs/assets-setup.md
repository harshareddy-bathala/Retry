# Art assets

The world's art is **LimeZu "Modern Interiors"**, a paid pixel-art pack. Its licence
lets us use and edit it in this project but **not redistribute it**.

**This repository is private and tracks both the source pack** (`assets/`) **and its
generated runtime output** (`packages/maps/generated/`). A clone gets everything it
needs to run the world, with no separate art download or build step.

> **Before this repository is ever made public**, both paths have to be removed from git
> history first — not just deleted in a new commit. Publishing those sheets is
> distribution, which the licence forbids. This is the one thing in this document that
> is not reversible after the fact.

## Verification

Run this optional check before a browser drive:

```bash
pnpm --filter @retry/maps assets:check
```

## Regenerating assets

The source pack arrives with the clone at `assets/moderninteriors-win/`. Only run the
asset build after intentionally changing the art pipeline or source pack:

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

Review and commit all resulting `packages/maps/generated/` changes, then run
`pnpm --filter @retry/maps assets:check` to confirm the licensed art is on disk.

## Without the pack

The stub path still exists, for a checkout where `assets/` is missing or stripped:
`pnpm -r build` and every test suite pass anyway, because the asset build emits typed
stubs (`source: 'absent'`, empty tileset and character catalogues) so imports resolve.
The Rooms routes detect the stub and render a screen pointing here. The API and room
server are unaffected — they read map geometry, never pixels.

CI clones both asset paths, so it has real art. The stub path is a fallback now, not
the tested-by-default path; exercise it deliberately if you rely on it.

## Two licences ship in that download — this matters

The original archive contains **both** versions, under one root:

| Directory | Licence |
|---|---|
| `assets/moderninteriors-win/` | Full version. Commercial use allowed. **This is what is committed.** |
| `assets/Modern_Interiors_Free_v2.2/` | Free version. **Non-commercial only.** Deleted, never committed. |

Building from the free version would put non-commercially-licensed art into a product
serving 5,000 students. It was deleted before the pack was committed, precisely so it
could not end up in this repository's history — but the guard that stops the build
reading it is still in place and should stay there: `assets.config.ts` names the full
pack explicitly via `PACK_DIR`, lists the free directory in `FORBIDDEN_DIRS`, and the
build verifies `LICENSE.txt` says `MODERN INTERIORS FULL VERSION LICENSE` before it
copies a single file. Do not work around that check, and do not re-extract the free
version into `assets/`.

`assets/Modern_Interiors_RPG_Maker_Version/` is also present in the download and in
this commit. It is the RPG Maker port — a different engine's format, referenced by
nothing in this codebase. It is ~11 MB of dead weight and can be deleted whenever
someone wants to.

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
