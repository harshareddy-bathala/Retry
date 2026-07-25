// CLI: validate map JSON files against the Phase 0 map contract.
// Usage:
//   pnpm --filter @retry/maps validate            # all maps in maps/
//   pnpm --filter @retry/maps validate <file...>  # specific files
// Exits 1 with per-file errors if any map is invalid. Run in CI.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMap } from '../src/validate.js';

const mapsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'maps');

const args = process.argv.slice(2);
const files =
  args.length > 0
    ? args.map((a) => resolve(a))
    : readdirSync(mapsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(mapsDir, f));

if (files.length === 0) {
  console.error(`No map JSON files found in ${mapsDir}`);
  process.exit(1);
}

let failed = false;
for (const file of files) {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    failed = true;
    console.error(`✗ ${file}\n    unreadable or invalid JSON: ${String(err)}`);
    continue;
  }
  const result = validateMap(raw);
  if (result.ok) {
    console.log(`✓ ${file}`);
  } else {
    failed = true;
    console.error(`✗ ${file}`);
    for (const e of result.errors) console.error(`    ${e}`);
  }
}

if (failed) {
  console.error('\nMap validation FAILED. Fix the errors above before merging.');
  process.exit(1);
}
console.log(`\n${files.length} map(s) valid.`);
