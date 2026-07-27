import { readFileSync, writeFileSync } from 'node:fs';
import { Canvas } from '../art/canvas.js';
import { decodePng } from '../art/png-decode.js';
import { encodePng } from '../art/png.js';
import { drawText } from '../art/digits.js';

// Lays a horizontal animation strip out with frame numbers under each cell, so
// "which frame is the door closed on?" is answered by looking.
//
//   npx tsx scripts/preview-strip.ts <in.png> <frameW> <frameH> <out.png> [scale]

const [input, wArg, hArg, out, scaleArg] = process.argv.slice(2);
if (!input || !wArg || !hArg || !out) {
  console.error('usage: preview-strip.ts <in.png> <frameW> <frameH> <out.png> [scale]');
  process.exit(1);
}
const fw = Number(wArg);
const fh = Number(hArg);
const scale = Math.max(1, Number(scaleArg ?? 3));

const src = decodePng(readFileSync(input));
const frames = Math.floor(src.width / fw);
const labelBand = 8;
const canvas = new Canvas(frames * (fw + 2) * scale, (fh + labelBand) * scale);
for (let y = 0; y < canvas.height; y++) {
  for (let x = 0; x < canvas.width; x++) {
    const dark = ((x >> 3) + (y >> 3)) % 2 === 0;
    canvas.set(x, y, dark ? [38, 38, 46, 255] : [50, 50, 60, 255]);
  }
}

for (let f = 0; f < frames; f++) {
  const ox = f * (fw + 2) * scale;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const c = src.get(f * fw + x, y);
      if (c[3] === 0) continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) canvas.set(ox + x * scale + sx, y * scale + sy, c);
      }
    }
  }
  drawText(canvas, `${f}`, ox + 2, fh * scale + 2, [255, 240, 200, 255]);
}

writeFileSync(out, encodePng(canvas.width, canvas.height, canvas.data));
console.log(`${input}: ${src.width}x${src.height} → ${frames} frames of ${fw}x${fh} → ${out}`);
