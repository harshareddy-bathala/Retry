import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, rgb } from '../art/canvas.js';
import { drawText } from '../art/digits.js';
import { decodePng } from '../art/png-decode.js';
import { encodePng } from '../art/png.js';

// Renders a region of a tileset with every tile labelled `col,row`.
//
//   pnpm --filter @retry/maps preview:sheet <key> [col row cols rows] [--scale N]
//   pnpm --filter @retry/maps preview:sheet walls3d 0 0 24 12
//
// This is the other half of the authoring loop. `preview:all` shows you what
// the room looks like; this shows you what is available to put in it. A gid is
// a number, and the only honest way to find the number for "the wooden chair
// facing left" is to look at a picture of the sheet with coordinates written on
// it — which is why art/digits.ts, a 3x5 font that can draw nothing but
// numbers, exists.
//
// Counting rows by hand in a 122-row sheet is how you end up with a chair where
// a door should be, and the map still validates, because a valid gid is a valid
// gid.
//
// Output is gitignored along with everything else pack-derived.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Sheet = { key: string; file: string; columns: number; rows: number };
const manifest = JSON.parse(
  readFileSync(resolve(root, 'generated', 'manifest.json'), 'utf8'),
) as { source?: string; tilesets?: Sheet[] };
if (manifest.source !== 'limezu') {
  throw new Error('sheet previews need the licensed pack built — run: pnpm assets:build');
}

const argv = process.argv.slice(2);
const scaleFlag = argv.indexOf('--scale');
const scale = scaleFlag === -1 ? 2 : Math.max(1, Number(argv[scaleFlag + 1] ?? 2));
const args = scaleFlag === -1 ? argv : argv.slice(0, scaleFlag);

const key = args[0];
const sheet = manifest.tilesets?.find((s) => s.key === key);
if (!sheet) {
  console.error(`unknown sheet '${key ?? ''}'`);
  console.error(`  have: ${(manifest.tilesets ?? []).map((s) => s.key).join(', ')}`);
  process.exit(1);
}

const col0 = Number(args[1] ?? 0);
const row0 = Number(args[2] ?? 0);
const cols = Math.min(Number(args[3] ?? sheet.columns), sheet.columns - col0);
const rows = Math.min(Number(args[4] ?? sheet.rows), sheet.rows - row0);
if (cols <= 0 || rows <= 0) {
  console.error(`region ${col0},${row0} +${cols}x${rows} is empty or outside the sheet`);
  process.exit(1);
}

const TILE = 32;
const pixels = decodePng(readFileSync(resolve(root, 'generated', sheet.file)));

const cell = TILE * scale;
const canvas = new Canvas(cols * cell, rows * cell);

// The usual alpha checkerboard, and not for decoration. A flat backdrop can
// only reveal alpha in one direction: on dark, the floor-shadow sheet — which
// is nothing but low-alpha black — is completely invisible, and on light the
// wall caps disappear instead. Two tones show both.
const CHECKER = [rgb('#4a5058'), rgb('#3a3f47')] as const;
const GRID = rgb('#6d7580');
const LABEL = rgb('#ffd479');
const LABEL_SHADOW = rgb('#000000');

for (let y = 0; y < canvas.height; y++) {
  for (let x = 0; x < canvas.width; x++) {
    const square = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
    canvas.set(x, y, CHECKER[square]!);
  }
}

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const px = pixels.get(
          (col0 + c) * TILE + Math.floor(x / scale),
          (row0 + r) * TILE + Math.floor(y / scale),
        );
        if (px[3] > 0) canvas.set(c * cell + x, r * cell + y, px);
      }
    }
    // Grid lines on the top and left edge of every cell, so a 2x2 object is
    // visibly four tiles rather than one picture.
    for (let x = 0; x < cell; x++) canvas.set(c * cell + x, r * cell, GRID);
    for (let y = 0; y < cell; y++) canvas.set(c * cell, r * cell + y, GRID);

    const label = `${col0 + c},${row0 + r}`;
    drawText(canvas, label, c * cell + 3, r * cell + 3, LABEL_SHADOW);
    drawText(canvas, label, c * cell + 2, r * cell + 2, LABEL);
  }
}

const outDir = resolve(root, 'generated', 'preview');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `sheet-${key}-${col0}-${row0}.png`);
writeFileSync(out, encodePng(canvas.width, canvas.height, canvas.data));

console.log(`${key}: ${cols}x${rows} tiles from (${col0},${row0}) @${scale}x → ${out}`);
console.log(`  sheet is ${sheet.columns}x${sheet.rows} tiles`);
