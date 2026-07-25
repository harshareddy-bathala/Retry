import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_NAMES, TILE, COLUMNS, TILES } from '../art/tiles.js';

// Authors the Tiled JSON for both maps from an ASCII layout.
//
// The output is ordinary Tiled JSON — open either map in Tiled and edit it by
// hand — but the source of truth is this file, because a 20x15 map is 300
// numbers per layer and nobody can review a diff of that. Here a room is a
// picture you can read, and tiles are named, so re-ordering the tileset can
// never silently turn every desk into a plant.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const GID = new Map(TILE_NAMES.map((name, i) => [name, i + 1]));
const gid = (name: string): number => {
  const g = GID.get(name);
  if (g === undefined) throw new Error(`unknown tile '${name}'`);
  return g;
};

// Legend shared by both maps. Ground and objects are separate pictures so a
// desk can stand on floor and a wall can stand on nothing.
const GROUND: Record<string, string[]> = {
  '.': ['floor_wood_a', 'floor_wood_b', 'floor_wood_c'],
  ',': ['floor_pale_a', 'floor_pale_b'],
  s: ['floor_stone'],
  ' ': [],
};

const OBJECTS: Record<string, string> = {
  '#': 'wall_top',
  '=': 'wall_face',
  '-': 'wall_face_plain',
  n: 'wall_window',
  B: 'whiteboard_l',
  b: 'whiteboard_r',
  D: 'door_closed_l',
  d: 'door_closed_r',
  X: 'exit_l',
  x: 'exit_r',
  E: 'desk_l',
  e: 'desk_r',
  c: 'chair_up',
  C: 'chair_down',
  S: 'sofa_l',
  s: 'sofa_r',
  t: 'table',
  P: 'plant_big',
  p: 'plant_small',
  h: 'shelf',
  l: 'lamp',
};

/** Which object tiles stop a body. Everything else is decoration you walk past. */
const SOLID = new Set([
  'wall_top',
  'wall_face',
  'wall_face_plain',
  'wall_window',
  'whiteboard_l',
  'whiteboard_r',
  'door_closed_l',
  'door_closed_r',
  'exit_l',
  'exit_r',
  'desk_l',
  'desk_r',
  'sofa_l',
  'sofa_r',
  'table',
  'plant_big',
  'shelf',
]);

type MapSpec = {
  name: string;
  ground: string;
  objects: string;
  /** Rug top-left corner in tiles, 3x3. */
  rug?: { x: number; y: number };
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
  const collision: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gKey = groundRows[y]![x]!;
      const variants = GROUND[gKey] ?? [];
      // Deterministic variant pick — a fixed hash, so the floor never reshuffles
      // between runs and the JSON diff stays empty when nothing changed.
      ground.push(variants.length === 0 ? 0 : gid(variants[(x * 7 + y * 13) % variants.length]!));

      const oKey = objectRows[y]![x]!;
      const name = oKey === '.' || oKey === ' ' ? null : OBJECTS[oKey];
      if (oKey !== '.' && oKey !== ' ' && !name) throw new Error(`${spec.name}: unknown object '${oKey}'`);
      objects.push(name ? gid(name) : 0);
      collision.push(name && SOLID.has(name) ? gid(name) : 0);
    }
  }

  // Rug: nine tiles laid over the ground, picked by position in the block.
  if (spec.rug) {
    const edges = ['rug_tl', 'rug_t', 'rug_tr', 'rug_l', 'rug_c', 'rug_r', 'rug_bl', 'rug_b', 'rug_br'];
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        ground[(spec.rug.y + dy) * width + spec.rug.x + dx] = gid(edges[dy * 3 + dx]!);
      }
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
      // Kept as a tile layer so the contract in validate.ts is unchanged; the
      // renderer hides it and both sides read it as a boolean grid.
      { ...(layer('collision', collision, 3) as object), visible: false },
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
    nextlayerid: 6,
    nextobjectid: 200,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.0',
    tileheight: TILE,
    tilesets: [
      {
        columns: COLUMNS,
        firstgid: 1,
        image: '../tilesets/retry.png',
        imageheight: Math.ceil(TILES.length / COLUMNS) * TILE,
        imagewidth: COLUMNS * TILE,
        margin: 0,
        name: 'retry',
        spacing: 0,
        tilecount: TILES.length,
        tileheight: TILE,
        tilewidth: TILE,
      },
    ],
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
############################
##Dd==Dd==Dd==Dd==Dd==Dd=n=#
#..........................#
#.P......h..........h....P.#
#..........................#
#..........................#
#..........................#
#....Ss..............Ss....#
#....................t.....#
#.l.......p.......p......l.#
#..........................#
############################
`,
  rug: { x: 12, y: 4 },
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
####################
#====Bb====n=======#
#..................#
#.h...............P#
#..Ee.......Ee.....#
#..cc.......cc.....#
#..................#
#..................#
#..Ee.......Ee.....#
#..cc.......cc.....#
#.P................#
#......Ss..t......h#
#..................#
#..................#
#########Xx#########
`,
  rug: { x: 8, y: 6 },
  spawn: { x: 10, y: 7 },
  interactables: [
    {
      name: 'whiteboard',
      x: 5,
      y: 1,
      w: 2,
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
