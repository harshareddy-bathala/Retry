import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../art/png.js';
import { renderMap } from '../art/render-map.js';

// Renders every committed map to generated/preview/<name>.png.
//
//   pnpm --filter @retry/maps preview:all [scale]
//
// This is the authoring loop: edit → validate → preview:all → LOOK at the PNGs.
// Output is gitignored along with the rest of generated/.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'generated', 'preview');
const scale = Math.max(1, Number(process.argv[2] ?? 1));

mkdirSync(outDir, { recursive: true });

const names = readdirSync(resolve(root, 'maps'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

let failed = 0;
for (const name of names) {
  try {
    const { canvas, width, height } = renderMap(root, name, scale);
    const out = resolve(outDir, `${name}.png`);
    writeFileSync(out, encodePng(canvas.width, canvas.height, canvas.data));
    console.log(`  ${name.padEnd(12)} ${width}x${height} → ${out}`);
  } catch (err) {
    // One unrenderable map must not hide the other four.
    failed += 1;
    console.error(`  ${name.padEnd(12)} FAILED: ${(err as Error).message}`);
  }
}

console.log(`\n${names.length - failed}/${names.length} rendered @${scale}x into ${outDir}`);
if (failed > 0) process.exit(1);
