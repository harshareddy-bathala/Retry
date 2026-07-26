// Named tiles, picked by eye out of the pack.
//
// LimeZu ships 5,470 objects numbered, not named — `Classroom_Singles_137.png`
// tells you nothing. So every tile the maps use is catalogued here as a sheet
// plus a grid coordinate, read off `npx tsx scripts/preview-sheet.ts`, which
// renders a sheet with `col,row` printed under each cell.
//
// Grow this list rather than putting raw numbers in a map.

export type TileRef = { sheet: string; col: number; row: number };

const at = (sheet: string, col: number, row: number): TileRef => ({ sheet, col, row });

/** Floors are 3x2 tileable blocks; we take the whole block and vary by position. */
export const FLOORS = {
  // Warm oak planks — project rooms.
  wood: [
    [at('floors', 0, 18), at('floors', 1, 18), at('floors', 2, 18)],
    [at('floors', 0, 19), at('floors', 1, 19), at('floors', 2, 19)],
  ],
  // Pale stone — the Commons, so the two read as different places.
  stone: [
    [at('floors', 0, 22), at('floors', 1, 22), at('floors', 2, 22)],
    [at('floors', 0, 23), at('floors', 1, 23), at('floors', 2, 23)],
  ],
} as const;

/**
 * A wall run is two tiles tall: the upper carries the cap you look down on, the
 * lower carries the skirting that meets the floor. Left/middle/right let a run
 * finish properly at a corner.
 */
export const WALLS = {
  plain: {
    upperL: at('walls', 4, 2),
    upperM: at('walls', 5, 2),
    upperR: at('walls', 6, 2),
    lowerL: at('walls', 4, 3),
    lowerM: at('walls', 5, 3),
    lowerR: at('walls', 6, 3),
  },
} as const;

/** Classroom + library furniture. Most objects are two or three tiles tall. */
export const PROPS = {
  /** Desk with a monitor: monitor, desktop, desk front. */
  deskPc: [at('classroom', 3, 10), at('classroom', 3, 11), at('classroom', 3, 12)],
  deskPc2: [at('classroom', 5, 10), at('classroom', 5, 11), at('classroom', 5, 12)],
  /** Filled bookshelf, three tiles tall. */
  shelf: [at('classroom', 4, 7), at('classroom', 4, 8), at('classroom', 4, 9)],
  shelf2: [at('classroom', 8, 7), at('classroom', 8, 8), at('classroom', 8, 9)],
  /** Green board on a stand. */
  board: [at('classroom', 10, 5), at('classroom', 10, 6)],
  /** Student desk and chair. */
  desk: [at('classroom', 3, 3), at('classroom', 3, 4)],
  /** Printer. */
  printer: [at('classroom', 0, 10), at('classroom', 0, 11)],
  /** Cork noticeboard. */
  notice: [at('classroom', 0, 6)],
} as const;
