import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_TILE_SIZE } from './validate.js';

// ---------------------------------------------------------------------------
// THIS MUTATES COMMITTED SOURCE. IT NEVER REGENERATES A MAP FROM SCRATCH.
// ---------------------------------------------------------------------------
//
// Read that again, because the last thing that lived here did the opposite and
// had to be deleted. `seed-maps.ts` was 723 lines that emitted all five maps
// from floor-fill and wall-ring loops, and the consequence was not that the
// rooms looked bad — it was that they could not be improved. Every hand edit in
// Tiled, every nudged chair, was one `pnpm seed` away from being erased, so
// nobody made one, so the maps stayed rectangles.
//
// The committed `maps/*.json` is the source of truth. This module opens it,
// changes the tiles you name, and writes it back in Tiled's own format. If you
// find yourself adding a function that builds a whole room from parameters,
// you are rebuilding the generator: stop, and write an authoring SCRIPT that
// calls these primitives instead. Authoring scripts are disposable; the map is
// not.
//
// Deliberately NOT exported from src/index.ts. That barrel is imported by the
// browser bundle, and this file reads the filesystem.
//
// The loop this is built for:
//
//     edit an authoring script → pnpm validate → pnpm preview:all → LOOK
//
// There is no other feedback. A gid is a number; the only way to know it is the
// tile you meant is to render it and look at the picture.

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TILE = EXPECTED_TILE_SIZE;

// ---------------------------------------------------------------------------
// The shape of a map on disk
// ---------------------------------------------------------------------------
//
// Structurally identical to what Tiled 1.11 writes. Deliberately separate from
// `validate.ts`'s zod types: those describe the MINIMUM a map must satisfy and
// drop everything else, which is exactly wrong for a file we intend to write
// back. Parsing through zod here would silently delete `nextobjectid`,
// `renderorder` and every field Tiled needs to reopen the file.

export type PropertyType = 'string' | 'int' | 'float' | 'bool';

export type TiledProperty = {
  name: string;
  type: PropertyType;
  value: string | number | boolean;
};

export type TiledObject = {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  point?: boolean;
  properties?: TiledProperty[];
};

export type AuthoredTileLayer = {
  type: 'tilelayer';
  id: number;
  name: string;
  data: number[];
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  x: number;
  y: number;
};

export type AuthoredObjectLayer = {
  type: 'objectgroup';
  id: number;
  name: string;
  objects: TiledObject[];
  draworder: string;
  opacity: number;
  visible: boolean;
  x: number;
  y: number;
};

export type AuthoredLayer = AuthoredTileLayer | AuthoredObjectLayer;

export type TilesetRef = {
  name: string;
  firstgid: number;
  tilecount: number;
  columns: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  margin: number;
  spacing: number;
  tilewidth: number;
  tileheight: number;
};

export type AuthoredMap = {
  type: 'map';
  version: string;
  tiledversion: string;
  orientation: 'orthogonal';
  renderorder: string;
  infinite: boolean;
  compressionlevel: number;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  nextlayerid: number;
  nextobjectid: number;
  tilesets: TilesetRef[];
  layers: AuthoredLayer[];
};

/** The tile layers every Retry map has, in the order the renderer stacks them. */
export const TILE_LAYERS = [
  'ground',
  'ground_overlay',
  'objects',
  'objects_above',
  'collision',
] as const;
export type TileLayerName = (typeof TILE_LAYERS)[number];

/** The object layers a Retry map may carry. `zones` is optional. */
export const OBJECT_LAYERS = ['spawns', 'interactables', 'props', 'zones'] as const;
export type ObjectLayerName = (typeof OBJECT_LAYERS)[number];

// ---------------------------------------------------------------------------
// The sheet manifest
// ---------------------------------------------------------------------------

type ManifestSheet = {
  key: string;
  file: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
};

let sheetCache: Map<string, ManifestSheet> | null = null;

/**
 * Sheet geometry comes from the build's manifest rather than being hardcoded,
 * so a sheet that changes size in a future pack version cannot leave gid maths
 * quietly pointing one row off.
 */
function sheets(): Map<string, ManifestSheet> {
  if (sheetCache) return sheetCache;
  const path = resolve(PKG_ROOT, 'generated', 'manifest.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      'authoring needs the built art pack — run: pnpm --filter @retry/maps assets:build',
    );
  }
  const manifest = JSON.parse(raw) as { source?: string; tilesets?: ManifestSheet[] };
  if (manifest.source !== 'limezu') {
    throw new Error(
      `authoring needs the licensed pack (manifest source is '${manifest.source}') — see docs/assets-setup.md`,
    );
  }
  sheetCache = new Map((manifest.tilesets ?? []).map((s) => [s.key, s]));
  return sheetCache;
}

// ---------------------------------------------------------------------------
// Load and save
// ---------------------------------------------------------------------------

export function loadMap(name: string): AuthoredMap {
  const path = resolve(PKG_ROOT, 'maps', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as AuthoredMap;
}

/**
 * Writes the map back with keys sorted at every level and two-space indent —
 * the format Tiled itself emits. Sorting is not cosmetic: object key order in
 * JSON.stringify follows insertion order, so a map that had `width` added last
 * would diff as though the whole file moved. A stable order means a diff shows
 * only the tiles that actually changed, which is the difference between a
 * reviewable map commit and an unreviewable one.
 */
export function save(map: AuthoredMap, name: string): void {
  const path = resolve(PKG_ROOT, 'maps', `${name}.json`);
  writeFileSync(path, `${JSON.stringify(sortKeys(map), null, 2)}\n`);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tilesets and gids
// ---------------------------------------------------------------------------

/**
 * Appends a sheet to the map's gid space. Idempotent.
 *
 * Every map pins its OWN firstgids — the museum sheet is 4393 in commons.json
 * and 4041 in conference.json — because each map declares only the sheets it
 * uses. So a new sheet must go on the END, above every existing range. Insert
 * one in the middle and every tile in the file silently becomes a different
 * tile, with no error anywhere: the map still validates, it just draws a
 * completely different room. The assertion below is the whole reason this
 * function exists rather than being three lines at the call site.
 */
export function addTileset(map: AuthoredMap, key: string): TilesetRef {
  const existing = map.tilesets.find((t) => t.name === key);
  if (existing) return existing;

  const sheet = sheets().get(key);
  if (!sheet) {
    throw new Error(
      `unknown tileset '${key}' — it must be listed in assets.config.ts and built (have: ${[...sheets().keys()].join(', ')})`,
    );
  }

  const firstgid = map.tilesets.reduce((max, t) => Math.max(max, t.firstgid + t.tilecount), 1);
  for (const t of map.tilesets) {
    if (firstgid <= t.firstgid + t.tilecount - 1) {
      throw new Error(
        `refusing to add '${key}' at firstgid ${firstgid}: it would overlap '${t.name}' (${t.firstgid}..${t.firstgid + t.tilecount - 1}) and renumber every gid in the map`,
      );
    }
  }

  const ref: TilesetRef = {
    name: key,
    firstgid,
    tilecount: sheet.columns * sheet.rows,
    columns: sheet.columns,
    image: `../generated/${sheet.file}`,
    imagewidth: sheet.width,
    imageheight: sheet.height,
    margin: 0,
    spacing: 0,
    tilewidth: TILE,
    tileheight: TILE,
  };
  map.tilesets.push(ref);
  map.tilesets.sort((a, b) => a.firstgid - b.firstgid);
  return ref;
}

/**
 * Removes tilesets no tile references.
 *
 * Safe in a way that reordering is not: dropping an entry leaves every other
 * firstgid exactly where it was, so the gid space simply grows a hole. The
 * point is weight — a declared sheet is downloaded and uploaded to the GPU
 * whether or not a single tile uses it, and the museum sheet alone is
 * 512x3904. A room that was reworked and no longer uses its old theme should
 * stop paying for it.
 */
export function dropUnusedTilesets(map: AuthoredMap): string[] {
  const used = new Set<string>();
  for (const layer of map.layers) {
    if (layer.type !== 'tilelayer') continue;
    for (const gid of layer.data) {
      if (gid === 0) continue;
      const owner = map.tilesets.find((t) => gid >= t.firstgid && gid < t.firstgid + t.tilecount);
      if (owner) used.add(owner.name);
    }
  }
  const dropped = map.tilesets.filter((t) => !used.has(t.name)).map((t) => t.name);
  map.tilesets = map.tilesets.filter((t) => used.has(t.name));
  return dropped;
}

/** The gid for a tile at (col, row) of a sheet. Adds the sheet if needed. */
export function gidFor(map: AuthoredMap, key: string, col: number, row: number): number {
  const ref = addTileset(map, key);
  const sheet = sheets().get(key);
  if (!sheet) throw new Error(`unreachable: addTileset validated '${key}'`);
  if (col < 0 || col >= sheet.columns || row < 0 || row >= sheet.rows) {
    throw new Error(
      `${key}: tile (${col},${row}) is outside the sheet (${sheet.columns}x${sheet.rows})`,
    );
  }
  return ref.firstgid + row * sheet.columns + col;
}

/**
 * A rectangular block of a sheet as a 2D gid grid, ready for `stamp`.
 *
 * Most of this pack is not single tiles. A sofa is 2x2, a wall run is 2 tall,
 * a floor material is a 3x2 tileable block — so lifting a rectangle out of a
 * sheet and putting it down somewhere is the actual unit of map authoring.
 */
export function block(
  map: AuthoredMap,
  key: string,
  col: number,
  row: number,
  w: number,
  h: number,
): number[][] {
  const rows: number[][] = [];
  for (let dy = 0; dy < h; dy++) {
    const line: number[] = [];
    for (let dx = 0; dx < w; dx++) line.push(gidFor(map, key, col + dx, row + dy));
    rows.push(line);
  }
  return rows;
}

/**
 * The gid the collision layer writes. Its identity is irrelevant — every
 * consumer tests `!== 0` — but it must be a gid the map actually declares, or
 * the validator's range check rejects the file.
 */
export function solidGid(map: AuthoredMap): number {
  const first = map.tilesets[0];
  if (!first) throw new Error('map declares no tilesets; add one before writing collision');
  return first.firstgid;
}

// ---------------------------------------------------------------------------
// Tile layers
// ---------------------------------------------------------------------------

export function tileLayer(map: AuthoredMap, name: TileLayerName): AuthoredTileLayer {
  const found = map.layers.find(
    (l): l is AuthoredTileLayer => l.type === 'tilelayer' && l.name === name,
  );
  if (!found) throw new Error(`map has no tile layer '${name}'`);
  if (found.data.length !== map.width * map.height) {
    throw new Error(
      `tile layer '${name}' is ${found.data.length} long but the map is ${map.width}x${map.height} — resize() was not used`,
    );
  }
  return found;
}

/** Every tile in a layer set to empty. The start of authoring a room. */
export function clear(map: AuthoredMap, name: TileLayerName): void {
  tileLayer(map, name).data.fill(0);
}

export function inBounds(map: AuthoredMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/**
 * Sets one tile. `null` clears it.
 *
 * Out-of-bounds THROWS rather than clipping. Silent clipping is how a stamp
 * placed one tile too far right loses its whole right column and looks merely
 * wrong instead of broken — and a map that looks merely wrong ships.
 */
export function setTile(
  map: AuthoredMap,
  name: TileLayerName,
  x: number,
  y: number,
  gid: number | null,
): void {
  if (!inBounds(map, x, y)) {
    throw new Error(`${name}: (${x},${y}) is outside the ${map.width}x${map.height} map`);
  }
  tileLayer(map, name).data[y * map.width + x] = gid ?? 0;
}

export function getTile(map: AuthoredMap, name: TileLayerName, x: number, y: number): number {
  if (!inBounds(map, x, y)) return 0;
  return tileLayer(map, name).data[y * map.width + x] ?? 0;
}

export type TileSource =
  | number
  | null
  | ((x: number, y: number, dx: number, dy: number) => number | null | undefined);

/**
 * Fills a rectangle. A function source returning `undefined` leaves the tile
 * alone — which is how you paint a tileable material over an irregular shape
 * without squaring off its edges.
 */
export function fillRect(
  map: AuthoredMap,
  name: TileLayerName,
  x: number,
  y: number,
  w: number,
  h: number,
  source: TileSource,
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const gid = typeof source === 'function' ? source(x + dx, y + dy, dx, dy) : source;
      if (gid === undefined) continue;
      setTile(map, name, x + dx, y + dy, gid);
    }
  }
}

/** Paints a tileable NxM material across a rectangle, phased to map coords. */
export function tileMaterial(
  map: AuthoredMap,
  name: TileLayerName,
  x: number,
  y: number,
  w: number,
  h: number,
  material: number[][],
): void {
  const mh = material.length;
  const mw = material[0]?.length ?? 0;
  if (mh === 0 || mw === 0) throw new Error('tileMaterial needs a non-empty block');
  fillRect(map, name, x, y, w, h, (_tx, _ty, dx, dy) => material[dy % mh]?.[dx % mw] ?? null);
}

export type Stamp = Partial<Record<TileLayerName, ReadonlyArray<ReadonlyArray<number | null>>>>;

/**
 * Puts a multi-layer object down with its top-left at (x, y).
 *
 * The layer split IS the walk-behind rule, so it is worth being explicit about:
 * the part of a bookshelf an avatar can stand in front of goes on `objects`,
 * the part that must overlap them goes on `objects_above`, and `collision`
 * marks the tiles their feet cannot enter. Those three rectangles are usually
 * different shapes, which is why this takes a record rather than one grid.
 */
export function stamp(map: AuthoredMap, x: number, y: number, layers: Stamp): void {
  for (const [name, grid] of Object.entries(layers) as Array<
    [TileLayerName, ReadonlyArray<ReadonlyArray<number | null>>]
  >) {
    grid.forEach((row, dy) => {
      row.forEach((gid, dx) => {
        if (gid === null) return;
        setTile(map, name, x + dx, y + dy, gid);
      });
    });
  }
}

/** Marks a rectangle solid on the collision layer. */
export function solid(map: AuthoredMap, x: number, y: number, w: number, h: number): void {
  fillRect(map, 'collision', x, y, w, h, solidGid(map));
}

/** Clears a rectangle on the collision layer — doorways, gaps, walkable props. */
export function walkable(map: AuthoredMap, x: number, y: number, w: number, h: number): void {
  fillRect(map, 'collision', x, y, w, h, null);
}

// ---------------------------------------------------------------------------
// Object layers
// ---------------------------------------------------------------------------

export function objectLayer(map: AuthoredMap, name: ObjectLayerName): AuthoredObjectLayer {
  const found = map.layers.find(
    (l): l is AuthoredObjectLayer => l.type === 'objectgroup' && l.name === name,
  );
  if (found) return found;

  const layer: AuthoredObjectLayer = {
    type: 'objectgroup',
    id: map.nextlayerid++,
    name,
    objects: [],
    draworder: 'topdown',
    opacity: 1,
    visible: true,
    x: 0,
    y: 0,
  };
  map.layers.push(layer);
  return layer;
}

export function clearObjects(map: AuthoredMap, name: ObjectLayerName): void {
  objectLayer(map, name).objects.length = 0;
}

/** A Tiled custom property, with the `type` tag Tiled needs to reopen it. */
export function prop(name: string, value: string | number | boolean): TiledProperty {
  if (typeof value === 'boolean') return { name, type: 'bool', value };
  if (typeof value === 'number') {
    return { name, type: Number.isInteger(value) ? 'int' : 'float', value };
  }
  return { name, type: 'string', value };
}

export type ObjectSpec = {
  name: string;
  /** TILE coordinates. Converted to pixels here so no caller multiplies by 32. */
  x: number;
  y: number;
  /** TILE dimensions. Omitted for points. */
  w?: number;
  h?: number;
  point?: boolean;
  properties?: TiledProperty[];
};

/**
 * Adds an object, in TILE coordinates.
 *
 * Everything else in this module speaks tiles; Tiled objects are stored in
 * pixels. Every previous `x: 336` in a map file was a hand-multiplied 10.5
 * tiles, and getting one wrong puts a seat half inside a desk. The conversion
 * lives here, once.
 */
export function addObject(map: AuthoredMap, layerName: ObjectLayerName, spec: ObjectSpec): TiledObject {
  if (!inBounds(map, spec.x, spec.y)) {
    throw new Error(
      `object '${spec.name}' at tile (${spec.x},${spec.y}) is outside the ${map.width}x${map.height} map`,
    );
  }
  const w = spec.w ?? 0;
  const h = spec.h ?? 0;
  if (spec.x + w > map.width || spec.y + h > map.height) {
    throw new Error(
      `object '${spec.name}' spans (${spec.x},${spec.y})+${w}x${h}, past the ${map.width}x${map.height} map edge`,
    );
  }

  const obj: TiledObject = {
    id: map.nextobjectid++,
    name: spec.name,
    type: '',
    x: spec.x * TILE,
    y: spec.y * TILE,
    width: w * TILE,
    height: h * TILE,
    rotation: 0,
    visible: true,
    ...(spec.point ? { point: true } : { point: false }),
    ...(spec.properties ? { properties: spec.properties } : {}),
  };
  objectLayer(map, layerName).objects.push(obj);
  return obj;
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

/**
 * Changes the map's dimensions, moving existing content by (dx, dy) tiles.
 *
 * This is the single most destructive operation in the module and the reason
 * the Commons is resized last, alone, in its own commit. Growing a map
 * relocates every tile index, every object's pixel coordinates, and therefore
 * every Commons door slot — which `apps/api` maps to rooms BY COORDINATE, and
 * which `room_members.last_position` was recorded against. Doors self-heal on
 * the next API boot; positions do not, and people standing where a wall now is
 * get resynced out of it.
 *
 * Content that would fall outside the new bounds throws rather than being
 * cropped. There is no such thing as accidentally cropping half a room.
 */
export function resize(map: AuthoredMap, width: number, height: number, dx = 0, dy = 0): void {
  if (width <= 0 || height <= 0) throw new Error(`resize to ${width}x${height} is not a map`);

  for (const layer of map.layers) {
    if (layer.type !== 'tilelayer') continue;
    const next = new Array<number>(width * height).fill(0);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const gid = layer.data[y * map.width + x] ?? 0;
        if (gid === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          throw new Error(
            `resize to ${width}x${height} would crop tile (${x},${y}) of layer '${layer.name}' — clear it first, or pick a shift that keeps it`,
          );
        }
        next[ny * width + nx] = gid;
      }
    }
    layer.data = next;
    layer.width = width;
    layer.height = height;
  }

  for (const layer of map.layers) {
    if (layer.type !== 'objectgroup') continue;
    for (const obj of layer.objects) {
      const nx = obj.x + dx * TILE;
      const ny = obj.y + dy * TILE;
      if (nx < 0 || ny < 0 || nx > width * TILE || ny > height * TILE) {
        throw new Error(
          `resize to ${width}x${height} would put object '${obj.name}' of layer '${layer.name}' outside the map`,
        );
      }
      obj.x = nx;
      obj.y = ny;
    }
  }

  map.width = width;
  map.height = height;
}
