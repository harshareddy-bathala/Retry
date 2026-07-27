import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from '../art/canvas.js';
import { decodePng } from '../art/png-decode.js';
import { encodePng } from '../art/png.js';
import { drawText } from '../art/digits.js';
import { BLOCKS } from '../tiles.catalog.js';

// Contact sheet of every prop block in the catalogue, so a wrong (col,row)
// pick is caught by eye before it ships inside five maps.
//
//   npx tsx scripts/preview-blocks.ts <out.png>

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = process.argv[2];
if (!out) {
  console.error('usage: preview-blocks.ts <out.png>');
  process.exit(1);
}

const sheets = new Map<string, Canvas>();
type ManifestSheet = { key: string; file: string };
const manifest = JSON.parse(readFileSync(resolve(root, 'generated', 'manifest.json'), 'utf8')) as {
  tilesets: ManifestSheet[];
};
for (const t of manifest.tilesets) {
  sheets.set(t.key, decodePng(readFileSync(resolve(root, 'generated', t.file))));
}

const TILE = 32;
const SCALE = 2;
const entries = Object.entries(BLOCKS);
const CELL_W = 6 * TILE * SCALE;
const CELL_H = 5 * TILE * SCALE + 10;
const COLS = 6;
const rows = Math.ceil(entries.length / COLS);
const canvas = new Canvas(COLS * CELL_W, rows * CELL_H);

// Checkerboard so transparency reads.
for (let y = 0; y < canvas.height; y++) {
  for (let x = 0; x < canvas.width; x++) {
    const dark = ((x >> 3) + (y >> 3)) % 2 === 0;
    canvas.set(x, y, dark ? [40, 40, 48, 255] : [52, 52, 62, 255]);
  }
}

entries.forEach(([key, block], i) => {
  const cx = (i % COLS) * CELL_W;
  const cy = Math.floor(i / COLS) * CELL_H;
  const sheet = sheets.get(block.sheet);
  if (!sheet) throw new Error(`no sheet ${block.sheet}`);
  for (let ty = 0; ty < block.h; ty++) {
    for (let tx = 0; tx < block.w; tx++) {
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const c = sheet.get((block.col + tx) * TILE + x, (block.row + ty) * TILE + y);
          if (c[3] === 0) continue;
          for (let sy = 0; sy < SCALE; sy++) {
            for (let sx = 0; sx < SCALE; sx++) {
              canvas.set(cx + (tx * TILE + x) * SCALE + sx, cy + (ty * TILE + y) * SCALE + sy, c);
            }
          }
        }
      }
    }
  }
  // digits.ts only knows 0-9 , : — encode the key's position instead.
  drawText(canvas, `${i}`, cx + 2, cy + CELL_H - 8, [255, 240, 200, 255]);
  console.log(`${i}: ${key} (${block.sheet} ${block.col},${block.row} ${block.w}x${block.h})`);
});

writeFileSync(out, encodePng(canvas.width, canvas.height, canvas.data));
console.log(`→ ${out}`);
