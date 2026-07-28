import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateMap } from '../src/validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const studioA = join(pkgRoot, 'maps', 'studio_a.json');
const broken = join(here, 'fixtures', 'studio_a_broken.json');

const loadJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

describe('validateMap', () => {
  it('passes studio_a', () => {
    const result = validateMap(loadJson(studioA));
    expect(result).toEqual({ ok: true, map: expect.anything(), warnings: [] });
  });

  it('fails the deliberately broken copy, naming each problem', () => {
    const result = validateMap(loadJson(broken));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("missing required tile layer 'collision'");
      expect(result.errors.some((e) => e.includes("no point object named 'default'"))).toBe(true);
    }
  });

  it('fails on a non-map payload', () => {
    expect(validateMap({ hello: 'world' }).ok).toBe(false);
    expect(validateMap(null).ok).toBe(false);
  });

  it('fails when a required layer has the wrong tile count', () => {
    const map = loadJson(studioA) as { layers: Array<{ name: string; data?: number[] }> };
    const ground = map.layers.find((l) => l.name === 'ground');
    ground?.data?.pop();
    const result = validateMap(map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("tile layer 'ground'"))).toBe(true);
    }
  });

  // Once maps are authored by a human in Tiled, a gid pointing outside every
  // declared tileset is the likeliest way to break the world silently.
  it('fails when a gid falls outside every declared tileset', () => {
    const map = loadJson(studioA) as {
      tilesets: Array<{ firstgid: number; tilecount: number }>;
      layers: Array<{ name: string; data?: number[] }>;
    };
    const maxGid = Math.max(...map.tilesets.map((t) => t.firstgid + t.tilecount - 1));
    const ground = map.layers.find((l) => l.name === 'ground');
    ground!.data![0] = maxGid + 1;
    const result = validateMap(map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes(`gid ${maxGid + 1}`))).toBe(true);
    }
  });

  it('ignores Tiled flip flags when range-checking gids', () => {
    const map = loadJson(studioA) as { layers: Array<{ name: string; data?: number[] }> };
    const ground = map.layers.find((l) => l.name === 'ground');
    // Horizontal-flip bit on an otherwise valid gid must still validate.
    ground!.data![0] = (ground!.data![0]! | 0x80000000) >>> 0;
    expect(validateMap(map).ok).toBe(true);
  });

  it('fails an interactable with an unknown kind, and a door without a slot', () => {
    const map = loadJson(studioA) as {
      layers: Array<{
        type: string;
        name: string;
        objects?: Array<{
          name: string;
          x?: number;
          y?: number;
          properties?: Array<{ name: string; value: unknown }>;
        }>;
      }>;
    };
    const layer = map.layers.find((l) => l.name === 'interactables');
    layer!.objects!.push(
      { name: 'bad_kind', x: 0, y: 0, properties: [{ name: 'interactive', value: 'teleporter' }] },
      { name: 'bad_door', x: 0, y: 0, properties: [{ name: 'interactive', value: 'door' }] },
    );
    const result = validateMap(map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("'bad_kind'") && e.includes('teleporter'))).toBe(
        true,
      );
      expect(result.errors.some((e) => e.includes("'bad_door'") && e.includes('door_slot'))).toBe(
        true,
      );
    }
  });

  // A props object whose name is not a known animation renders as nothing at
  // all — the quietest possible failure, so the validator has to be loud.
  it('fails a props object naming an unknown animation, when keys are supplied', () => {
    const map = loadJson(studioA) as {
      layers: Array<{ type: string; name: string; objects?: Array<{ name: string; x: number; y: number }> }>;
    };
    const props = map.layers.find((l) => l.name === 'props');
    expect(props, 'studio_a should carry a props layer').toBeDefined();
    props!.objects!.push({ name: 'not_an_animation', x: 0, y: 0 });

    // Without the key list the check is skipped (the room server never draws).
    expect(validateMap(map).ok).toBe(true);

    const result = validateMap(map, { animationKeys: ['server', 'sprout'] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("'not_an_animation'"))).toBe(true);
    }
  });

  it('accepts the shipped props against the built animation keys', () => {
    const map = loadJson(studioA);
    expect(validateMap(map, { animationKeys: ['server', 'sprout', 'cat'] }).ok).toBe(true);
  });

  // A pack-less build emits an EMPTY animation list. Passing that through as
  // an allow-list failed every prop in every map — green locally, red in CI.
  it('an empty animation list means "unknown", not "nothing is allowed"', () => {
    const map = loadJson(studioA);
    expect(validateMap(map, { animationKeys: [] }).ok).toBe(true);
  });

  it('fails a map that declares no tilesets array', () => {
    const map = loadJson(studioA) as Record<string, unknown>;
    delete map['tilesets'];
    expect(validateMap(map).ok).toBe(false);
  });
});

// The rules added when maps stopped being rectangles. Each one is a failure
// mode that had no symptom before: a hole you fall through, a seat 32 tiles
// away, a quiet corner that is not quiet.
describe('validateMap: non-rectangular maps', () => {
  type Layers = Array<{
    type: string;
    name: string;
    data?: number[];
    objects?: Array<{
      name: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
      point?: boolean;
      properties?: Array<{ name: string; value: unknown }>;
    }>;
  }>;
  const load = (): { width: number; height: number; layers: Layers } =>
    loadJson(studioA) as { width: number; height: number; layers: Layers };
  const layer = (map: { layers: Layers }, name: string) => map.layers.find((l) => l.name === name)!;

  it('allows a hole in the ground when it is marked solid', () => {
    // This is what makes an L-shaped room legal: the space outside the walls
    // has no floor, and is unreachable.
    const map = load();
    layer(map, 'ground').data![0] = 0;
    layer(map, 'collision').data![0] = layer(map, 'collision').data!.find((g) => g !== 0)!;
    expect(validateMap(map).ok).toBe(true);
  });

  it('fails a hole in the ground you can walk into', () => {
    const map = load();
    layer(map, 'ground').data![0] = 0;
    layer(map, 'collision').data![0] = 0;
    const result = validateMap(map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("no 'ground' tile"))).toBe(true);
    }
  });

  it('fails an object that hangs off the edge of the map', () => {
    const map = load();
    layer(map, 'interactables').objects!.push({
      name: 'runaway',
      x: map.width * 32 - 16,
      y: 0,
      width: 64,
      height: 32,
    });
    const result = validateMap(map);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("'runaway'"))).toBe(true);
  });

  it('fails a spawn inside a wall, not just the default one', () => {
    const map = load();
    const collision = layer(map, 'collision').data!;
    const solidIndex = collision.findIndex((g) => g !== 0);
    layer(map, 'spawns').objects!.push({
      name: 'north',
      x: (solidIndex % map.width) * 32,
      y: Math.floor(solidIndex / map.width) * 32,
      point: true,
    });
    const result = validateMap(map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("'north'") && e.includes('collision'))).toBe(true);
    }
  });

  it('fails an unknown zone kind and a zero-area zone', () => {
    const map = load();
    // studio_a now ships a `zones` layer of its own, and validateMap reads the
    // FIRST one — so these tests replace it rather than adding a second.
    map.layers = map.layers.filter((l) => l.name !== 'zones');
    map.layers.push({
      type: 'objectgroup',
      name: 'zones',
      objects: [
        { name: 'nope', x: 0, y: 0, width: 64, height: 64, properties: [{ name: 'zone', value: 'karaoke' }] },
        { name: 'flat', x: 0, y: 0, width: 64, height: 0, properties: [{ name: 'zone', value: 'quiet' }] },
      ],
    });
    const result = validateMap(map);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('karaoke'))).toBe(true);
      expect(result.errors.some((e) => e.includes("'flat'"))).toBe(true);
    }
  });

  it('fails overlapping booths, and accepts adjacent ones', () => {
    const booth = (name: string, x: number, width: number) => ({
      name,
      x,
      y: 0,
      width,
      height: 64,
      properties: [{ name: 'zone', value: 'booth' }],
    });
    const overlapping = load();
    overlapping.layers = overlapping.layers.filter((l) => l.name !== 'zones');
    overlapping.layers.push({
      type: 'objectgroup',
      name: 'zones',
      objects: [booth('a', 0, 128), booth('b', 96, 128)],
    });
    expect(validateMap(overlapping).ok).toBe(false);

    // Sharing an edge is not sharing a tile — booths line a wall side by side.
    const adjacent = load();
    adjacent.layers = adjacent.layers.filter((l) => l.name !== 'zones');
    adjacent.layers.push({
      type: 'objectgroup',
      name: 'zones',
      objects: [booth('a', 0, 128), booth('b', 128, 128)],
    });
    expect(validateMap(adjacent).ok).toBe(true);
  });

  it('warns rather than fails on a tileset nothing draws from', () => {
    const map = loadJson(studioA) as {
      tilesets: Array<{ name: string; firstgid: number; tilecount: number }>;
      layers: Layers;
    };
    const top = Math.max(...map.tilesets.map((t) => t.firstgid + t.tilecount));
    map.tilesets.push({ name: 'unused', firstgid: top, tilecount: 16 });
    const result = validateMap(map);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("'unused'"))).toBe(true);
  });

  it('warns on a door slot gap, which is a door no room can ever own', () => {
    const map = load();
    const doors = [0, 2].map((slot) => ({
      name: `door_${slot}`,
      x: slot * 32,
      y: 32,
      width: 32,
      height: 32,
      properties: [
        { name: 'interactive', value: 'door' },
        { name: 'door_slot', value: slot },
      ],
    }));
    layer(map, 'interactables').objects!.push(...doors);
    const result = validateMap(map);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('not contiguous'))).toBe(true);
  });
});

describe('validate-maps CLI', () => {
  const cli = join(pkgRoot, 'scripts', 'validate-maps.ts');
  const tsx = join(pkgRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.CMD' : 'tsx');
  const run = (...args: string[]): { status: number } => {
    try {
      execFileSync(tsx, [cli, ...args], { stdio: 'pipe', shell: process.platform === 'win32' });
      return { status: 0 };
    } catch (err) {
      const status = (err as { status?: number }).status;
      return { status: status ?? -1 };
    }
  };

  it('exits 0 on the shipped maps', () => {
    expect(run().status).toBe(0);
  });

  it('exits 1 on the broken copy', () => {
    expect(run(broken).status).toBe(1);
  });
});
