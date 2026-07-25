# Art attribution

Every pixel in `tilesets/retry.png` and `avatars/*.png` is **original work generated
by the code in this directory** (`pnpm --filter @retry/maps art`). No third-party
tileset, sprite pack or asset store download is used, so there is nothing to
attribute and no licence to comply with — the art is ours under the same terms as
the rest of the repository.

That was a constraint as much as a choice: the art was authored in a session
without access to asset marketplaces. It is deliberately *swappable*. The map
JSONs reference tiles by grid index into one sheet, and the client loads avatars
by preset key, so replacing either with commissioned or licensed art means
dropping in PNGs with the same geometry:

| Asset | Geometry |
|---|---|
| `tilesets/retry.png` | 32x32 tiles, 6 columns, row-major, order fixed by `TILES` in `art/tiles.ts` |
| `avatars/<key>.png` | 128x128: 4 columns (idle, walk1, walk2, walk3) x 4 rows (down, left, right, up), 32x32 frames |

If a pack or a commission replaces these, record its licence here — name, source,
licence, and whether attribution is required in-product.
