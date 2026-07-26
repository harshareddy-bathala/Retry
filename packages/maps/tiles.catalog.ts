// Named tiles and props, picked by eye out of the pack.
//
// LimeZu ships 5,470 objects numbered, not named — `Classroom_Singles_137.png`
// tells you nothing. So everything the maps use is catalogued here as a sheet
// plus grid coordinates, read off `npx tsx scripts/preview-sheet.ts`, which
// renders a sheet with `col,row` printed under each cell.
//
// Grow this list rather than putting raw numbers in a map.

export type TileRef = { sheet: string; col: number; row: number };

const at = (sheet: string, col: number, row: number): TileRef => ({ sheet, col, row });

/**
 * Floors are 3x2 tileable blocks; we take the whole block and index by grid
 * position.
 *
 * Pick blocks whose six tiles are near-identical. Rows 16-19 look like handsome
 * wood in the preview but each block carries a large motif spanning all six
 * tiles, so tiling them across a room produced repeating barrel shapes rather
 * than a floor. A floor is background: uniform beats interesting.
 */
export const FLOORS = {
  // Pale horizontal boards — project rooms.
  wood: [
    [at('floors', 4, 12), at('floors', 5, 12), at('floors', 6, 12)],
    [at('floors', 4, 13), at('floors', 5, 13), at('floors', 6, 13)],
  ],
  // Plain cream — the Commons, so the two rooms read as different places.
  stone: [
    [at('floors', 0, 22), at('floors', 1, 22), at('floors', 2, 22)],
    [at('floors', 0, 23), at('floors', 1, 23), at('floors', 2, 23)],
  ],
  // Soft sage — the classroom.
  sage: [
    [at('floors', 12, 2), at('floors', 13, 2), at('floors', 14, 2)],
    [at('floors', 12, 3), at('floors', 13, 3), at('floors', 14, 3)],
  ],
  // Warm red herringbone parquet — the lounge.
  herringbone: [
    [at('floors', 8, 10), at('floors', 9, 10), at('floors', 10, 10)],
    [at('floors', 8, 11), at('floors', 9, 11), at('floors', 10, 11)],
  ],
  // Quiet grey carpet — the conference room.
  carpet: [
    [at('floors', 12, 10), at('floors', 13, 10), at('floors', 14, 10)],
    [at('floors', 12, 11), at('floors', 13, 11), at('floors', 14, 11)],
  ],
} as const;

export type FloorKey = keyof typeof FLOORS;

/**
 * A wall run is two tiles tall. The sheet packs each style as a row PAIR: the
 * upper tile carries the white top-edge cap baked into its top pixels plus the
 * face, the lower tile carries the face and the skirting that meets the floor.
 * One column serves a flat run; corners are still a TODO in the catalogue.
 *
 * One style per room template, so stepping through a door reads as changing
 * rooms even before the furniture registers.
 */
export const WALLS = {
  /** Pale plain — the old default, kept for reference. */
  plain: { upper: at('walls', 1, 2), lower: at('walls', 1, 3) },
  /** Teal — the Commons. */
  teal: { upper: at('walls', 23, 12), lower: at('walls', 23, 13) },
  /** Sky blue over a wood baseboard — studio_a. */
  sky: { upper: at('walls', 23, 8), lower: at('walls', 23, 9) },
  /** Warm cream — the classroom. */
  cream: { upper: at('walls', 8, 6), lower: at('walls', 8, 7) },
  /** Tan basket-weave over a cream baseboard — the lounge. */
  weave: { upper: at('walls', 12, 2), lower: at('walls', 12, 3) },
  /** Deep indigo — the conference room. */
  indigo: { upper: at('walls', 23, 4), lower: at('walls', 23, 5) },
} as const;

export type WallKey = keyof typeof WALLS;

// ---------------------------------------------------------------------------
// Prop blocks — multi-tile furniture as one named thing
// ---------------------------------------------------------------------------

/**
 * A rectangular slice of a sheet placed as a unit. The seeder (and any future
 * tool) reasons about props, not tiles:
 *
 * - `solidRows` bottom rows block movement and render in `objects`.
 * - Rows above them render in `objects_above` — the part you walk behind.
 * - `layer: 'wall'` props hang on walls: no collision, all in `objects`
 *   (actors can never reach a wall tile, so nothing needs to be above them).
 * - `layer: 'overlay'` props (rugs) render in `ground_overlay` under everything.
 * - `layer: 'decor'` props (cushions, small signs) render in `objects` with no
 *   collision — you can stand on them and draw over them.
 */
export type PropBlock = {
  sheet: string;
  col: number;
  row: number;
  w: number;
  h: number;
  solidRows: number;
  layer?: 'wall' | 'overlay' | 'decor';
};

const block = (
  sheet: string,
  col: number,
  row: number,
  w: number,
  h: number,
  solidRows: number,
  layer?: PropBlock['layer'],
): PropBlock => ({ sheet, col, row, w, h, solidRows, ...(layer ? { layer } : {}) });

export const BLOCKS = {
  // --- classroom & library ---
  /** Desk with a monitor: monitor, desktop, desk front. */
  deskPc: block('classroom', 3, 10, 1, 3, 1),
  deskPc2: block('classroom', 5, 10, 1, 3, 1),
  /** Filled bookshelf, three tiles tall. */
  shelfBooks: block('classroom', 4, 7, 1, 3, 1),
  shelfBooks2: block('classroom', 8, 7, 1, 3, 1),
  /** Green board on a stand. */
  boardStand: block('classroom', 10, 5, 1, 2, 1),
  /** Student desk with its chair, two tiles wide. */
  schoolDesk: block('classroom', 2, 3, 2, 2, 1),
  printer: block('classroom', 0, 10, 1, 2, 1),
  /** Cork noticeboard — wall-hung. */
  notice: block('classroom', 0, 6, 1, 1, 0, 'wall'),
  /** Reading desk with an open book, two seats wide. */
  deskBook: block('classroom', 5, 0, 2, 2, 1),
  /** Big wall-mounted blackboard. Two wide — col 15 is a stray chalk tray. */
  blackboard: block('classroom', 13, 5, 2, 2, 0, 'wall'),
  /** Library shelving run segment, three tall. */
  libShelf: block('classroom', 4, 6, 2, 3, 1),
  /** Tall wooden bookcase. */
  bookcase: block('classroom', 0, 12, 2, 3, 1),
  bookcase2: block('classroom', 2, 12, 2, 3, 1),
  globe: block('classroom', 13, 0, 1, 2, 1),
  /** Alphabet wall chart. */
  wallChart: block('classroom', 13, 3, 2, 1, 0, 'wall'),

  // --- living room (lounge) ---
  plantBush: block('livingroom', 10, 0, 1, 2, 1),
  plantBush2: block('livingroom', 12, 0, 1, 2, 1),
  plantPalm: block('livingroom', 14, 0, 1, 2, 1),
  /** Cream two-seater sofa facing down. */
  sofaCream: block('livingroom', 2, 7, 2, 2, 1),
  /** Grey three-seater sofa facing down. */
  sofaGrey: block('livingroom', 1, 28, 3, 2, 1),
  lampRed: block('livingroom', 11, 9, 1, 2, 1),
  lampBlue: block('livingroom', 12, 9, 1, 2, 1),
  fireplace: block('livingroom', 4, 24, 2, 2, 1),
  paintingAbstract: block('livingroom', 0, 26, 1, 1, 0, 'wall'),
  paintingFace: block('livingroom', 1, 26, 1, 1, 0, 'wall'),
  bigPlant: block('livingroom', 13, 21, 1, 2, 1),

  // --- kitchen (café bar) ---
  /** Counter segments, two tall: worktop face and base. */
  counterLeft: block('kitchen', 2, 7, 1, 2, 2),
  counterPlain: block('kitchen', 3, 7, 1, 2, 2),
  counterDrawers: block('kitchen', 4, 7, 1, 2, 2),
  counterDoors: block('kitchen', 5, 7, 1, 2, 2),
  stove: block('kitchen', 8, 10, 2, 2, 1),
  butcherTable: block('kitchen', 7, 14, 2, 2, 1),

  // --- conference hall ---
  /** Big wooden conference table. Fully solid — you sit around it, not on it. */
  confTable: block('conference', 1, 1, 4, 3, 3),
  /** Wall-mounted projection screen (fits exactly over a 2-tall wall run). */
  projScreen: block('conference', 0, 8, 5, 2, 0, 'wall'),
  podium: block('conference', 7, 2, 1, 2, 1),
  bannerRed: block('conference', 5, 4, 1, 2, 0, 'wall'),
  bannerBlue: block('conference', 7, 4, 1, 2, 0, 'wall'),
  // NOTE: conference cols 11-14 rows 5-8 look chair-shaped in the grid but are
  // BACKPACKS. Seating comes from the generic sheet instead.

  // --- museum (the Commons) ---
  /** Wooden waiting bench. */
  bench: block('museum', 0, 8, 2, 2, 1),
  /** "Work in progress" caution sign — the most honest object in the pack. */
  wipSign: block('museum', 11, 3, 2, 2, 1),

  // --- generic ---
  rugRed: block('generic', 9, 4, 4, 3, 0, 'overlay'),
  rugBlue: block('generic', 9, 7, 4, 3, 0, 'overlay'),
  rugTallBlue: block('generic', 13, 5, 3, 4, 0, 'overlay'),
  rugTallRed: block('generic', 13, 9, 3, 4, 0, 'overlay'),
  rugGrey: block('generic', 8, 13, 3, 2, 0, 'overlay'),
  /** Red three-seater sofa. */
  sofaRed: block('generic', 6, 10, 3, 2, 1),
  /**
   * Small round side table. NOTE: generic rows 4-9 cols 0-3 look like tables in
   * the grid but are BEDS — do not catalogue them as furniture for a study room.
   */
  tableRound: block('generic', 6, 4, 1, 2, 1),
  window: block('generic', 7, 8, 2, 1, 0, 'wall'),
  windowWhite: block('generic', 5, 9, 2, 1, 0, 'wall'),
  paintingField: block('generic', 0, 13, 2, 1, 0, 'wall'),
  paintingSunset: block('generic', 2, 13, 2, 1, 0, 'wall'),
  paintingSea: block('generic', 4, 13, 2, 1, 0, 'wall'),
  palmBig: block('generic', 13, 25, 2, 2, 1),
  plantSmall: block('generic', 13, 28, 1, 2, 1),
  plantSmall2: block('generic', 15, 28, 1, 2, 1),
  /** Wooden chair with a back, facing the viewer. Audience and desk seating. */
  chair: block('generic', 0, 11, 1, 2, 1),
  chair2: block('generic', 1, 11, 1, 2, 1),
  chair3: block('generic', 4, 11, 1, 2, 1),
  pouf: block('generic', 0, 17, 1, 1, 0, 'decor'),
  pouf2: block('generic', 1, 17, 1, 1, 0, 'decor'),
  tv: block('generic', 3, 18, 2, 2, 1),
} as const;

export type BlockKey = keyof typeof BLOCKS;
