import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATARS, renderAvatar } from '../art/avatars.js';
import { encodePng } from '../art/png.js';
import { renderTileset, TILE_NAMES } from '../art/tiles.js';

// Regenerates the world's art. The PNGs are committed — they are assets, not
// build output — and this script is how they were made, so a change to the art
// direction is a code review rather than a binary blob nobody can diff.
//
//   pnpm --filter @retry/maps art

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function write(relative: string, bytes: Buffer): void {
  const path = resolve(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(`  ${relative}  ${(bytes.length / 1024).toFixed(1)} kB`);
}

console.log('rendering tileset…');
const { canvas, columns, rows } = renderTileset();
write('tilesets/retry.png', encodePng(canvas.width, canvas.height, canvas.data));
console.log(`  ${TILE_NAMES.length} tiles, ${columns}x${rows} grid`);

console.log('rendering avatars…');
for (const spec of AVATARS) {
  const sheet = renderAvatar(spec);
  write(`avatars/${spec.key}.png`, encodePng(sheet.width, sheet.height, sheet.data));
}
