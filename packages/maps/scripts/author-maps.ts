import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { TILE } from '../assets.config.js';
import { FLOORS, PROPS, WALLS, type TileRef } from '../tiles.catalog.js';

// Authors the Tiled JSON for both maps from an ASCII layout.
//
// The output is ordinary Tiled JSON — open either map in Tiled and edit it by
// hand — but the source of truth is this file, because a 20x15 map is 300
// numbers per layer and nobody can review a diff of that. Here a room is a
// picture you can read, and tiles are named, so re-ordering the tileset can
// never silently turn every desk into a plant.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

type ManifestSheet = {
  key: string;
  file: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
};
const manifest = JSON.parse(
  readFileSync(resolve(root, 'generated', 'manifest.json'), 'utf8'),
) as { source: string; tilesets: ManifestSheet[] };

/**
 * Tiled addresses tiles by a GLOBAL id: each tileset declares a `firstgid` and
 * its own tiles run consecutively from there. With one sheet that was just
 * `index + 1`; with ten it has to be computed, and getting it wrong turns every
 * desk into a wall.
 */
let nextGid = 1;
const SHEETS = manifest.tilesets.map((sheet) => {
  const firstgid = nextGid;
  nextGid += sheet.columns * sheet.rows;
  return { ...sheet, firstgid };
});
const sheetByKey = new Map(SHEETS.map((sheet) => [sheet.key, sheet]));

const gidOf = (ref: TileRef): number => {
  const sheet = sheetByKey.get(ref.sheet);
  if (!sheet) throw new Error(`no tileset '${ref.sheet}' in the manifest — run assets:build`);
  if (ref.col >= sheet.columns || ref.row >= sheet.rows) {
    throw new Error(`${ref.sheet} ${ref.col},${ref.row} is outside ${sheet.columns}x${sheet.rows}`);
  }
  return sheet.firstgid + ref.row * sheet.columns + ref.col;
};

// Legend shared by both maps. Ground and objects are separate pictures so a
// desk can stand on floor and a wall can stand on nothing.
/**
 * Floors come as 3x2 tileable blocks, so which tile a cell gets depends on its
 * position in the grid — that is what stops a large floor showing a seam every
 * three tiles.
 */
const FLOOR_BLOCKS: Record<string, readonly (readonly TileRef[])[]> = {
  '.': FLOORS.wood,
  ',': FLOORS.stone,
};

/**
 * One character per TILE. Most LimeZu furniture is two or three tiles tall — a
 * PC desk is monitor over desktop over desk-front — so a prop is drawn as a
 * vertical run of characters, top to bottom, not a single glyph.
 */
const OBJECTS: Record<string, TileRef> = {
  // Walls: the upper row carries the cap you look down on, the lower row the
  // skirting that meets the floor.
  Q: WALLS.plain.upperL,
  W: WALLS.plain.upperM,
  Y: WALLS.plain.upperR,
  A: WALLS.plain.lowerL,
  S: WALLS.plain.lowerM,
  D: WALLS.plain.lowerR,
  // Props, read top-to-bottom.
  '1': PROPS.deskPc[0]!,
  '2': PROPS.deskPc[1]!,
  '3': PROPS.deskPc[2]!,
  '4': PROPS.deskPc2[0]!,
  '5': PROPS.deskPc2[1]!,
  '6': PROPS.deskPc2[2]!,
  h: PROPS.shelf[0]!,
  i: PROPS.shelf[1]!,
  j: PROPS.shelf[2]!,
  k: PROPS.shelf2[0]!,
  l: PROPS.shelf2[1]!,
  m: PROPS.shelf2[2]!,
  B: PROPS.board[0]!,
  b: PROPS.board[1]!,
  E: PROPS.desk[0]!,
  e: PROPS.desk[1]!,
  P: PROPS.printer[0]!,
  p: PROPS.printer[1]!,
  n: PROPS.notice[0]!,
};

/**
 * Which glyphs stop a body. Only the BOTTOM tile of a tall prop blocks: the
 * upper tiles are the part you walk behind, which is what gives a top-down
 * room its depth.
 */
const SOLID_GLYPHS = new Set([
  'Q',
  'W',
  'Y',
  'A',
  'S',
  'D',
  '3',
  '6',
  'j',
  'm',
  'b',
  'e',
  'p',
]);

/**
 * The upper tiles of tall props — the part you walk BEHIND. These go to the
 * `objects_above` layer, which the renderer draws over every actor; the
 * solid bottom tile stays in `objects` below them. Walls are deliberately
 * not here: an avatar's head overlapping a wall face reads as standing in
 * front of the wall plane, which is right.
 */
const ABOVE_GLYPHS = new Set(['1', '2', '4', '5', 'h', 'i', 'k', 'l', 'B', 'E', 'P']);

type MapSpec = {
  name: string;
  ground: string;
  objects: string;
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
  const groundRows = spec.ground.trim().split('\n');
  const objectRows = spec.objects.trim().split('\n');
  const height = groundRows.length;
  const width = groundRows[0]!.length;
  for (const [i, row] of groundRows.entries()) {
    if (row.length !== width) throw new Error(`${spec.name}: ground row ${i} is ${row.length} wide, expected ${width}`);
  }
  for (const [i, row] of objectRows.entries()) {
    if (row.length !== width) throw new Error(`${spec.name}: objects row ${i} is ${row.length} wide, expected ${width}`);
  }
  if (objectRows.length !== height) throw new Error(`${spec.name}: layers differ in height`);

  const ground: number[] = [];
  const objects: number[] = [];
  const objectsAbove: number[] = [];
  const collision: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gKey = groundRows[y]![x]!;
      const block = FLOOR_BLOCKS[gKey];
      // A floor block is 3 wide by 2 tall and tiles seamlessly, so which tile a
      // cell gets is decided by its position in the grid, not at random —
      // random picks show a visible seam every few tiles.
      ground.push(block ? gidOf(block[y % block.length]![x % block[0]!.length]!) : 0);

      const oKey = objectRows[y]![x]!;
      const ref = oKey === '.' || oKey === ' ' ? null : OBJECTS[oKey];
      if (oKey !== '.' && oKey !== ' ' && !ref) throw new Error(`${spec.name}: unknown object '${oKey}'`);
      const above = ref !== null && ref !== undefined && ABOVE_GLYPHS.has(oKey);
      objects.push(ref && !above ? gidOf(ref) : 0);
      objectsAbove.push(ref && above ? gidOf(ref) : 0);
      collision.push(ref && SOLID_GLYPHS.has(oKey) ? gidOf(ref) : 0);
    }
  }

  let nextId = 1;
  const layer = (name: string, data: number[], id: number): unknown => ({
    data,
    height,
    id,
    name,
    opacity: 1,
    type: 'tilelayer',
    visible: true,
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
      layer('objects', objects, 2),
      layer('objects_above', objectsAbove, 3),
      // Kept as a tile layer so the contract in validate.ts is unchanged; the
      // renderer hides it and both sides read it as a boolean grid.
      { ...(layer('collision', collision, 6) as object), visible: false },
      {
        draworder: 'topdown',
        id: 4,
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
        id: 5,
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
    nextlayerid: 7,
    nextobjectid: 200,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.0',
    tileheight: TILE,
    // Every sheet the build produced, each with its own firstgid. Declaring
    // them all keeps the gid arithmetic here identical to what Tiled and Phaser
    // compute, so a map opens correctly in both.
    tilesets: SHEETS.map((sheet) => ({
      columns: sheet.columns,
      firstgid: sheet.firstgid,
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

// ---------------------------------------------------------------------------
// The Commons — an atrium you arrive in. Six doors along the north wall, a rug
// in the middle to stand and talk on, seating at the edges, plants in corners.
// ---------------------------------------------------------------------------

const commons = build({
  name: 'commons',
  ground: `
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,
`,
  objects: `
QWWWWWWWWWWWWWWWWWWWWWWWWWWY
ASSSSSSSSSSSSSSSSSSSSSSSSSSD
A..........................D
A.hk....................hk.D
A.il....................il.D
A.jm....................jm.D
A..........................D
A..........................D
A..........................D
A.....n...............n....D
A..........................D
ASSSSSSSSSSSSSSSSSSSSSSSSSSD
`,
  spawn: { x: 14, y: 9 },
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
});

// ---------------------------------------------------------------------------
// studio_a — a project room: desks facing the whiteboard, a sofa corner to
// argue in, shelves, and an exit door south.
// ---------------------------------------------------------------------------

const studio = build({
  name: 'studio_a',
  ground: `
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
`,
  objects: `
QWWWWWWWWWWWWWWWWWWY
ASSSSSSSSSSSSSSSSSSD
A..B...............D
A..b...............D
A..................D
A.14.........14....D
A.25.........25....D
A.36.........36....D
A..................D
A..................D
A.14.........14..hkD
A.25.........25..ilD
A.36.........36..jmD
A.Pn...............D
ASSSSSSSSSSSSSSSSSSD
`,
  spawn: { x: 10, y: 7 },
  interactables: [
    {
      name: 'whiteboard',
      x: 3,
      y: 2,
      w: 1,
      props: [{ name: 'interactive', type: 'string', value: 'whiteboard' }],
    },
    {
      name: 'exit',
      x: 9,
      y: 14,
      w: 2,
      props: [{ name: 'interactive', type: 'string', value: 'exit' }],
    },
  ],
});

for (const [name, map] of [
  ['commons', commons],
  ['studio_a', studio],
] as const) {
  const path = resolve(root, 'maps', `${name}.json`);
  writeFileSync(path, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`  maps/${name}.json`);
}
