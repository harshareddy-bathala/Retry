import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from '../art/canvas.js';
import { decodePng } from '../art/png-decode.js';
import { encodePng } from '../art/png.js';

// Renders a map to PNG exactly as the game layers it, so a bad catalogue pick
// is visible before a browser ever loads the map.
//
//   npx tsx scripts/preview-map.ts <name> <out.png> [scale]
//
// Handles multi-tileset gids via each map's own firstgid table (the previous
// incarnation assumed one sheet at firstgid 1 and died with the pack).

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const [name, out, scaleArg] = process.argv.slice(2);
if (!name || !out) {
  console.error('usage: preview-map.ts <mapname> <out.png> [scale]');
  process.exit(1);
}
const scale = Math.max(1, Number(scaleArg ?? 1));

type TilesetRef = {
  name: string;
  firstgid: number;
  image: string;
  columns: number;
  tilecount: number;
};
type TileLayer = { type: 'tilelayer'; name: string; data: number[]; visible: boolean };
const map = JSON.parse(readFileSync(resolve(root, 'maps', `${name}.json`), 'utf8')) as {
  width: number;
  height: number;
  tilesets: TilesetRef[];
  layers: Array<TileLayer | { type: string; name: string }>;
};

const sheets = map.tilesets
  .map((t) => ({ ...t, pixels: decodePng(readFileSync(resolve(root, 'maps', t.image))) }))
  .sort((a, b) => a.firstgid - b.firstgid);

const TILE = 32;
const outCanvas = new Canvas(map.width * TILE, map.height * TILE);

const DRAW_ORDER = ['ground', 'ground_overlay', 'objects', 'objects_above'];
for (const layerName of DRAW_ORDER) {
  const layer = map.layers.find(
    (l): l is TileLayer => l.type === 'tilelayer' && l.name === layerName,
  );
  if (!layer) continue;
  layer.data.forEach((gid, i) => {
    if (gid === 0) return;
    const sheet = [...sheets].reverse().find((s) => gid >= s.firstgid);
    if (!sheet) throw new Error(`gid ${gid} matches no tileset`);
    const local = gid - sheet.firstgid;
    const sx = (local % sheet.columns) * TILE;
    const sy = Math.floor(local / sheet.columns) * TILE;
    const dx = (i % map.width) * TILE;
    const dy = Math.floor(i / map.width) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const c = sheet.pixels.get(sx + x, sy + y);
        if (c[3] > 0) outCanvas.set(dx + x, dy + y, c);
      }
    }
  });
}

const scaled = new Canvas(outCanvas.width * scale, outCanvas.height * scale);
for (let y = 0; y < scaled.height; y++) {
  for (let x = 0; x < scaled.width; x++) {
    scaled.set(x, y, outCanvas.get(Math.floor(x / scale), Math.floor(y / scale)));
  }
}
writeFileSync(out, encodePng(scaled.width, scaled.height, scaled.data));
console.log(`${name}: ${map.width}x${map.height} → ${out} @${scale}x`);
