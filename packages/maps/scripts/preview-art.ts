import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Canvas, rgb } from '../art/canvas.js';
import { encodePng } from '../art/png.js';
import { renderTileset, TILE, TILES } from '../art/tiles.js';

// Dev-only: blows the sheet up so a human (or a model) can actually judge the
// pixels. Writes wherever the first CLI argument points.
const SCALE = 5;
const target = process.argv[2] ?? resolve('tileset-preview.png');
const { canvas, columns, rows } = renderTileset();
const out = new Canvas(canvas.width * SCALE, canvas.height * SCALE);
out.rect(0, 0, out.width, out.height, rgb('#12100e'));
for (let y = 0; y < canvas.height; y++) {
  for (let x = 0; x < canvas.width; x++) {
    const c = canvas.get(x, y);
    if (c[3] === 0) continue;
    out.rect(x * SCALE, y * SCALE, SCALE, SCALE, c);
  }
}
for (let i = 0; i <= columns; i++) out.rect(i * TILE * SCALE, 0, 1, out.height, rgb('#e2935e', 90));
for (let i = 0; i <= rows; i++) out.rect(0, i * TILE * SCALE, out.width, 1, rgb('#e2935e', 90));
writeFileSync(target, encodePng(out.width, out.height, out.data));
TILES.forEach((t, i) => {
  process.stdout.write(`${i % columns === 0 ? '\n  ' : ''}${t.name.padEnd(17)}`);
});
console.log('');
