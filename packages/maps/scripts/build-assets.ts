import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANIMATED_OBJECTS,
  ANIMATION_ROWS,
  CHARACTER_CATALOG,
  CHAR_FRAME,
  DIRECTION_ORDER,
  FORBIDDEN_DIRS,
  LAYER_DIRS,
  LAYER_KEYS,
  OUT_DIR,
  PACK_DIR,
  PACK_LICENCE_MARKER,
  STRIP,
  TILE,
  TILESETS,
  type CatalogEntry,
} from '../assets.config.js';
import { Canvas } from '../art/canvas.js';
import { decodePng } from '../art/png-decode.js';
import { encodePng } from '../art/png.js';

// Turns the licensed art pack into the files the app imports.
//
//   pnpm assets:build
//
// The pack is committed under assets/ (this repository is private; its licence
// forbids redistribution, so see docs/assets-setup.md before making it public)
// and is REQUIRED to run the app — there is no placeholder art. When the pack
// is absent anyway — a checkout with assets/ stripped — this emits typed stubs
// (`source: 'absent'`, empty catalogues) so `pnpm -r build` and the test suites
// still pass; the web app detects the stub at runtime and shows how to get the
// pack instead of a world.

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

/** Raw rectangle copy — no blending, source pixels replace destination. */
function crop(src: Canvas, x: number, y: number, w: number, h: number): Canvas {
  const out = new Canvas(w, h);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * src.width + x) * 4;
    out.data.set(src.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
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

type ManifestAnimation = {
  key: string;
  file: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  loop?: readonly [number, number];
  note: string;
};

type Manifest = {
  source: 'limezu' | 'absent';
  generatedAt: string;
  tile: number;
  charFrame: { width: number; height: number };
  tilesets: ManifestSheet[];
  /** Catalogue ids per layer — what the server validates selections against. */
  characters: Record<string, string[]>;
  animations: ManifestAnimation[];
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

  // Character layers: decode each curated sheet and keep only the animation
  // rows we ship, as one 768x128 strip (idle over walk, 24 frames per row in
  // DIRECTION_ORDER). ~8 kB per choice instead of the ~90 kB source sheet.
  //
  // The crop starts at x=0, so the body sheets' extra 62px of width (they are
  // 1854px to everyone else's 1792) falls away harmlessly on the right — but
  // it is exactly why nothing may ever address these sheets by LINEAR frame
  // index: 57 columns against 56 drifts one frame per row.
  const characters: Record<string, string[]> = {};
  for (const layer of LAYER_KEYS) {
    const dir = join(packRoot, LAYER_DIRS[layer]);
    if (!existsSync(dir)) throw new Error(`missing from the pack: ${LAYER_DIRS[layer]}`);
    const outDir = join(outRoot, 'characters', layer);
    mkdirSync(outDir, { recursive: true });
    characters[layer] = CHARACTER_CATALOG[layer].map((entry) => {
      const from = join(dir, entry.file);
      if (!existsSync(from)) throw new Error(`missing from the pack: ${LAYER_DIRS[layer]}/${entry.file}`);
      const sheet = decodePng(readFileSync(from));
      const strip = new Canvas(STRIP.width, STRIP.height);
      ANIMATION_ROWS.forEach((anim, i) => {
        const row = crop(sheet, 0, anim.sourceRow * CHAR_FRAME.height, STRIP.width, CHAR_FRAME.height);
        strip.data.set(row.data, i * CHAR_FRAME.height * STRIP.width * 4);
      });
      writeFileSync(join(outDir, `${entry.id}.png`), encodePng(STRIP.width, STRIP.height, strip.data));
      return entry.id;
    });
  }

  // Animated objects: copied verbatim like tilesets (they are palette PNGs and
  // the browser decodes them fine), with the frame count derived from the
  // strip's width so the config never has to state it twice.
  const animations: ManifestAnimation[] = [];
  for (const anim of ANIMATED_OBJECTS) {
    const from = join(packRoot, anim.file);
    if (!existsSync(from)) throw new Error(`missing from the pack: ${anim.file}`);
    const { width, height } = pngSize(from);
    if (height !== anim.frameHeight) {
      throw new Error(`${anim.file} is ${height}px tall, config says frameHeight ${anim.frameHeight}`);
    }
    if (width % TILE !== 0) throw new Error(`${anim.file} is ${width}px wide, not a whole number of frames`);
    // Filenames can contain spaces; the copy keeps our key, not their name.
    const name = `${anim.key}.png`;
    mkdirSync(join(outRoot, 'animated'), { recursive: true });
    copyFileSync(from, join(outRoot, 'animated', name));
    animations.push({
      key: anim.key,
      file: `animated/${name}`,
      frameWidth: TILE,
      frameHeight: anim.frameHeight,
      frames: width / TILE,
      ...(anim.loop ? { loop: anim.loop } : {}),
      note: anim.note,
    });
  }

  // Coverage against the whole pack, so "use the assets we paid for" is a
  // number someone can look at rather than a good intention.
  const available = countPngs(join(packRoot, '1_Interiors', '32x32', 'Theme_Sorter_Singles_32x32'));
  const used =
    tilesets.length + animations.length + Object.values(characters).reduce((n, l) => n + l.length, 0);

  return {
    source: 'limezu',
    generatedAt: new Date().toISOString(),
    tile: TILE,
    charFrame: CHAR_FRAME,
    tilesets,
    characters,
    animations,
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
  console.log(`  ${manifest.animations.length} animated objects`);
  for (const [layer, files] of Object.entries(manifest.characters)) {
    console.log(`  ${files.length} ${layer}`);
  }
  console.log(
    `  coverage: ${manifest.coverage?.used} sheets in use, ${manifest.coverage?.available} single objects available to draw on`,
  );
} else {
  // No placeholder art (deliberate — the world is the pack). Typed stubs keep
  // every import resolvable so CI and pack-less clones can still build and
  // test; the web app reads `source` and explains instead of rendering.
  manifest = {
    source: 'absent',
    generatedAt: new Date().toISOString(),
    tile: TILE,
    charFrame: CHAR_FRAME,
    tilesets: [],
    characters: Object.fromEntries(LAYER_KEYS.map((k) => [k, []])),
    animations: [],
  };
  console.warn(`art: ABSENT — no pack at ${PACK_DIR}`);
  console.warn(`     The build stays green but the world cannot render.`);
  console.warn(`     Follow docs/assets-setup.md, then re-run: pnpm --filter @retry/maps assets:build`);
}

writeFileSync(join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Typed entry points for the bundler. Sheet filenames come from a third-party
// pack, so the app imports by OUR key and never by their name — and when the
// pack is absent the same modules resolve to empty catalogues.
const importLines = manifest.tilesets.map((s, i) => `import sheet${i} from './${s.file}';`);
const entryLines = manifest.tilesets.map((s, i) => `  '${s.key}': sheet${i},`);
writeFileSync(
  join(outRoot, 'tilesets.ts'),
  [
    '// GENERATED by scripts/build-assets.ts — do not edit, do not commit.',
    "export type ArtSource = 'limezu' | 'absent';",
    `export const ART_SOURCE: ArtSource = '${manifest.source}';`,
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

// Character catalogue barrel: per layer, the curated entries with their labels
// and bundled strip URLs, plus the strip geometry the renderer needs. All of it
// literal data so the module is self-contained and tree-shakeable.
const charImports: string[] = [];
const charEntries: string[] = [];
let charIdx = 0;
for (const layer of LAYER_KEYS) {
  const ids = new Set(manifest.characters[layer] ?? []);
  const entries = CHARACTER_CATALOG[layer].filter((e: CatalogEntry) => ids.has(e.id));
  const lines = entries.map((e: CatalogEntry) => {
    const varName = `strip${charIdx++}`;
    charImports.push(`import ${varName} from './characters/${layer}/${e.id}.png';`);
    return `    { id: '${e.id}', label: ${JSON.stringify(e.label)}, url: ${varName} },`;
  });
  charEntries.push(`  ${layer}: [`, ...lines, `  ],`);
}
const geometry = {
  frameWidth: CHAR_FRAME.width,
  frameHeight: CHAR_FRAME.height,
  columns: STRIP.columns,
  directions: DIRECTION_ORDER,
  framesPerDirection: ANIMATION_ROWS[0].frames,
  animations: ANIMATION_ROWS.map((a, i) => ({ key: a.key, row: i, frames: a.frames, frameRate: a.frameRate })),
};
writeFileSync(
  join(outRoot, 'characters.ts'),
  [
    '// GENERATED by scripts/build-assets.ts — do not edit, do not commit.',
    "export type ArtSource = 'limezu' | 'absent';",
    `export const ART_SOURCE: ArtSource = '${manifest.source}';`,
    ...charImports,
    '',
    "export type CharacterLayerKey = 'body' | 'eyes' | 'outfit' | 'hair' | 'accessory';",
    'export type CharacterChoice = { id: string; label: string; url: string };',
    '',
    'export const CHARACTER_LAYERS: Record<CharacterLayerKey, CharacterChoice[]> = {',
    ...charEntries,
    '};',
    '',
    `export const CHARACTER_GEOMETRY = ${JSON.stringify(geometry, null, 2)} as const;`,
    '',
  ].join('\n'),
);

// Animated objects: URL + frame geometry per key, so the renderer can register
// a spritesheet and its loop without knowing a filename or a frame count.
const animImports = manifest.animations.map((a, i) => `import anim${i} from './${a.file}';`);
const animEntries = manifest.animations.map(
  (a, i) =>
    `  ${a.key}: { url: anim${i}, frameWidth: ${a.frameWidth}, frameHeight: ${a.frameHeight}, frames: ${a.frames}` +
    `${a.loop ? `, loop: [${a.loop[0]}, ${a.loop[1]}] as const` : ''} },`,
);
writeFileSync(
  join(outRoot, 'animated.ts'),
  [
    '// GENERATED by scripts/build-assets.ts — do not edit, do not commit.',
    ...animImports,
    '',
    'export type AnimatedSheet = {',
    '  url: string;',
    '  frameWidth: number;',
    '  frameHeight: number;',
    '  frames: number;',
    '  loop?: readonly [number, number];',
    '};',
    '',
    'export const ANIMATED: Record<string, AnimatedSheet> = {',
    ...animEntries,
    '};',
    '',
  ].join('\n'),
);

console.log(`  → packages/maps/${OUT_DIR}/`);
