import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    ],
    nextlayerid: 8,
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

// ---------------------------------------------------------------------------
// The Commons — the atrium everyone arrives in. Six door slots north; benches,
// rugs and plants make the middle a place to stand and talk rather than a
// corridor. A WIP sign, because every project in the building is one.
// ---------------------------------------------------------------------------

const commons: MapSpec = {
  name: 'commons',
  width: 28,
  height: 12,
  floor: 'stone',
  wall: 'teal',
  spawn: { x: 14, y: 9 },
  props: [
    // Reading corners flanking the hall.
    p('bookcase', 1, 3),
    p('bookcase2', 25, 3),
    p('plantPalm', 1, 8),
    p('plantBush', 26, 8),
    // The centre: a big rug with benches around it.
    p('rugRed', 12, 5),
    p('bench', 9, 5),
    p('bench', 17, 5),
    p('bench', 9, 8),
    p('bench', 17, 8),
    // Small-talk clusters and honest signage.
    p('wipSign', 24, 8),
    p('tableRound', 5, 6),
    p('tableRound', 22, 6),
    p('notice', 6, 1),
    p('notice', 21, 1),
  ],
  interactables: [0, 1, 2, 3, 4, 5].map((slot) => ({
    name: `door_${slot}`,
    x: 2 + slot * 4,
    y: 1,
    w: 2,
    props: [
      { name: 'interactive', type: 'string', value: 'door' },
      { name: 'door_slot', type: 'int', value: slot },
    ],
  })),
};

// ---------------------------------------------------------------------------
// studio_a — the default project room: PC desks in pairs, a whiteboard wall,
// a bookshelf corner, a sofa to argue on.
// ---------------------------------------------------------------------------

const studioA: MapSpec = {
  name: 'studio_a',
  width: 20,
  height: 15,
  floor: 'wood',
  wall: 'sky',
  spawn: { x: 10, y: 7 },
  props: [
    p('blackboard', 2, 0),
    p('window', 7, 0),
    p('window', 12, 0),
    p('rugBlue', 8, 5),
    // Work desks, two pairs facing the board.
    p('deskPc', 2, 4),
    p('deskPc2', 4, 4),
    p('deskPc', 14, 4),
    p('deskPc2', 16, 4),
    p('deskPc', 2, 9),
    p('deskPc2', 4, 9),
    // Library corner.
    p('shelfBooks', 17, 2),
    p('shelfBooks2', 18, 2),
    p('bookcase', 15, 9),
    // Sofa corner, south-east.
    p('sofaRed', 15, 12),
    p('tableRound', 13, 11),
    p('plantBush', 1, 12),
    p('printer', 1, 2),
    p('globe', 18, 8),
  ],
  interactables: [whiteboardAt(2, 1, 3), exitDoor(9, 14)],
};

// ---------------------------------------------------------------------------
// classroom — rows of school desks facing the blackboard, library shelving at
// the back. For project crits and study groups.
// ---------------------------------------------------------------------------

const classroom: MapSpec = {
  name: 'classroom',
  width: 20,
  height: 15,
  floor: 'sage',
  wall: 'cream',
  spawn: { x: 10, y: 8 },
  props: [
    p('blackboard', 8, 0),
    p('wallChart', 4, 1),
    p('window', 14, 0),
    p('boardStand', 2, 2),
    p('globe', 17, 2),
    // Desk rows, three columns by three rows, all facing the board.
    ...[3, 8, 13].flatMap((x) => [5, 8, 11].map((y) => p('schoolDesk', x, y))),
    // Library along the back.
    p('libShelf', 2, 12),
    p('libShelf', 16, 12),
    p('bookcase2', 1, 5),
    p('plantBush2', 18, 12),
    p('deskBook', 16, 5),
  ],
  interactables: [whiteboardAt(8, 1, 3), exitDoor(9, 14)],
};

// ---------------------------------------------------------------------------
// lounge — the café corner: coffee bar, sofas around a fireplace, warm floor.
// Where a team goes when the build is green (or very red).
// ---------------------------------------------------------------------------

const lounge: MapSpec = {
  name: 'lounge',
  width: 20,
  height: 15,
  floor: 'herringbone',
  wall: 'weave',
  spawn: { x: 10, y: 8 },
  props: [
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
  interactables: [whiteboardAt(9, 1, 2), exitDoor(9, 14)],
};

// ---------------------------------------------------------------------------
// conference — the demo stage: projection screen, podium, a big table, and
// audience chairs. Where a team rehearses before facing faculty.
// ---------------------------------------------------------------------------

const conference: MapSpec = {
  name: 'conference',
  width: 20,
  height: 15,
  floor: 'carpet',
  wall: 'indigo',
  spawn: { x: 10, y: 9 },
  props: [
    p('projScreen', 7, 0),
    p('bannerRed', 4, 0),
    p('bannerBlue', 14, 0),
    p('podium', 5, 2),
    // The table you actually meet around.
    p('confTable', 8, 4),
    p('chair', 7, 9),
    p('chair', 9, 9),
    p('chair', 11, 9),
    // Audience rows for demo day.
    p('chair', 4, 11),
    p('chair', 5, 11),
    p('chair', 6, 11),
    p('chair', 13, 11),
    p('chair', 14, 11),
    p('chair', 15, 11),
    p('bench', 1, 3),
    p('plantBush2', 17, 2),
    p('plantSmall', 1, 12),
    p('plantSmall2', 18, 12),
    p('rugTallBlue', 16, 6),
  ],
  interactables: [whiteboardAt(7, 1, 5), exitDoor(9, 14)],
};

for (const spec of [commons, studioA, classroom, lounge, conference]) {
  const path = resolve(root, 'maps', `${spec.name}.json`);
  writeFileSync(path, `${JSON.stringify(build(spec), null, 2)}\n`);
  console.log(`  maps/${spec.name}.json`);
}
