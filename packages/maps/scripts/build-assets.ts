import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHARACTER_LAYERS,
  CHAR_FRAME,
  CHAR_SHEET,
  FORBIDDEN_DIRS,
  OUT_DIR,
  PACK_DIR,
  PACK_LICENCE_MARKER,
  TILE,
  TILESETS,
} from '../assets.config.js';
import { buildFallback } from '../art/fallback.js';

// Turns the licensed art pack into the files the app imports.
//
//   pnpm assets:build
//
// The pack is gitignored (its licence forbids redistribution), so this runs on
// every machine that builds the app. When the pack is absent — a fresh clone, or
// CI — it emits a small placeholder set instead, drawn by us and licence-free, so
// `pnpm build` still works and a new contributor sees a running app before they
// have bought anything.

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '..', '..');
const outRoot = join(pkgRoot, OUT_DIR);

/** Width and height straight out of the PNG IHDR — no decode needed. */
function pngSize(path: string): { width: number; height: number } {
  const head = Buffer.alloc(24);
  const fd = readFileSync(path);
  fd.copy(head, 0, 0, 24);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

type ManifestSheet = {
  key: string;
  file: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  note?: string;
};

type Manifest = {
  source: 'limezu' | 'placeholder';
  generatedAt: string;
  tile: number;
  charFrame: { width: number; height: number };
  tilesets: ManifestSheet[];
  characters: Record<string, string[]>;
  coverage?: { used: number; available: number };
};

function copyInto(from: string, toDir: string): string {
  mkdirSync(toDir, { recursive: true });
  const name = basename(from);
  copyFileSync(from, join(toDir, name));
  return name;
}

function buildFromPack(packRoot: string): Manifest {
  // Guard: the free download sits beside the paid one and is licensed for
  // NON-COMMERCIAL use only. Reading from it would put art we are not allowed
  // to ship into a product for 5,000 students.
  for (const forbidden of FORBIDDEN_DIRS) {
    if (packRoot.replace(/\\/g, '/').includes(forbidden)) {
      throw new Error(`refusing to build from ${forbidden}: that is the non-commercial free version`);
    }
  }
  const licence = join(packRoot, 'LICENSE.txt');
  if (!existsSync(licence) || !readFileSync(licence, 'utf8').includes(PACK_LICENCE_MARKER)) {
    throw new Error(
      `${packRoot} does not look like the full Modern Interiors pack ` +
        `(no LICENSE.txt containing "${PACK_LICENCE_MARKER}"). See docs/assets-setup.md.`,
    );
  }

  const tilesets: ManifestSheet[] = [];
  for (const sheet of TILESETS) {
    const from = join(packRoot, sheet.file);
    if (!existsSync(from)) throw new Error(`missing from the pack: ${sheet.file}`);
    const { width, height } = pngSize(from);
    // A sheet taller than this cannot be uploaded as one WebGL texture on a lot
    // of hardware — the pack's master strip is 34,048px and would fail silently
    // on some machines and loudly on others.
    if (height > 16_384 || width > 16_384) {
      throw new Error(`${sheet.file} is ${width}x${height}; over the 16,384px texture limit`);
    }
    copyInto(from, join(outRoot, 'tilesets'));
    tilesets.push({
      key: sheet.key,
      file: `tilesets/${basename(sheet.file)}`,
      width,
      height,
      columns: Math.floor(width / TILE),
      rows: Math.floor(height / TILE),
      note: sheet.note,
    });
  }

  const characters: Record<string, string[]> = {};
  for (const layer of CHARACTER_LAYERS) {
    const dir = join(packRoot, layer.dir);
    if (!existsSync(dir)) throw new Error(`missing from the pack: ${layer.dir}`);
    const all = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .sort();
    const take = layer.take === 'all' ? all : all.slice(0, layer.take);
    characters[layer.key] = take.map((f) => {
      copyInto(join(dir, f), join(outRoot, 'characters', layer.key));
      return f;
    });
  }

  // Coverage against the whole pack, so "use the assets we paid for" is a
  // number someone can look at rather than a good intention.
  const available = countPngs(join(packRoot, '1_Interiors', '32x32', 'Theme_Sorter_Singles_32x32'));
  const used = tilesets.length + Object.values(characters).reduce((n, l) => n + l.length, 0);

  return {
    source: 'limezu',
    generatedAt: new Date().toISOString(),
    tile: TILE,
    charFrame: CHAR_FRAME,
    tilesets,
    characters,
    coverage: { used, available },
  };
}

function countPngs(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) n += countPngs(path);
    else if (entry.toLowerCase().endsWith('.png')) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------

const packRoot = resolve(repoRoot, PACK_DIR);
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

let manifest: Manifest;
if (existsSync(packRoot)) {
  manifest = buildFromPack(packRoot);
  console.log(`art: LimeZu Modern Interiors`);
  console.log(`  ${manifest.tilesets.length} tilesets`);
  for (const [layer, files] of Object.entries(manifest.characters)) {
    console.log(`  ${files.length} ${layer}`);
  }
  console.log(
    `  coverage: ${manifest.coverage?.used} sheets in use, ${manifest.coverage?.available} single objects available to draw on`,
  );
} else {
  manifest = buildFallback(outRoot, { tile: TILE, charFrame: CHAR_FRAME, sheet: CHAR_SHEET });
  console.warn(`art: PLACEHOLDER — no pack at ${PACK_DIR}`);
  console.warn(`     The world will look like programmer art until you follow docs/assets-setup.md.`);
}

writeFileSync(join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// A typed entry point for the bundler. Sheet filenames come from a third-party
// pack, so the app imports by OUR key and never by their name — and when the
// pack is absent the same module resolves to the placeholder.
const importLines = manifest.tilesets.map((s, i) => `import sheet${i} from './${s.file}';`);
const entryLines = manifest.tilesets.map((s, i) => `  '${s.key}': sheet${i},`);
writeFileSync(
  join(outRoot, 'tilesets.ts'),
  [
    '// GENERATED by scripts/build-assets.ts — do not edit, do not commit.',
    ...importLines,
    '',
    'export const TILESET_URLS: Record<string, string> = {',
    ...entryLines,
    '};',
    '',
    'export const TILESET_KEYS = Object.keys(TILESET_URLS);',
    '',
  ].join('\n'),
);

console.log(`  → packages/maps/${OUT_DIR}/`);
