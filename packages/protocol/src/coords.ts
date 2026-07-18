// Coordinate system contract (see README.md for the full rationale):
// - the server reasons in TILE coordinates (integers)
// - the client renders in PIXEL coordinates
// - proximity thresholds in the SRS are specified in tiles

export const TILE_SIZE = 32;

/** Tile coordinate → pixel coordinate of the tile's top-left corner. */
export function tileToPixel(tile: number): number {
  return tile * TILE_SIZE;
}

/** Tile coordinate → pixel coordinate of the tile's centre (avatar anchor). */
export function tileToPixelCenter(tile: number): number {
  return tile * TILE_SIZE + TILE_SIZE / 2;
}

/** Pixel coordinate → the tile that contains it. */
export function pixelToTile(px: number): number {
  return Math.floor(px / TILE_SIZE);
}
