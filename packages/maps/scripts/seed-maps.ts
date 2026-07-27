import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from '../art/canvas.js';
import { TILE } from '../assets.config.js';
import {
  BLOCKS,
  FLOORS,
  WALLS,
  type BlockKey,
  type FloorKey,
  type PropBlock,
  type WallKey,
} from '../tiles.catalog.js';

// One-shot seeder for the five map templates (pack-world Phase 4).
//
//   npx tsx scripts/seed-maps.ts
//
// This produced the FIRST PASS of every map in maps/. After seeding, the JSON
// files are hand-authored source — open them in Tiled and refine (see
// docs/authoring-maps.md); nothing regenerates them automatically, and
// re-running this script OVERWRITES any hand edits. That is why it is not
// wired into `pnpm art`.
//
// A map here is: a floor material, a wall ring, prop placements by name from
// tiles.catalog.ts, rugs, and interactables. The script derives the four tile
// layers (ground / ground_overlay / objects / objects_above), collision, and
// declares ONLY the tilesets the map actually uses — each map pins its own
// firstgids, so growing the build's tileset list never renumbers a map.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

type ManifestSheet = { key: string; file: string; width: number; height: number; columns: number; rows: number };
const manifest = JSON.parse(readFileSync(resolve(root, 'generated', 'manifest.json'), 'utf8')) as {
  source: string;
  tilesets: ManifestSheet[];
};
if (manifest.source !== 'limezu') {
  throw new Error('seed-maps needs the licensed pack built — run: pnpm assets:build');
}
const sheetByKey = new Map(manifest.tilesets.map((s) => [s.key, s]));

type Placement = { block: BlockKey; x: number; y: number };

type MapSpec = {
  name: string;
  width: number;
  height: number;
  floor: FloorKey;
  wall: WallKey;
  props: Placement[];
  /** Animated objects: an ANIMATED key from the build, at a tile position. */
  animated?: Array<{ key: string; x: number; y: number }>;
  spawn: { x: number; y: number };
  interactables: Array<{
    name: string;
    x: number;
    y: number;
    w: number;
    props: Array<{ name: string; type: string; value: string | number }>;
  }>;
};

function build(spec: MapSpec): unknown {
  const { width, height } = spec;
  const size = width * height;
  const ground = new Array<number>(size).fill(0);
  const overlay = new Array<number>(size).fill(0);
  const objects = new Array<number>(size).fill(0);
  const above = new Array<number>(size).fill(0);
  const collision = new Array<number>(size).fill(0);

  // Which sheets this map touches, in manifest order, decides its tilesets.
  const usedSheets = new Set<string>();
  const idx = (x: number, y: number): number => y * width + x;

  // Local gid assignment happens in two passes: first collect sheets, then
  // number them. Tile writes go through a thunk list until gids exist.
  const writes: Array<{ arr: number[]; at: number; sheet: string; col: number; row: number }> = [];
  const put = (arr: number[], x: number, y: number, sheet: string, col: number, row: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      throw new Error(`${spec.name}: tile out of bounds at ${x},${y}`);
    }
    usedSheets.add(sheet);
    writes.push({ arr, at: idx(x, y), sheet, col, row });
  };

  // Floor everywhere.
  const floorBlock = FLOORS[spec.floor];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ref = floorBlock[y % floorBlock.length]![x % floorBlock[0]!.length]!;
      put(ground, x, y, ref.sheet, ref.col, ref.row);
    }
  }

  // Wall ring: the style's cap-and-face pair along the top; single face rows
  // down the sides and along the bottom (the classic LimeZu interior framing).
  const w = WALLS[spec.wall];
  for (let x = 0; x < width; x++) {
    put(objects, x, 0, w.upper.sheet, w.upper.col, w.upper.row);
    put(objects, x, 1, w.lower.sheet, w.lower.col, w.lower.row);
    put(objects, x, height - 1, w.lower.sheet, w.lower.col, w.lower.row);
    collision[idx(x, 0)] = 1;
    collision[idx(x, 1)] = 1;
    collision[idx(x, height - 1)] = 1;
  }
  for (let y = 2; y < height - 1; y++) {
    put(objects, 0, y, w.lower.sheet, w.lower.col, w.lower.row);
    put(objects, width - 1, y, w.lower.sheet, w.lower.col, w.lower.row);
    collision[idx(0, y)] = 1;
    collision[idx(width - 1, y)] = 1;
  }

  // Props.
  for (const placement of spec.props) {
    const b: PropBlock = BLOCKS[placement.block];
    for (let dy = 0; dy < b.h; dy++) {
      for (let dx = 0; dx < b.w; dx++) {
        const x = placement.x + dx;
        const y = placement.y + dy;
        const col = b.col + dx;
        const row = b.row + dy;
        const solid = b.layer === undefined && dy >= b.h - b.solidRows;
        const target =
          b.layer === 'overlay' ? overlay
          : b.layer === 'wall' || b.layer === 'decor' ? objects
          : solid ? objects
          : above;
        put(target, x, y, b.sheet, col, row);
        if (solid) collision[idx(x, y)] = 1;
      }
    }
  }

  // Assign gids: sheets in manifest order, numbered consecutively.
  const declared = manifest.tilesets.filter((s) => usedSheets.has(s.key));
  let nextGid = 1;
  const firstgid = new Map<string, number>();
  for (const sheet of declared) {
    firstgid.set(sheet.key, nextGid);
    nextGid += sheet.columns * sheet.rows;
  }
  for (const write of writes) {
    const sheet = sheetByKey.get(write.sheet);
    const base = firstgid.get(write.sheet);
    if (!sheet || base === undefined) throw new Error(`unknown sheet '${write.sheet}'`);
    if (write.col >= sheet.columns || write.row >= sheet.rows) {
      throw new Error(`${write.sheet} ${write.col},${write.row} outside ${sheet.columns}x${sheet.rows}`);
    }
    write.arr[write.at] = base + write.row * sheet.columns + write.col;
  }
  // Collision markers become a real (invisible) gid so Phaser's
  // setCollisionByExclusion sees non-empty tiles. Use the wall face tile.
  const wallGid = firstgid.get(w.lower.sheet)! + w.lower.row * sheetByKey.get(w.lower.sheet)!.columns + w.lower.col;
  for (let i = 0; i < size; i++) if (collision[i] !== 0) collision[i] = wallGid;

  let nextId = 1;
  const layer = (name: string, data: number[], id: number, visible = true): unknown => ({
    data,
    height,
    id,
    name,
    opacity: 1,
    type: 'tilelayer',
    visible,
    width,
    x: 0,
    y: 0,
  });

  return {
    compressionlevel: -1,
    height,
    infinite: false,
    layers: [
      layer('ground', ground, 1),
      layer('ground_overlay', overlay, 2),
      layer('objects', objects, 3),
      layer('objects_above', above, 4),
      layer('collision', collision, 5, false),
      {
        draworder: 'topdown',
        id: 6,
        name: 'spawns',
        objects: [
          {
            height: 0,
            id: nextId++,
            name: 'default',
            point: true,
            rotation: 0,
            type: '',
            visible: true,
            width: 0,
            x: spec.spawn.x * TILE + TILE / 2,
            y: spec.spawn.y * TILE + TILE / 2,
          },
        ],
        opacity: 1,
        type: 'objectgroup',
        visible: true,
        x: 0,
        y: 0,
      },
      {
        draworder: 'topdown',
        id: 7,
        name: 'interactables',
        objects: spec.interactables.map((o) => ({
          height: TILE,
          id: 100 + nextId++,
          name: o.name,
          point: false,
          properties: o.props,
          rotation: 0,
          type: '',
          visible: true,
          width: o.w * TILE,
          x: o.x * TILE,
          y: o.y * TILE,
        })),
        opacity: 1,
        type: 'objectgroup',
        visible: true,
        x: 0,
        y: 0,
      },
      {
        draworder: 'topdown',
        id: 8,
        name: 'props',
        objects: (spec.animated ?? []).map((o) => ({
          height: TILE,
          id: 300 + nextId++,
          // The object's NAME is the animation key the renderer looks up.
          name: o.key,
          point: false,
          rotation: 0,
          type: '',
          visible: true,
          width: TILE,
          x: o.x * TILE,
          y: o.y * TILE,
        })),
        opacity: 1,
        type: 'objectgroup',
        visible: true,
        x: 0,
        y: 0,
      },
    ],
    nextlayerid: 9,
    nextobjectid: 200,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.0',
    tileheight: TILE,
    tilesets: declared.map((sheet) => ({
      columns: sheet.columns,
      firstgid: firstgid.get(sheet.key)!,
      image: `../generated/${sheet.file}`,
      imageheight: sheet.height,
      imagewidth: sheet.width,
      margin: 0,
      name: sheet.key,
      spacing: 0,
      tilecount: sheet.columns * sheet.rows,
      tileheight: TILE,
      tilewidth: TILE,
    })),
    tilewidth: TILE,
    type: 'map',
    version: '1.10',
    width,
  };
}

const p = (block: BlockKey, x: number, y: number): Placement => ({ block, x, y });
const exitDoor = (x: number, y: number) => ({
  name: 'exit',
  x,
  y,
  w: 2,
  props: [{ name: 'interactive', type: 'string', value: 'exit' }],
});
const whiteboardAt = (x: number, y: number, w = 2) => ({
  name: 'whiteboard',
  x,
  y,
  w,
  props: [{ name: 'interactive', type: 'string', value: 'whiteboard' }],
});

/**
 * A tile you can sit on. Always placed on a WALKABLE tile — the seat mechanic
 * moves the avatar onto it, and the server validates every position against
 * the collision layer, so a seat on a solid tile would be rejected and the
 * sitter resynced back out. That is why the sittable chair blocks below are
 * `decor` (drawn in `objects`, no collision) rather than solid furniture.
 */
const seatAt = (x: number, y: number, facing: 'up' | 'down' | 'left' | 'right') => ({
  name: 'seat',
  x,
  y,
  w: 1,
  props: [
    { name: 'interactive', type: 'string', value: 'seat' },
    { name: 'facing', type: 'string', value: facing },
  ],
});

/**
 * Deterministic pick from a list of interchangeable blocks. Rows of identical
 * furniture are the clearest tell that a room was generated rather than
 * arranged, and varying the model costs nothing: the seed is the map name plus
 * the position, so the same room comes out of every run byte-identical.
 */
function variant<T>(options: readonly T[], seedKey: string): T {
  let hash = 0;
  for (const ch of seedKey) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  const pick = rng(Math.abs(hash))();
  return options[Math.floor(pick * options.length) % options.length]!;
}

type Facing = 'up' | 'down' | 'left' | 'right';

/**
 * A chair and the seat marker that makes it usable, as one call — they were
 * two lists that had to agree about an off-by-one (the chair block is 1x2 and
 * the seat is its LOWER tile), which is exactly the kind of bookkeeping a
 * generator should be doing rather than a person.
 *
 * The model follows the facing: the pack's side chairs at cols 4 and 5 have
 * their backs on opposite sides, and a sitter with the backrest in front of
 * them reads as floating.
 */
function sittable(
  x: number,
  y: number,
  facing: Facing,
  room: string,
): { prop: Placement; mark: ReturnType<typeof seatAt> } {
  const key: BlockKey =
    facing === 'right' ? 'seatRight'
    : facing === 'left' ? 'seatLeft'
    : variant(['seatFrontA', 'seatFrontB'] as const, `${room}:${x},${y}`);
  return { prop: p(key, x, y), mark: seatAt(x, y + 1, facing) };
}

/** Every chair in a room, as the two lists the map spec needs. */
function seating(
  room: string,
  spots: ReadonlyArray<[number, number, Facing]>,
): { props: Placement[]; marks: Array<ReturnType<typeof seatAt>> } {
  const built = spots.map(([x, y, facing]) => sittable(x, y, facing, room));
  return { props: built.map((s) => s.prop), marks: built.map((s) => s.mark) };
}

/**
 * Wall-hung decoration along the north wall, at every free slot on a loose
 * rhythm. Every room had bare walls above the furniture line — the pack ships
 * posters, windows and charts for exactly this, and a blank wall is the
 * difference between "a room" and "a grid with things in it".
 *
 * `taken` is every x already claimed at the wall (doors, boards, windows the
 * spec placed itself); a decoration is skipped rather than shifted, because a
 * shifted one lands on the next thing along.
 */
function wallDecor(
  room: string,
  width: number,
  taken: ReadonlyArray<[number, number]>,
  options: readonly BlockKey[],
  step = 4,
): Placement[] {
  const claimed = (x: number, w: number): boolean =>
    taken.some(([from, to]) => x < to && x + w > from);
  const out: Placement[] = [];
  const next = rng(room.length * 7919);
  for (let x = 2; x < width - 3; x += step) {
    // Leave roughly a third of the slots empty: evenly spaced decoration is
    // its own kind of grid.
    if (next() < 0.34) continue;
    const key = variant(options, `${room}:wall:${x}`);
    const block = BLOCKS[key];
    if (claimed(x, block.w)) continue;
    out.push(p(key, x, 0));
    taken = [...taken, [x, x + block.w]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// The Commons — the atrium everyone arrives in, and the first thing any
// student ever sees of Retry. It used to be 28x12 with six doors and an empty
// middle; it is now a proper hall.
//
// TWELVE door slots, not six. Six was a demo constraint that became a hard
// product ceiling — the seventh public room could not be created at all. The
// API now overflows gracefully into doorless rooms, but the wall should still
// hold most of a cohort's rooms without ever reaching that path. Twelve at a
// four-tile pitch keeps two clear tiles between doors, which is what the
// plaques and the swing animation need; sixteen at a three-tile pitch fit, but
// the doors read as one continuous row of doors and the name plaques collide.
// ---------------------------------------------------------------------------

const COMMONS_DOORS = 12;
/**
 * Tiles between door slots. The door SPRITE is one tile wide (it is drawn on
 * the rect's left tile); the two-tile rect is only the zone `E` works in. So a
 * three-tile pitch still leaves two clear tiles of wall between neighbouring
 * doors, and a 40-tile hall holds twelve of them without becoming a corridor
 * you have to walk the length of to read.
 */
const COMMONS_DOOR_PITCH = 3;
const COMMONS_DOOR_X = (slot: number): number => 2 + slot * COMMONS_DOOR_PITCH;

// Every chair in the Commons, once — the props and the seat markers below are
// both derived from this list so they can never drift apart.
const commonsSeats = seating('commons', [
  [6, 10, 'right'],
  [8, 10, 'left'],
  [17, 11, 'up'],
  [19, 11, 'up'],
  [30, 6, 'right'],
  [32, 6, 'left'],
  [34, 10, 'right'],
  [36, 10, 'left'],
]);

const commons: MapSpec = {
  name: 'commons',
  width: 40,
  height: 16,
  floor: 'stone',
  wall: 'teal',
  spawn: { x: 20, y: 12 },
  props: [
    ...commonsSeats.props,
    // --- West bay: the reading corner you arrive beside ---
    p('bookcase', 1, 3),
    p('bookcase2', 3, 3),
    p('libShelf', 1, 10),
    p('plantPalm', 6, 3),
    p('tableRound', 7, 11),
    p('bench', 4, 7),
    p('lampRed', 9, 6),

    // --- The middle. This was bare floor, in the one room every student
    // crosses on the way to everywhere. It is now an island: a rug with
    // seating on all four sides, so the centre of the Commons is somewhere to
    // STOP and talk rather than a corridor to walk down. ---
    p('rugRed', 17, 6),
    p('bench', 15, 6),
    p('bench', 15, 9),
    p('bench', 22, 6),
    p('bench', 22, 9),
    p('tableRound', 18, 12),
    p('palmBig', 13, 12),
    p('bigPlant', 25, 12),

    // --- East bay: two tables you can actually sit at, and the noticeboard ---
    p('tableRound', 31, 7),
    p('tableRound', 35, 11),
    p('bookcase', 37, 3),
    p('wipSign', 28, 3),
    p('lampBlue', 27, 8),
    p('plantBush', 11, 4),
    p('plantBush2', 33, 13),
    p('plantSmall', 26, 5),
    p('plantSmall2', 38, 12),
  ],
  animated: [
    { key: 'cat', x: 29, y: 12 },
    { key: 'sprout', x: 10, y: 12 },
    { key: 'coffee', x: 12, y: 3 },
  ],
  interactables: [
    ...Array.from({ length: COMMONS_DOORS }, (_, slot) => ({
      name: `door_${slot}`,
      x: COMMONS_DOOR_X(slot),
      y: 1,
      w: 2,
      props: [
        { name: 'interactive', type: 'string', value: 'door' },
        { name: 'door_slot', type: 'int', value: slot },
      ],
    })),
    ...commonsSeats.marks,
  ],
};

// ---------------------------------------------------------------------------
// studio_a — the default project room: PC desks in pairs, a whiteboard wall,
// a bookshelf corner, a sofa to argue on.
// ---------------------------------------------------------------------------

// Desks in pairs, but the pairs sit at different heights and the chairs are
// not all pushed in — three rows at the same y read as a computer lab in a
// stock photo.
const studioSeats = seating('studio_a', [
  [2, 7, 'up'],
  [4, 7, 'up'],
  [14, 6, 'up'],
  [16, 6, 'up'],
  [3, 12, 'up'],
  [12, 10, 'right'],
]);

const studioA: MapSpec = {
  name: 'studio_a',
  width: 20,
  height: 15,
  floor: 'wood',
  wall: 'sky',
  spawn: { x: 10, y: 7 },
  props: [
    ...studioSeats.props,
    p('blackboard', 2, 0),
    p('rugBlue', 8, 5),
    // Work desks. The west pair sits a row lower than the east pair.
    p('deskPc', 2, 4),
    p('deskPc2', 4, 4),
    p('deskPc', 14, 3),
    p('deskPc2', 16, 3),
    p('deskPc', 2, 9),
    p('deskPc2', 4, 9),
    // Library corner.
    p('shelfBooks', 17, 6),
    p('shelfBooks2', 18, 6),
    p('bookcase', 15, 9),
    // Sofa corner, south-east.
    p('sofaRed', 15, 12),
    p('tableRound', 13, 11),
    p('plantBush', 1, 12),
    p('printer', 1, 2),
    p('tv', 9, 12),
  ],
  animated: [
    { key: 'server', x: 18, y: 3 },
    { key: 'sprout', x: 12, y: 2 },
  ],
  interactables: [whiteboardAt(2, 1, 3), exitDoor(9, 14), ...studioSeats.marks],
};

// ---------------------------------------------------------------------------
// classroom — rows of school desks facing the blackboard, library shelving at
// the back. For project crits and study groups.
// ---------------------------------------------------------------------------

const classroomSeats = seating('classroom', [
  [16, 6, 'left'],
  [15, 10, 'right'],
  [4, 4, 'down'],
]);

const classroom: MapSpec = {
  name: 'classroom',
  width: 20,
  height: 15,
  floor: 'sage',
  wall: 'cream',
  spawn: { x: 10, y: 8 },
  props: [
    ...classroomSeats.props,
    p('blackboard', 8, 0),
    p('wallChart', 4, 1),
    p('boardStand', 2, 2),
    p('globe', 17, 3),
    // Desk rows. Alternate rows are offset by a tile and the back row is one
    // desk short: a perfect 3x3 grid was the clearest tell in any of the five
    // rooms that nobody had arranged this by hand.
    ...[3, 8, 13].map((x) => p('schoolDesk', x, 6)),
    ...[4, 9, 14].map((x) => p('schoolDesk', x, 9)),
    ...[3, 8].map((x) => p('schoolDesk', x, 12)),
    // Library along the back.
    p('libShelf', 1, 12),
    p('bookcase2', 1, 5),
    p('plantBush2', 18, 12),
    p('deskBook', 16, 8),
  ],
  animated: [{ key: 'sprout', x: 18, y: 5 }],
  interactables: [whiteboardAt(8, 1, 3), exitDoor(9, 14), ...classroomSeats.marks],
};

// ---------------------------------------------------------------------------
// lounge — the café corner: coffee bar, sofas around a fireplace, warm floor.
// Where a team goes when the build is green (or very red).
// ---------------------------------------------------------------------------

const loungeSeats = seating('lounge', [
  [4, 6, 'right'],
  [8, 3, 'down'],
  [11, 3, 'down'],
  [16, 10, 'left'],
  [3, 11, 'up'],
]);

const lounge: MapSpec = {
  name: 'lounge',
  width: 20,
  height: 15,
  floor: 'herringbone',
  wall: 'weave',
  spawn: { x: 10, y: 8 },
  props: [
    ...loungeSeats.props,
    p('fireplace', 9, 0),
    p('paintingSunset', 3, 0),
    p('paintingSea', 15, 0),
    p('window', 6, 0),
    p('window', 12, 0),
    // The coffee bar along the west wall.
    p('counterLeft', 1, 2),
    p('counterDrawers', 2, 2),
    p('counterPlain', 3, 2),
    p('counterDoors', 4, 2),
    p('counterDrawers', 5, 2),
    p('butcherTable', 6, 3),
    // Sofa circle around the hearth rug.
    p('rugGrey', 9, 6),
    p('sofaCream', 6, 5),
    p('sofaCream', 13, 5),
    p('sofaGrey', 8, 9),
    p('tableRound', 10, 4),
    // Green corners.
    p('palmBig', 17, 2),
    p('bigPlant', 1, 8),
    p('plantBush', 18, 12),
    p('lampRed', 1, 12),
    p('lampBlue', 16, 8),
    p('pouf', 5, 11),
    p('pouf2', 6, 12),
    p('pouf2', 13, 12),
    p('tableRound', 3, 8),
  ],
  animated: [
    { key: 'coffee', x: 3, y: 2 },
    { key: 'candle', x: 10, y: 4 },
    { key: 'cat', x: 16, y: 11 },
  ],
  interactables: [whiteboardAt(9, 1, 2), exitDoor(9, 14), ...loungeSeats.marks],
};

// ---------------------------------------------------------------------------
// conference — the demo stage: projection screen, podium, a big table, and
// audience chairs. Where a team rehearses before facing faculty.
// ---------------------------------------------------------------------------

// Every chair here is sittable — this is the room a team rehearses a demo in,
// so "everyone take a seat" has to mean something.
const conferenceSeats = seating('conference', [
  // Around the meeting table: two sides, plus one at each end.
  [8, 7, 'up'],
  [10, 7, 'up'],
  [7, 4, 'right'],
  [12, 4, 'left'],
  // Audience rows for demo day, offset so they are not a lattice.
  [4, 11, 'up'],
  [5, 11, 'up'],
  [6, 11, 'up'],
  [13, 10, 'up'],
  [14, 10, 'up'],
  [15, 10, 'up'],
]);

const conference: MapSpec = {
  name: 'conference',
  width: 20,
  height: 15,
  floor: 'carpet',
  wall: 'indigo',
  spawn: { x: 10, y: 9 },
  props: [
    ...conferenceSeats.props,
    p('projScreen', 7, 0),
    p('bannerRed', 4, 0),
    p('bannerBlue', 14, 0),
    p('podium', 5, 2),
    // The table you actually meet around.
    p('confTable', 8, 4),
    p('bench', 1, 3),
    p('plantBush2', 17, 2),
    p('plantSmall', 1, 12),
    p('plantSmall2', 18, 12),
    p('rugTallBlue', 16, 6),
  ],
  interactables: [whiteboardAt(7, 1, 5), exitDoor(9, 14), ...conferenceSeats.marks],
};

// Wall decoration, added last so it can see everything already claimed at the
// wall line. Every room had a bare band above the furniture — the pack ships
// posters, windows and charts for exactly this, and an empty wall is most of
// the difference between "a room" and "a grid with things in it".
const WALL_ART = ['paintingSunset', 'paintingSea', 'paintingField', 'window', 'windowWhite'] as const;

/** x ranges already occupied along a map's wall row, read from its own spec. */
function wallClaims(spec: MapSpec): Array<[number, number]> {
  const claims: Array<[number, number]> = [];
  for (const placement of spec.props) {
    const b = BLOCKS[placement.block];
    if (placement.y <= 1) claims.push([placement.x, placement.x + b.w]);
  }
  for (const o of spec.interactables) {
    if (o.y <= 1) claims.push([o.x, o.x + o.w]);
  }
  return claims;
}

// The Commons north wall is doors from end to end; there is nowhere to hang
// anything and nothing would be seen behind twelve door leaves.
for (const spec of [studioA, classroom, lounge, conference]) {
  spec.props.push(...wallDecor(spec.name, spec.width, wallClaims(spec), WALL_ART));
}

for (const spec of [commons, studioA, classroom, lounge, conference]) {
  const path = resolve(root, 'maps', `${spec.name}.json`);
  writeFileSync(path, `${JSON.stringify(build(spec), null, 2)}\n`);
  console.log(`  maps/${spec.name}.json`);
}
