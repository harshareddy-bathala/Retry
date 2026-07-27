import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from '../art/canvas.js';
import { decodePng } from '../art/png-decode.js';
import { encodePng } from '../art/png.js';
import { drawText } from '../art/digits.js';

// Renders wall-style CANDIDATES: for a column, every row pair (r, r+1) drawn
// as a 3-wide wall run — the exact thing the seeder builds — so the correct
// (upper, lower) rows are picked from evidence, not squinting at a grid.
//
//   npx tsx scripts/preview-walls.ts <sheetKey> <col> <fromRow> <toRow> <out.png>

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const [sheetKey, colArg, fromArg, toArg, out] = process.argv.slice(2);
if (!sheetKey || !colArg || !fromArg || !toArg || !out) {
  console.error('usage: preview-walls.ts <sheetKey> <col> <fromRow> <toRow> <out.png>');
  process.exit(1);
}
const col = Number(colArg);
const from = Number(fromArg);
const to = Number(toArg);

type ManifestSheet = { key: string; file: string };
const manifest = JSON.parse(readFileSync(resolve(root, 'generated', 'manifest.json'), 'utf8')) as {
  tilesets: ManifestSheet[];
};
const entry = manifest.tilesets.find((t) => t.key === sheetKey);
if (!entry) throw new Error(`no sheet '${sheetKey}'`);
const sheet = decodePng(readFileSync(resolve(root, 'generated', entry.file)));

const TILE = 32;
const SCALE = 2;
const RUN = 3;
const pairs = to - from + 1;
const CELL_W = (RUN + 1) * TILE * SCALE;
const CELL_H = 2 * TILE * SCALE + 12;
const canvas = new Canvas(CELL_W * 4, Math.ceil(pairs / 4) * CELL_H);
for (let y = 0; y < canvas.height; y++) {
  for (let x = 0; x < canvas.width; x++) canvas.set(x, y, [45, 45, 55, 255]);
}

for (let i = 0; i < pairs; i++) {
  const upperRow = from + i;
  const cx = (i % 4) * CELL_W;
  const cy = Math.floor(i / 4) * CELL_H;
  for (const [band, row] of [
    [0, upperRow],
    [1, upperRow + 1],
  ] as const) {
    for (let run = 0; run < RUN; run++) {
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const c = sheet.get(col * TILE + x, row * TILE + y);
          if (c[3] === 0) continue;
          for (let sy = 0; sy < SCALE; sy++) {
            for (let sx = 0; sx < SCALE; sx++) {
              canvas.set(cx + (run * TILE + x) * SCALE + sx, cy + (band * TILE + y) * SCALE + sy, c);
            }
          }
        }
      }
    }
  }
  drawText(canvas, `${upperRow}`, cx + RUN * TILE * SCALE + 6, cy + 6, [255, 240, 200, 255]);
}

writeFileSync(out, encodePng(canvas.width, canvas.height, canvas.data));
console.log(`${sheetKey} col ${col} pairs ${from}..${to} → ${out}`);
