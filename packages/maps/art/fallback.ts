import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Canvas, mix, rgb, rng, type RGBA } from './canvas.js';
import { encodePng } from './png.js';

// Placeholder art, drawn by us, licence-free.
//
// It exists for exactly one reason: the licensed pack is gitignored, so a fresh
// clone and CI have no art at all, and `pnpm build` would fail on unresolved
// image imports before anyone could run a test. This keeps the repo buildable
// and gives a new contributor a walkable world before they have bought
// anything. It is not meant to be good, and the app says so at boot.
//
// Geometry matches the real pack exactly — same tile size, same character frame,
// same sheet grid — so nothing downstream can accidentally depend on the
// placeholder's shape.

type Geometry = {
  tile: number;
  charFrame: { width: number; height: number };
  sheet: { columns: number; rows: number };
};

const FLOOR = rgb('#9c7553');
const WALL = rgb('#7a8d83');
const WALL_TOP = rgb('#404e48');
const PROP = rgb('#b48457');
const SKIN = rgb('#c98d63');
const CLOTH = rgb('#c9622f');

/** A flat tile with a 1px inner edge, so a grid of them is legible. */
function flatTile(c: Canvas, x: number, y: number, tile: number, base: RGBA, seed: number): void {
  c.rect(x, y, tile, tile, base);
  c.speckle(x, y, tile, tile, mix(base, rgb('#000000'), 0.12), 0.05, seed);
  c.hline(x, y, tile, mix(base, rgb('#ffffff'), 0.14));
  c.hline(x, y + tile - 1, tile, mix(base, rgb('#000000'), 0.18));
}

function buildTileset(tile: number): Canvas {
  // Four tiles, in the order the placeholder maps reference them.
  const c = new Canvas(tile * 4, tile);
  flatTile(c, 0, 0, tile, FLOOR, 11);
  flatTile(c, tile, 0, tile, WALL_TOP, 22);
  flatTile(c, tile * 2, 0, tile, WALL, 33);
  // A prop, so furniture and floor are distinguishable while walking around.
  flatTile(c, tile * 3, 0, tile, FLOOR, 44);
  c.rect(tile * 3 + 5, 8, tile - 10, tile - 14, PROP);
  c.bevel(tile * 3 + 5, 8, tile - 10, tile - 14, mix(PROP, rgb('#ffffff'), 0.3), mix(PROP, rgb('#000000'), 0.3));
  return c;
}

/**
 * One character layer sheet at the pack's real grid. Only the idle and walk
 * rows carry anything; the rest stay transparent, which is also a useful signal
 * that this is not the real art.
 */
function buildCharacterSheet(geo: Geometry, tint: RGBA, isBody: boolean): Canvas {
  const { width: fw, height: fh } = geo.charFrame;
  const c = new Canvas(geo.sheet.columns * fw, geo.sheet.rows * fh);
  const r = rng(7);
  // Rows 1 and 2 are idle and walk in the real pack; match that so the
  // animation config does not have to special-case the placeholder.
  for (const row of [1, 2]) {
    for (let col = 0; col < 24; col++) {
      const ox = col * fw;
      const oy = row * fh;
      const bob = row === 2 && col % 2 === 1 ? 1 : 0;
      if (isBody) {
        // Head and legs.
        c.rect(ox + 11, oy + 30 + bob, 10, 10, tint);
        c.rect(ox + 12, oy + 50, 3, 6, mix(tint, rgb('#000000'), 0.45));
        c.rect(ox + 17, oy + 50, 3, 6, mix(tint, rgb('#000000'), 0.45));
      } else {
        // Torso, for the "outfit" layer.
        c.rect(ox + 11, oy + 40, 10, 11, tint);
        c.rect(ox + 11, oy + 40, 10, 1, mix(tint, rgb('#ffffff'), 0.25));
      }
      if (r() < 0) c.set(ox, oy, tint); // keeps rng referenced deterministically
    }
  }
  return c;
}

export function buildFallback(
  outRoot: string,
  geo: Geometry,
): {
  source: 'placeholder';
  generatedAt: string;
  tile: number;
  charFrame: { width: number; height: number };
  tilesets: Array<{ key: string; file: string; width: number; height: number; columns: number; rows: number }>;
  characters: Record<string, string[]>;
} {
  const tilesetDir = join(outRoot, 'tilesets');
  mkdirSync(tilesetDir, { recursive: true });
  const sheet = buildTileset(geo.tile);
  writeFileSync(join(tilesetDir, 'placeholder.png'), encodePng(sheet.width, sheet.height, sheet.data));

  const characters: Record<string, string[]> = {};
  for (const [layer, tint, isBody] of [
    ['body', SKIN, true],
    ['eyes', rgb('#2b2f36'), false],
    ['outfit', CLOTH, false],
    ['hair', rgb('#2f2318'), false],
    ['accessory', rgb('#4f8f95'), false],
  ] as const) {
    const dir = join(outRoot, 'characters', layer);
    mkdirSync(dir, { recursive: true });
    // One variant per layer: enough to render, obviously not a choice.
    const canvas = buildCharacterSheet(geo, tint, isBody);
    const name = `placeholder_${layer}_01.png`;
    writeFileSync(join(dir, name), encodePng(canvas.width, canvas.height, canvas.data));
    characters[layer] = [name];
  }

  return {
    source: 'placeholder',
    generatedAt: new Date().toISOString(),
    tile: geo.tile,
    charFrame: geo.charFrame,
    tilesets: [
      {
        key: 'placeholder',
        file: 'tilesets/placeholder.png',
        width: sheet.width,
        height: sheet.height,
        columns: 4,
        rows: 1,
      },
    ],
    characters,
  };
}
