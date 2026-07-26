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
    expect(result).toEqual({ ok: true, map: expect.anything() });
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

  it('fails a map that declares no tilesets array', () => {
    const map = loadJson(studioA) as Record<string, unknown>;
    delete map['tilesets'];
    expect(validateMap(map).ok).toBe(false);
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
