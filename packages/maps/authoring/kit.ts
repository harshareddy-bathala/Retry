import {
  addObject,
  clear,
  fillRect,
  getTile,
  gidFor,
  setTile,
  solidGid,
  tileMaterial,
  type AuthoredMap,
  type TileLayerName,
} from '../src/tiled.js';

// The vocabulary the room scripts are written in.
//
// Everything here operates on a map you are already holding — it places walls
// where you say, or derives shadows from walls you already placed. Nothing in
// this file invents a room. That distinction is the whole lesson of the
// generator this replaced: a helper that takes "put a wall from here to here"
// is a tool, and a helper that takes "make me a classroom" is a generator, and
// the second one cannot be edited afterwards.
//
// Every tile coordinate below was found by rendering the sheet with
// `pnpm preview:sheet` and looking at it. They are written down here once so
// that five room scripts do not each rediscover them — and get them subtly
// different.

// ---------------------------------------------------------------------------
// Walls — the 2.5D kit
// ---------------------------------------------------------------------------

/**
 * `walls3d` is not a set of wall tiles, it is a nine-slice of a wall SOLID seen
 * from slightly above. It carries a top surface (the white cap) and a front
 * face (the material), which is what gives a room height instead of an outline.
 *
 * Reading a row of the sheet, top to bottom, for a north wall:
 *
 *     row 2   the cap — the top of the wall, lit from above
 *     row 3   the face — what you actually see, skirting along its foot
 *
 * and for a south wall, where you are looking at its back:
 *
 *     row 4   the face, from behind
 *     row 5   the cap
 *
 * Side walls run vertically and show neither: one column of solid material,
 * which is why `SIDE` is a single tile that repeats without a seam. Using the
 * corner tiles for that — the obvious first guess — stripes the wall with a
 * skirting line every 32px.
 *
 * Columns 3 and 4 are two variants of the same run. Alternating them is what
 * stops a 20-tile wall reading as one stretched texture.
 */
export type WallKit = {
  /** Column of the sheet the kit starts at. Each kit is 8 wide. */
  col: number;
  /** Row band. Each kit is 7 tall; row+2 is the first cap row. */
  row: number;
};

/**
 * The kits, by material — confirmed by rendering a room with each and looking.
 *
 * `wood` and `plaster` are the two that read as WALLS: they have a lit cap, a
 * shaded face and a skirting line, so the room has height. The rest of the
 * sheet's materials are flatter panels that come out as a coloured band round
 * the floor, which is the exact look this whole phase was meant to get rid of.
 * They are listed because they exist, not because they are interchangeable.
 */
export const WALL_KITS = {
  wood: { col: 0, row: 0 },
  plaster: { col: 8, row: 0 },
  lavender: { col: 16, row: 0 },
  panel: { col: 0, row: 7 },
  concrete: { col: 8, row: 7 },
  blue: { col: 16, row: 7 },
} as const satisfies Record<string, WallKit>;

export type WallKitName = keyof typeof WALL_KITS;

type Slice = {
  capL: number; capR: number; cap: [number, number];
  faceL: number; faceR: number; face: [number, number];
  sFaceL: number; sFaceR: number; sFace: [number, number];
  sCapL: number; sCapR: number; sCap: [number, number];
  side: number;
};

function slice(map: AuthoredMap, kit: WallKit): Slice {
  const g = (c: number, r: number): number => gidFor(map, 'walls3d', kit.col + c, kit.row + r);
  return {
    capL: g(2, 2), capR: g(5, 2), cap: [g(3, 2), g(4, 2)],
    faceL: g(2, 3), faceR: g(5, 3), face: [g(3, 3), g(4, 3)],
    sFaceL: g(2, 4), sFaceR: g(5, 4), sFace: [g(3, 4), g(4, 4)],
    sCapL: g(2, 5), sCapR: g(5, 5), sCap: [g(3, 5), g(4, 5)],
    side: g(0, 2),
  };
}

export type Room = {
  /** Top-left of the room INCLUDING its walls. */
  x: number;
  y: number;
  /** Total footprint including walls. Interior is (w-2) x (h-4). */
  w: number;
  h: number;
};

/**
 * The interior of a room — the tiles an avatar can actually stand on.
 *
 * A room's walls eat two columns and FOUR rows: the north wall is a cap plus a
 * face, and the south wall is a face plus a cap. Getting this wrong is how you
 * end up with furniture inside a wall, so it is computed here rather than by
 * each caller counting.
 */
export function interior(room: Room): { x: number; y: number; w: number; h: number } {
  return { x: room.x + 1, y: room.y + 2, w: room.w - 2, h: room.h - 4 };
}

/**
 * Draws a closed room shell on `objects`, with collision under all of it.
 *
 * Every part of a wall goes on `objects`, NOT `objects_above`, and the reason
 * is worth writing down because the first version got it backwards. The
 * walk-behind layer is for things an avatar can stand on the tile of and be
 * occluded by. Nobody can stand inside a wall — it is solid on every tile — so
 * putting the caps above the player changes nothing about what you see, and
 * costs a rendering pass. The depth that matters is the other one: an avatar
 * standing in front of a north wall must draw OVER its face, which is exactly
 * what `objects` gives.
 */
export function shell(map: AuthoredMap, room: Room, kitName: WallKitName = 'plaster'): void {
  const kit = slice(map, WALL_KITS[kitName]);
  const { x, y, w, h } = room;
  const right = x + w - 1;
  const bottom = y + h - 1;
  const alt = (pair: [number, number], i: number): number => pair[i % 2]!;

  // North: cap row above the face row.
  setTile(map, 'objects', x, y, kit.capL);
  setTile(map, 'objects', right, y, kit.capR);
  setTile(map, 'objects', x, y + 1, kit.faceL);
  setTile(map, 'objects', right, y + 1, kit.faceR);
  for (let c = x + 1; c < right; c++) {
    setTile(map, 'objects', c, y, alt(kit.cap, c));
    setTile(map, 'objects', c, y + 1, alt(kit.face, c));
  }

  // South: face then cap.
  setTile(map, 'objects', x, bottom - 1, kit.sFaceL);
  setTile(map, 'objects', right, bottom - 1, kit.sFaceR);
  setTile(map, 'objects', x, bottom, kit.sCapL);
  setTile(map, 'objects', right, bottom, kit.sCapR);
  for (let c = x + 1; c < right; c++) {
    setTile(map, 'objects', c, bottom - 1, alt(kit.sFace, c));
    setTile(map, 'objects', c, bottom, alt(kit.sCap, c));
  }

  // Sides: one seamless column of material.
  for (let r = y + 2; r < bottom - 1; r++) {
    setTile(map, 'objects', x, r, kit.side);
    setTile(map, 'objects', right, r, kit.side);
  }

  // Solid everywhere the walls are.
  fillRect(map, 'collision', x, y, w, 2, solidGid(map));
  fillRect(map, 'collision', x, bottom - 1, w, 2, solidGid(map));
  for (let r = y + 2; r < bottom - 1; r++) {
    setTile(map, 'collision', x, r, solidGid(map));
    setTile(map, 'collision', right, r, solidGid(map));
  }
}

/**
 * Marks every tile with no floor as solid.
 *
 * The space outside the rooms is not part of the map in any sense a player can
 * reach, but it is still 400 tiles of nothing that an avatar would walk into
 * and hover over the page background. Call this after the shells and before the
 * shadows; the validator enforces it either way.
 */
export function seal(map: AuthoredMap): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (getTile(map, 'ground', x, y) === 0) setTile(map, 'collision', x, y, solidGid(map));
    }
  }
}

/**
 * Cuts a doorway through a wall: clears the tiles and the collision under them.
 *
 * `height` is how many rows of wall to remove. A north wall is two rows thick
 * (cap + face), so a doorway that only clears one of them leaves a floating cap
 * you can walk under.
 */
export function opening(
  map: AuthoredMap,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  for (const layer of ['objects', 'objects_above'] as const) {
    fillRect(map, layer, x, y, w, h, null);
  }
  fillRect(map, 'collision', x, y, w, h, null);
}

// ---------------------------------------------------------------------------
// Shadows — derived, never placed
// ---------------------------------------------------------------------------

/**
 * The medium floor-shadow kit. The sheet ships three depths (4px, 12px, 20px);
 * 12px is the one that reads as a wall's shadow rather than a smudge or a
 * second floor.
 *
 * Rows 0-1 of that sheet are the words "floor shadow" rendered as tiles — pack
 * documentation, not art. Anything sampled from them draws text on your floor.
 */
const SHADOW = { corner: [3, 3], top: [4, 3], nub: [5, 3], left: [3, 4], full: [4, 4] } as const;

/**
 * Casts a shadow onto every floor tile that has a wall to its north or west.
 *
 * DERIVED from the collision layer, not hand-placed, and that is the point.
 * Hand-placed shadows are correct on the day they are placed and wrong the
 * first time a wall moves — and nothing catches it, because a shadow in the
 * wrong place still validates.
 *
 * WHEN you call it decides what casts. Run it after the shells and the floors
 * but BEFORE any furniture, so only architecture throws a shadow. Run it at the
 * end instead and every desk and bookshelf gets one too — which sounds better
 * and looks far worse, because the pack already draws each object's own contact
 * shadow, and the floor ends up a field of grey smudges with a room somewhere
 * underneath.
 *
 * Light comes from the north-west, which is the convention the whole pack is
 * drawn to. Changing it would mean redrawing every object's own shadow.
 */
export function castShadows(map: AuthoredMap, region?: Room): void {
  const x0 = region?.x ?? 0;
  const y0 = region?.y ?? 0;
  const x1 = region ? region.x + region.w : map.width;
  const y1 = region ? region.y + region.h : map.height;

  const g = (pair: readonly [number, number]): number =>
    gidFor(map, 'shadows', pair[0], pair[1]);
  const blocked = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= map.width || y >= map.height || getTile(map, 'collision', x, y) !== 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (blocked(x, y)) continue;
      if (getTile(map, 'ground', x, y) === 0) continue;
      const north = blocked(x, y - 1);
      const west = blocked(x - 1, y);
      // The diagonal only matters when neither orthogonal neighbour casts:
      // an inside corner is already covered by both strips meeting.
      const northWest = blocked(x - 1, y - 1);
      if (north && west) setTile(map, 'ground_overlay', x, y, g(SHADOW.corner));
      else if (north) setTile(map, 'ground_overlay', x, y, g(SHADOW.top));
      else if (west) setTile(map, 'ground_overlay', x, y, g(SHADOW.left));
      else if (northWest) setTile(map, 'ground_overlay', x, y, g(SHADOW.nub));
    }
  }
}

/** Unused by any room yet — kept because the kit is incomplete without it. */
export const SHADOW_FULL = SHADOW.full;

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/**
 * Floor materials, by the top-left tile of their 3x2 tileable block.
 *
 * The `floors` sheet is laid out as 3-wide by 2-tall blocks with a one-column
 * gutter, so a material is never a single tile — painting one tile of a block
 * everywhere gives a flat colour and throws away the pattern the artist drew.
 */
export const FLOORS = {
  parquet: [8, 4],
  cream: [4, 2],
  slate: [12, 4],
  carpetBlue: [0, 2],
  carpetYellow: [0, 8],
  tileWhite: [0, 4],
  woodPlank: [0, 10],
  herringbone: [8, 10],
  sand: [4, 6],
  rose: [8, 6],
  green: [12, 2],
  check: [8, 2],
} as const;

export type FloorName = keyof typeof FLOORS;

export function floor(
  map: AuthoredMap,
  name: FloorName,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const [c, r] = FLOORS[name];
  const material = [
    [gidFor(map, 'floors', c, r), gidFor(map, 'floors', c + 1, r), gidFor(map, 'floors', c + 2, r)],
    [
      gidFor(map, 'floors', c, r + 1),
      gidFor(map, 'floors', c + 1, r + 1),
      gidFor(map, 'floors', c + 2, r + 1),
    ],
  ];
  tileMaterial(map, 'ground', x, y, w, h, material);
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

export type Piece = {
  /** Sheet key and the top-left tile of the piece on it. */
  sheet: string;
  col: number;
  row: number;
  w: number;
  h: number;
  /**
   * How many of the piece's BOTTOM rows an avatar cannot walk into.
   *
   * Not the same as its height. A bookshelf is 1x3 but only its bottom row is
   * furniture — the two above are the part you walk behind — so `solidRows: 1`.
   * A table is solid all the way through.
   */
  solidRows?: number;
  /**
   * How many TOP rows draw above the avatar. The rest draw below.
   * This is the walk-behind split, per piece.
   */
  aboveRows?: number;
};

/**
 * Places a piece with its top-left at (x, y), splitting it across `objects`
 * and `objects_above` and marking the solid part.
 */
export function place(map: AuthoredMap, piece: Piece, x: number, y: number): void {
  const above = piece.aboveRows ?? 0;
  for (let dy = 0; dy < piece.h; dy++) {
    const layer: TileLayerName = dy < above ? 'objects_above' : 'objects';
    for (let dx = 0; dx < piece.w; dx++) {
      setTile(map, layer, x + dx, y + dy, gidFor(map, piece.sheet, piece.col + dx, piece.row + dy));
    }
  }
  const solidRows = piece.solidRows ?? piece.h;
  if (solidRows > 0) {
    fillRect(map, 'collision', x, y + piece.h - solidRows, piece.w, solidRows, solidGid(map));
  }
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

/**
 * A spawn point, at the CENTRE of the named tile.
 *
 * The half-tile offset is not cosmetic. Positions on the wire are the avatar's
 * feet, and a spawn on a tile corner puts those feet on the seam between four
 * tiles — so which tile the server thinks you are standing in comes down to
 * floating-point luck, and two people spawning together can land on opposite
 * sides of a wall. Every map has always done this; only this helper forgot.
 */
export function spawn(map: AuthoredMap, name: string, x: number, y: number): void {
  addObject(map, 'spawns', { name, x: x + 0.5, y: y + 0.5, point: true });
}

export function seat(
  map: AuthoredMap,
  x: number,
  y: number,
  facing: 'up' | 'down' | 'left' | 'right',
): void {
  addObject(map, 'interactables', {
    name: 'seat',
    x,
    y,
    w: 1,
    h: 1,
    properties: [
      { name: 'interactive', type: 'string', value: 'seat' },
      { name: 'facing', type: 'string', value: facing },
    ],
  });
}

export function interactable(
  map: AuthoredMap,
  kind: string,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label?: string,
): void {
  addObject(map, 'interactables', {
    name,
    x,
    y,
    w,
    h,
    properties: [
      { name: 'interactive', type: 'string', value: kind },
      ...(label ? [{ name: 'label', type: 'string' as const, value: label }] : []),
    ],
  });
}

export function zone(
  map: AuthoredMap,
  kind: string,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  addObject(map, 'zones', {
    name,
    x,
    y,
    w,
    h,
    properties: [{ name: 'zone', type: 'string', value: kind }],
  });
}

export function animated(map: AuthoredMap, key: string, x: number, y: number): void {
  addObject(map, 'props', { name: key, x, y, w: 1, h: 1 });
}

// ---------------------------------------------------------------------------
// Starting over
// ---------------------------------------------------------------------------

/**
 * Empties every layer, keeping the file's identity — tilesets, ids, dimensions.
 *
 * A room script begins here and rebuilds. That is not the generator coming
 * back: the script is the disposable thing and the map it writes is the
 * artefact, so re-running one is how you iterate on a room you are looking at,
 * not how the maps are produced.
 */
export function blank(map: AuthoredMap): void {
  for (const layer of ['ground', 'ground_overlay', 'objects', 'objects_above', 'collision'] as const) {
    clear(map, layer);
  }
  for (const layer of ['spawns', 'interactables', 'props', 'zones'] as const) {
    const found = map.layers.find((l) => l.type === 'objectgroup' && l.name === layer);
    if (found && found.type === 'objectgroup') found.objects.length = 0;
  }
}
