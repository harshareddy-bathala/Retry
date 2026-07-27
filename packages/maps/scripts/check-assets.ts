import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_DIR } from '../assets.config.js';

// Fast pre-flight for anything that needs real art: exits 0 only when the
// generated output was built from the licensed pack. Run it before a browser
// drive, or wire it ahead of dev servers, to fail early instead of staring at
// a world that refuses to boot.
//
//   pnpm --filter @retry/maps assets:check

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(resolve(here, '..'), OUT_DIR, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('art: no generated/manifest.json — run: pnpm --filter @retry/maps assets:build');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { source?: string };
if (manifest.source !== 'limezu') {
  console.error(`art: generated from '${manifest.source ?? 'unknown'}', not the licensed pack.`);
  console.error('     Follow docs/assets-setup.md, then re-run: pnpm --filter @retry/maps assets:build');
  process.exit(1);
}

console.log('art: licensed pack present and built');
