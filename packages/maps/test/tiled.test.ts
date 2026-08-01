import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addObject,
  addTileset,
  block,
  clear,
  fillRect,
  getTile,
  gidFor,
  loadMap,
  resize,
  setTile,
  solid,
  stamp,
  tileLayer,
  TILE,
  type AuthoredMap,
} from '../src/tiled.js';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_NAMES = ['studio_a', 'classroom', 'lounge', 'conference', 'commons'];

// The round-trip tests read the REAL maps on purpose — that is the property.
// Everything below them must not, because a test that asserts studio_a is 20
// tiles wide fails the day somebody makes the room bigger, which is not a bug
// and is exactly the edit this module exists to make easy. So the mutation
// tests derive their expectations from whatever the map currently is.

// Anything that resolves a gid needs the licensed pack's manifest. CI builds
// without it, so those tests announce themselves as skipped rather than
// silently passing on a file that was never read.
const hasPack = (() => {
  const path = resolve(PKG_ROOT, 'generated', 'manifest.json');
  if (!existsSync(path)) return false;
  return (JSON.parse(readFileSync(path, 'utf8')) as { source?: string }).source === 'limezu';
})();
const withPack = hasPack ? it : it.skip;

function raw(name: string): string {
  return readFileSync(resolve(PKG_ROOT, 'maps', `${name}.json`), 'utf8');
}

/** `save` without the write — the property under test is the serialisation. */
function serialize(map: AuthoredMap): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v === null || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sort((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return `${JSON.stringify(sort(map), null, 2)}\n`;
}

describe('round trip', () => {
  // The load/save pair is the foundation everything else stands on. If reading
  // a map and writing it straight back is not a no-op, then every authoring
  // commit carries invisible collateral damage and no map diff can be trusted.
  it.each(MAP_NAMES)('%s survives load → save byte-for-byte', (name) => {
    expect(serialize(loadMap(name))).toBe(raw(name));
  });

  it('preserves fields the validator does not know about', () => {
    // validate.ts's zod schema drops `nextobjectid`, `renderorder`, `infinite`
    // and more. Parsing through it here would produce a file Tiled cannot
    // reopen — hence the separate structural type.
    const map = loadMap('studio_a');
    expect(map.nextobjectid).toBeGreaterThan(0);
    expect(map.nextlayerid).toBeGreaterThan(0);
    expect(map.renderorder).toBe('right-down');
    expect(map.infinite).toBe(false);
  });
});

describe('tile writes', () => {
  it('throws rather than clipping out of bounds', () => {
    const map = loadMap('studio_a');
    expect(() => setTile(map, 'ground', map.width, 0, 1)).toThrow(/outside/);
    expect(() => setTile(map, 'ground', 0, -1, 1)).toThrow(/outside/);
    expect(() => setTile(map, 'ground', 0, map.height, 1)).toThrow(/outside/);
  });

  it('fillRect with a function can skip tiles', () => {
    const map = loadMap('studio_a');
    clear(map, 'objects');
    fillRect(map, 'objects', 0, 0, 4, 1, (_x, _y, dx) => (dx % 2 === 0 ? 5 : undefined));
    expect([0, 1, 2, 3].map((x) => getTile(map, 'objects', x, 0))).toEqual([5, 0, 5, 0]);
  });

  it('stamp writes different shapes to different layers', () => {
    const map = loadMap('studio_a');
    clear(map, 'objects');
    clear(map, 'objects_above');
    clear(map, 'collision');
    stamp(map, 2, 2, {
      objects: [[10, 11]],
      objects_above: [[20, 21]],
      collision: [[30, null]],
    });
    expect(getTile(map, 'objects', 3, 2)).toBe(11);
    expect(getTile(map, 'objects_above', 2, 2)).toBe(20);
    expect(getTile(map, 'collision', 2, 2)).toBe(30);
    // A null cell leaves what was there, so a stamp can be L-shaped.
    expect(getTile(map, 'collision', 3, 2)).toBe(0);
  });

  it('solid marks a rectangle with a gid the map declares', () => {
    const map = loadMap('studio_a');
    clear(map, 'collision');
    solid(map, 1, 1, 2, 2);
    const gid = getTile(map, 'collision', 1, 1);
    expect(gid).toBeGreaterThan(0);
    const owns = map.tilesets.some((t) => gid >= t.firstgid && gid < t.firstgid + t.tilecount);
    expect(owns).toBe(true);
  });
});

describe('objects', () => {
  it('converts tile coordinates to pixels', () => {
    const map = loadMap('studio_a');
    const obj = addObject(map, 'spawns', { name: 'test', x: 3, y: 4, point: true });
    expect(obj.x).toBe(3 * TILE);
    expect(obj.y).toBe(4 * TILE);
  });

  it('assigns unique ids from nextobjectid', () => {
    const map = loadMap('studio_a');
    const a = addObject(map, 'spawns', { name: 'a', x: 1, y: 1, point: true });
    const b = addObject(map, 'spawns', { name: 'b', x: 2, y: 1, point: true });
    expect(b.id).toBe(a.id + 1);
    expect(map.nextobjectid).toBe(b.id + 1);
  });

  it('creates a missing object layer on demand', () => {
    const map = loadMap('studio_a');
    map.layers = map.layers.filter((l) => l.name !== 'zones');
    addObject(map, 'zones', { name: 'quiet corner', x: 1, y: 1, w: 3, h: 3 });
    const zones = map.layers.find((l) => l.name === 'zones');
    expect(zones?.type).toBe('objectgroup');
  });

  it('rejects an object that spans past the map edge', () => {
    const map = loadMap('studio_a');
    expect(() =>
      addObject(map, 'zones', { name: 'too wide', x: map.width - 1, y: 1, w: 4, h: 1 }),
    ).toThrow(/past the/);
  });
});

describe('resize', () => {
  it('keeps content at the same tile coordinates when growing', () => {
    const map = loadMap('studio_a');
    const before = getTile(map, 'ground', 5, 5);
    const w = map.width + 4;
    const h = map.height + 3;
    resize(map, w, h);
    expect(map.width).toBe(w);
    expect(map.height).toBe(h);
    expect(getTile(map, 'ground', 5, 5)).toBe(before);
    expect(getTile(map, 'ground', w - 1, h - 1)).toBe(0);
    expect(tileLayer(map, 'ground').data).toHaveLength(w * h);
  });

  it('shifts objects with the tiles', () => {
    const map = loadMap('studio_a');
    const spawn = map.layers.find((l) => l.name === 'spawns');
    if (spawn?.type !== 'objectgroup') throw new Error('no spawns layer');
    const before = spawn.objects[0]?.x ?? 0;
    resize(map, map.width + 4, map.height + 4, 2, 2);
    expect(spawn.objects[0]?.x).toBe(before + 2 * TILE);
  });

  it('refuses to crop rather than losing tiles silently', () => {
    const map = loadMap('studio_a');
    expect(() => resize(map, 8, 8)).toThrow(/would crop/);
  });

  it('resizes every tile layer, so tileLayer() stays consistent', () => {
    const map = loadMap('studio_a');
    const w = map.width + 2;
    const h = map.height + 2;
    resize(map, w, h);
    for (const name of ['ground', 'ground_overlay', 'objects', 'objects_above', 'collision'] as const) {
      expect(tileLayer(map, name).data).toHaveLength(w * h);
    }
  });
});

describe('tilesets', () => {
  // A sheet no room draws from, so these stay true however the rooms change.
  const SPARE = 'tvstudio';

  withPack('appends above every existing range and never renumbers', () => {
    const map = loadMap('studio_a');
    const before = map.tilesets.map((t) => ({ name: t.name, firstgid: t.firstgid }));
    const added = addTileset(map, SPARE);
    const top = Math.max(...before.map((t) => t.firstgid));
    expect(added.firstgid).toBeGreaterThan(top);
    for (const t of before) {
      expect(map.tilesets.find((x) => x.name === t.name)?.firstgid).toBe(t.firstgid);
    }
  });

  withPack('is idempotent', () => {
    const map = loadMap('studio_a');
    const a = addTileset(map, SPARE);
    const count = map.tilesets.length;
    const b = addTileset(map, SPARE);
    expect(b.firstgid).toBe(a.firstgid);
    expect(map.tilesets).toHaveLength(count);
  });

  withPack('resolves gids by column and row, not linear index', () => {
    const map = loadMap('studio_a');
    const ref = addTileset(map, SPARE);
    // tvstudio is 16 columns; (2,1) must be a full row past (2,0).
    expect(gidFor(map, SPARE, 2, 0)).toBe(ref.firstgid + 2);
    expect(gidFor(map, SPARE, 2, 1)).toBe(ref.firstgid + 16 + 2);
  });

  withPack('rejects a tile outside the sheet', () => {
    const map = loadMap('studio_a');
    expect(() => gidFor(map, SPARE, 99, 0)).toThrow(/outside the sheet/);
    expect(() => gidFor(map, SPARE, 0, 999)).toThrow(/outside the sheet/);
  });

  withPack('block lifts a rectangle in reading order', () => {
    const map = loadMap('studio_a');
    const grid = block(map, SPARE, 1, 1, 2, 2);
    expect(grid).toHaveLength(2);
    expect(grid[0]).toEqual([gidFor(map, SPARE, 1, 1), gidFor(map, SPARE, 2, 1)]);
    expect(grid[1]).toEqual([gidFor(map, SPARE, 1, 2), gidFor(map, SPARE, 2, 2)]);
  });

  it('names an unknown tileset instead of failing on undefined', () => {
    const map = loadMap('studio_a');
    const call = (): unknown => addTileset(map, 'not_a_sheet');
    // Without the pack this throws the "needs the built art pack" message;
    // with it, the "unknown tileset" one. Either is an actionable sentence,
    // which is the actual contract.
    expect(call).toThrow(/unknown tileset|art pack|licensed pack/);
  });
});
