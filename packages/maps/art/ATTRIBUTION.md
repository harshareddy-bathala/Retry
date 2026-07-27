# Art attribution

## The world

**LimeZu — "Modern Interiors"**, <https://limezu.itch.io/moderninteriors>

Tilesets, furniture, animated objects and the layered character generator all come from
this pack. **The licence line reads `Credits required (limezu.itch.io)`.** By project decision that
credit lives here rather than in the product UI.

Licence, verbatim, from `assets/moderninteriors-win/LICENSE.txt`:

> MODERN INTERIORS FULL VERSION LICENSE
>
> YOU CAN:
> - Edit and use the asset in any commercial or non commercial project
> - Use the asset in any commercial or non commercial project
>
> YOU CAN'T:
> - Resell or distribute the asset to others
> - Edit and resell the asset to others
>
> Credits required (limezu.itch.io)

### What that means for this repository

Shipping a compiled app with the sprites baked in is **using** the asset, which is
allowed. Publishing the sheets in a public git repository, where anyone can download
them, is **distributing** it, which is not. So:

- `assets/` (the pack) and `packages/maps/generated/` (anything built from it) are
  gitignored. Neither may ever be committed.
- Every developer obtains their own copy — see `docs/assets-setup.md`.
- Deploys need the pack on the build machine; it is not fetched from this repo.

The download also contains `Modern_Interiors_Free_v2.2/`, which carries a **different,
non-commercial** licence. The build refuses to read from it.

## The placeholder art

`packages/maps/art/` — the pixel toolkit (`canvas.ts`, `png.ts`) and `fallback.ts` are
original work written for this project, under the same terms as the rest of the
repository. They exist only so the repo builds and runs without the licensed pack.

## Geometry, for whoever touches this next

- **Tiles are 32×32.** Character frames are **32×64** — one tile wide, two tall,
  so a head overlaps the tile behind it.
- Character generator sheets are a **56 × 20** grid of those frames. Row 1 is
  idle, row 2 is walk, six frames per direction, and the direction order inside
  a row is **right, up, left, down**.
- **Body sheets are 1854 px wide; every other layer is 1792.** That is 57
  columns against 56, so frames must be addressed by (column, row) and cropped
  to a common grid — never by linear frame index.
- Tilesets and character sheets are RGBA PNGs. The **animated objects are
  palette-indexed** PNGs (colour type 3) with `tRNS` transparency.

## Replacing the art

Both tilesets and characters are addressed through
`packages/maps/generated/manifest.json`, so a commissioned or differently-licensed
replacement is a matter of matching geometry:

| Asset | Geometry |
|---|---|
| Tilesets | 32×32 tiles; any sheet under 16,384 px in both dimensions |
| Character layers | 32×64 frames on a 56×20 grid, composited body → eyes → outfit → hair → accessory |

If you replace either, record the new source, its licence, and whether in-product
attribution is required, here.
