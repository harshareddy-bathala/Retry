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
