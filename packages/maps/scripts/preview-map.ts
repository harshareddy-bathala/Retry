import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../art/png.js';
import { renderMap } from '../art/render-map.js';

// Renders one map to PNG exactly as the game layers it.
//
//   npx tsx scripts/preview-map.ts <name> <out.png> [scale]

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const [name, out, scaleArg] = process.argv.slice(2);
if (!name || !out) {
  console.error('usage: preview-map.ts <mapname> <out.png> [scale]');
  process.exit(1);
}
const scale = Math.max(1, Number(scaleArg ?? 1));

const { canvas, width, height } = renderMap(root, name, scale);
writeFileSync(out, encodePng(canvas.width, canvas.height, canvas.data));
console.log(`${name}: ${width}x${height} → ${out} @${scale}x`);
