import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, rgb } from '../art/canvas.js';
import { encodePng } from '../art/png.js';
import { AVATARS, renderAvatar } from '../art/avatars.js';
import { TILE, TILES } from '../art/tiles.js';

// Renders an authored map exactly as the game will draw it, with the six
// avatars standing in it for scale. This is the check that matters: a tileset
// is only as good as the room it builds.
//
//   npx tsx scripts/preview-map.ts commons out.png [scale]

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const name = process.argv[2] ?? 'commons';
const target = process.argv[3] ?? `${name}-preview.png`;
const scale = Number(process.argv[4] ?? 2);

type TileLayer = { type: 'tilelayer'; name: string; data: number[] };
type Loaded = { width: number; height: number; layers: Array<TileLayer | { type: string; name: string }> };

const map = JSON.parse(readFileSync(resolve(root, 'maps', `${name}.json`), 'utf8')) as Loaded;
const layers = new Map(
  map.layers.filter((l): l is TileLayer => l.type === 'tilelayer').map((l) => [l.name, l]),
);

const world = new Canvas(map.width * TILE, map.height * TILE);
const cache = new Map<number, Canvas>();
const tileAt = (g: number, seed: number): Canvas => {
  const hit = cache.get(g * 1000 + (seed % 1000));
  if (hit) return hit;
  const c = new Canvas(TILE, TILE);
  TILES[g - 1]!.draw(c, seed);
  cache.set(g * 1000 + (seed % 1000), c);
  return c;
};

for (const layerName of ['ground', 'objects']) {
  const layer = layers.get(layerName);
  if (!layer) continue;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const g = layer.data[y * map.width + x]!;
      if (g === 0) continue;
      world.blit(tileAt(g, 100 + x * 17 + y * 31), x * TILE, y * TILE);
    }
  }
}

// Drop the cast in a row so the world has people in it.
AVATARS.forEach((spec, i) => {
  const sheet = renderAvatar(spec);
  const frame = new Canvas(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) frame.set(x, y, sheet.get(x + TILE * (i % 4), y));
  }
  const tx = Math.floor(map.width / 2) - 3 + i;
  const ty = Math.floor(map.height / 2) + 1;
  world.blit(frame, tx * TILE, ty * TILE - 6);
});

const out = new Canvas(world.width * scale, world.height * scale);
out.rect(0, 0, out.width, out.height, rgb('#12100e'));
for (let y = 0; y < world.height; y++) {
  for (let x = 0; x < world.width; x++) {
    const c = world.get(x, y);
    if (c[3] === 0) continue;
    out.rect(x * scale, y * scale, scale, scale, c);
  }
}
writeFileSync(target, encodePng(out.width, out.height, out.data));
console.log(`${name}: ${map.width}x${map.height} tiles → ${target}`);
