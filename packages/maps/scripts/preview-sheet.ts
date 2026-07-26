import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Canvas, rgb } from '../art/canvas.js';
import { drawText } from '../art/digits.js';
import { decodePng } from '../art/png-decode.js';
import { encodePng } from '../art/png.js';

// Renders a tileset with every tile labelled `col,row`, so furniture can be
// picked by index instead of by counting rows in a 40-row sheet.
//
//   npx tsx scripts/preview-sheet.ts <sheet.png> <out.png> [rowFrom] [rowTo] [scale]

const [, , src, out, rowFromArg, rowToArg, scaleArg] = process.argv;
if (!src || !out) throw new Error('usage: preview-sheet <sheet.png> <out.png> [rowFrom] [rowTo] [scale]');

const TILE = 32;
const SCALE = Number(scaleArg ?? 2);
const sheet = decodePng(readFileSync(resolve(src)));
const cols = Math.floor(sheet.width / TILE);
const totalRows = Math.floor(sheet.height / TILE);
const rowFrom = Math.max(0, Number(rowFromArg ?? 0));
const rowTo = Math.min(totalRows, Number(rowToArg ?? totalRows));
const rows = rowTo - rowFrom;

// Each cell gets a label gutter under it.
const LABEL = 7;
const cellW = TILE * SCALE;
const cellH = TILE * SCALE + LABEL;
const canvas = new Canvas(cols * cellW, rows * cellH);
canvas.rect(0, 0, canvas.width, canvas.height, rgb('#101418'));

const GRID = rgb('#e2935e', 70);
const INK = rgb('#8fa6b8');

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const ox = c * cellW;
    const oy = r * cellH;
    // Chequerboard behind the tile so transparent areas are obvious.
    for (let y = 0; y < TILE * SCALE; y += 8) {
      for (let x = 0; x < TILE * SCALE; x += 8) {
        const dark = ((x / 8 + y / 8) | 0) % 2 === 0;
        canvas.rect(ox + x, oy + y, 8, 8, dark ? rgb('#1a2027') : rgb('#151b21'));
      }
    }
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const px = sheet.get(c * TILE + x, (rowFrom + r) * TILE + y);
        if (px[3] === 0) continue;
        canvas.rect(ox + x * SCALE, oy + y * SCALE, SCALE, SCALE, px);
      }
    }
    canvas.frame(ox, oy, cellW, TILE * SCALE, GRID);
    drawText(canvas, `${c},${rowFrom + r}`, ox + 2, oy + TILE * SCALE + 1, INK);
  }
}

writeFileSync(resolve(out), encodePng(canvas.width, canvas.height, canvas.data));
console.log(`${src}: ${cols} cols x ${totalRows} rows — showing rows ${rowFrom}..${rowTo - 1} → ${out}`);
