import { writeFileSync } from 'node:fs';
import { Canvas, rgb } from '../art/canvas.js';
import { encodePng } from '../art/png.js';
import { TILE, TILES } from '../art/tiles.js';

// Composes a mock room out of the tileset so the art can be judged the way a
// student sees it — in context, at game zoom — instead of as a contact sheet.
// A tile that looks fine alone and wrong in a wall is the normal case.

const byName = new Map(TILES.map((t) => [t.name, t]));

function draw(name: string, seed: number): Canvas {
  const tile = byName.get(name);
  if (!tile) throw new Error(`no tile '${name}'`);
  const c = new Canvas(TILE, TILE);
  tile.draw(c, seed);
  return c;
}

// Two layers of names; '.' = nothing. Mirrors how a real map is authored.
const GROUND = `
FFFFFFFFFFFFFF
FFFFFFFFFFFFFF
FFFFFFFFFFFFFF
FFFFrrrrrrFFFF
FFFFrrrrrrFFFF
FFFFrrrrrrFFFF
FFFFFFFFFFFFFF
FFFFFFFFFFFFFF
`;

const OBJECTS = `
TTTTTTTTTTTTTT
WWBBWWDDWWWnWW
..............
..pd..........
...s..........
..............
.SS...ct..PP..
..............
`;

const GROUND_TILES: Record<string, string[]> = {
  F: ['floor_wood_a', 'floor_wood_b', 'floor_wood_c'],
  r: ['rug_c'],
};
const RUG_EDGES = ['rug_tl', 'rug_t', 'rug_tr', 'rug_l', 'rug_c', 'rug_r', 'rug_bl', 'rug_b', 'rug_br'];

const OBJECT_TILES: Record<string, string> = {
  T: 'wall_top',
  W: 'wall_face',
  B: 'whiteboard_l',
  D: 'door_closed_l',
  n: 'wall_window',
  p: 'desk_l',
  d: 'desk_r',
  s: 'chair_up',
  S: 'sofa_l',
  c: 'table',
  t: 'plant_small',
  P: 'plant_big',
};

const ground = GROUND.trim().split('\n');
const objects = OBJECTS.trim().split('\n');
const W = ground[0]!.length;
const H = ground.length;

const SCALE = 3;
const world = new Canvas(W * TILE, H * TILE);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const key = ground[y]![x]!;
    if (key === 'r') {
      // Pick the right rug piece from its position inside the 3x3 block.
      const top = ground[y - 1]?.[x] !== 'r';
      const bottom = ground[y + 1]?.[x] !== 'r';
      const left = ground[y]![x - 1] !== 'r';
      const right = ground[y]![x + 1] !== 'r';
      const row = top ? 0 : bottom ? 2 : 1;
      const col = left ? 0 : right ? 2 : 1;
      world.blit(draw(RUG_EDGES[row * 3 + col]!, 7), x * TILE, y * TILE);
      continue;
    }
    const variants = GROUND_TILES[key];
    if (!variants) continue;
    world.blit(draw(variants[(x * 7 + y * 13) % variants.length]!, 100 + x + y * 31), x * TILE, y * TILE);
  }
}
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const key = objects[y]?.[x];
    if (!key || key === '.') continue;
    // Pair tiles: the second half of a 2-wide object follows the first.
    let name = OBJECT_TILES[key]!;
    const prev = objects[y]?.[x - 1];
    if (prev === key && (key === 'B' || key === 'D' || key === 'S' || key === 'P')) {
      name = name.replace(/_l$/, '_r');
    }
    if (key === 'p' || key === 'd') name = key === 'p' ? 'desk_l' : 'desk_r';
    world.blit(draw(name, 200 + x * 5 + y * 17), x * TILE, y * TILE);
  }
}

const out = new Canvas(world.width * SCALE, world.height * SCALE);
out.rect(0, 0, out.width, out.height, rgb('#12100e'));
for (let y = 0; y < world.height; y++) {
  for (let x = 0; x < world.width; x++) {
    const c = world.get(x, y);
    if (c[3] === 0) continue;
    out.rect(x * SCALE, y * SCALE, SCALE, SCALE, c);
  }
}

const target = process.argv[2] ?? 'scene-preview.png';
writeFileSync(target, encodePng(out.width, out.height, out.data));
console.log(`scene ${W}x${H} tiles → ${target}`);
