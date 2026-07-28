import { describe, expect, it } from 'vitest';
import { DEBOUNCE_MS, ProximityEngine, type PairChange } from '../src/rooms/proximity.js';

const MAP = 'studio_a';

// Simulates B walking along x toward/away from a stationary A at (0,0),
// feeding the engine one update per step, advancing `stepMs` per step.
function walk(
  engine: ProximityEngine,
  xs: number[],
  startAt: number,
  stepMs: number,
): { changes: PairChange[]; endedAt: number } {
  const changes: PairChange[] = [];
  let now = startAt;
  for (const x of xs) {
    now += stepMs;
    changes.push(
      ...engine.update(
        MAP,
        'b',
        [
          { userId: 'a', x: 0, y: 0 },
          { userId: 'b', x, y: 0 },
        ],
        now,
      ),
    );
  }
  return { changes, endedAt: now };
}

describe('ProximityEngine', () => {
  it('walking together yields exactly one near then one close transition, never a burst', () => {
    const engine = new ProximityEngine();
    // 8 → 1 tile at 0.2 tiles per 50ms step (4 tiles/s)
    const xs: number[] = [];
    for (let x = 8; x >= 1; x = Math.round((x - 0.2) * 10) / 10) xs.push(x);
    const { changes, endedAt } = walk(engine, xs, 0, 50);
    // The ticker settles the last pending after movement stops.
    changes.push(...engine.settle(endedAt + DEBOUNCE_MS));
    expect(changes.map((c) => c.zone)).toEqual(['near', 'close']);
  });

  it('standing precisely on a zone boundary produces no flicker', () => {
    const engine = new ProximityEngine();
    // Approach to commit 'near', then oscillate ±0.05 around exactly 5.0
    const approach = walk(engine, [6, 5.5, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0], 0, 100);
    expect(approach.changes.map((c) => c.zone)).toEqual(['near']);
    const wobble: number[] = [];
    for (let i = 0; i < 100; i++) wobble.push(i % 2 === 0 ? 5.05 : 4.95);
    const { changes } = walk(engine, wobble, approach.endedAt, 50);
    expect(changes).toEqual([]); // exit would need > 5.5
  });

  it('exits only past threshold + 0.5 tiles', () => {
    const engine = new ProximityEngine();
    const entered = walk(engine, [5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0], 0, 100);
    expect(entered.changes.map((c) => c.zone)).toEqual(['near']);
    // Sitting at 5.4 (inside hysteresis band) — still near, forever
    const holding = walk(engine, Array(20).fill(5.4), entered.endedAt, 100);
    expect(holding.changes).toEqual([]);
    // Past 5.5 → out, exactly once
    const gone = walk(engine, Array(8).fill(5.6), holding.endedAt, 100);
    expect(gone.changes.map((c) => c.zone)).toEqual(['out']);
  });

  it('debounces: a zone held under 300ms never emits', () => {
    const engine = new ProximityEngine();
    // Dip into near for 200ms then back out
    walk(engine, [5.0, 5.0], 0, 100);
    const { changes } = walk(engine, [7, 7, 7, 7, 7, 7], 200, 100);
    expect(changes).toEqual([]);
  });

  it('settle commits a pending transition without further movement', () => {
    const engine = new ProximityEngine();
    engine.update(
      MAP,
      'b',
      [
        { userId: 'a', x: 0, y: 0 },
        { userId: 'b', x: 1, y: 0 },
      ],
      1000,
    );
    expect(engine.settle(1000 + DEBOUNCE_MS - 1)).toEqual([]);
    const changes = engine.settle(1000 + DEBOUNCE_MS);
    expect(changes).toEqual([{ mapId: MAP, a: 'a', b: 'b', zone: 'close' }]);
    expect(engine.settle(1000 + DEBOUNCE_MS + 500)).toEqual([]); // committed once
  });

  it('three clustered actors produce correct pairwise states', () => {
    const engine = new ProximityEngine();
    const at = (positions: Array<[string, number, number]>) =>
      positions.map(([userId, x, y]) => ({ userId, x, y }));
    // a at 0, b at 1 (close to a), c at 4 (near a, close to b at 3)
    const cluster = at([
      ['a', 0, 0],
      ['b', 1, 0],
      ['c', 4, 0],
    ]);
    let now = 0;
    const all: PairChange[] = [];
    for (const mover of ['a', 'b', 'c']) {
      now += 50;
      all.push(...engine.update(MAP, mover, cluster, now));
    }
    all.push(...engine.settle(now + DEBOUNCE_MS + 1));
    const zoneOf = (a: string, b: string) =>
      all.find((c) => [c.a, c.b].sort().join() === [a, b].sort().join())?.zone;
    expect(zoneOf('a', 'b')).toBe('close'); // d=1
    expect(zoneOf('b', 'c')).toBe('near'); // d=3
    expect(zoneOf('a', 'c')).toBe('near'); // d=4
  });

  it('removeActor emits out for visible pairs only', () => {
    const engine = new ProximityEngine();
    walk(engine, [1, 1, 1, 1, 1, 1, 1, 1], 0, 100); // a-b close
    const changes = engine.removeActor(MAP, 'b');
    expect(changes).toEqual([{ mapId: MAP, a: 'a', b: 'b', zone: 'out' }]);
    expect(engine.removeActor(MAP, 'b')).toEqual([]); // already gone
  });

  it('computes 20-actor updates in under 5ms each (NFR budget)', () => {
    const engine = new ProximityEngine();
    const actors = Array.from({ length: 20 }, (_, i) => ({
      userId: `u${i}`,
      x: (i % 5) * 2,
      y: Math.floor(i / 5) * 2,
    }));
    const iterations = 500;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const mover = actors[i % actors.length];
      if (!mover) throw new Error('unreachable');
      mover.x += 0.05;
      engine.update(MAP, mover.userId, actors, i * 50);
    }
    const avgMs = (performance.now() - start) / iterations;
    expect(avgMs).toBeLessThan(5);
  });
});

// Map zones (rooms plan Phase 6b). These override distance entirely, so each
// test puts the pair at a distance whose answer would be OBVIOUS without the
// zone — otherwise it proves nothing.
describe('map zones', () => {
  type Actor = {
    userId: string;
    x: number;
    y: number;
    zone?: 'spotlight' | 'booth' | 'quiet' | null;
    zoneName?: string | null;
  };

  /** Settle a pair to its committed zone: one update, then wait out the debounce. */
  function committed(a: Actor, b: Actor): string {
    const engine = new ProximityEngine();
    engine.update(MAP, 'b', [a, b], 0);
    const changes = engine.settle(DEBOUNCE_MS + 1);
    return changes.at(-1)?.zone ?? 'out';
  }

  const far = { x: 40, y: 0 };
  const touching = { x: 1, y: 0 };

  it('spotlight is heard across the whole map', () => {
    // 40 tiles apart is far outside NEAR_TILES: without the zone this is `out`.
    expect(
      committed({ userId: 'a', x: 0, y: 0, zone: 'spotlight' }, { userId: 'b', ...far }),
    ).toBe('close');
  });

  it('quiet beats the spotlight, because it is the listener saying no', () => {
    expect(
      committed(
        { userId: 'a', x: 0, y: 0, zone: 'spotlight' },
        { userId: 'b', x: 1, y: 0, zone: 'quiet' },
      ),
    ).toBe('out');
  });

  it('quiet cuts a pair that is standing on top of each other', () => {
    expect(
      committed({ userId: 'a', x: 0, y: 0, zone: 'quiet' }, { userId: 'b', ...touching }),
    ).toBe('out');
  });

  it('the same booth is close however big the booth is', () => {
    expect(
      committed(
        { userId: 'a', x: 0, y: 0, zone: 'booth', zoneName: 'west' },
        { userId: 'b', x: 3, y: 0, zone: 'booth', zoneName: 'west' },
      ),
    ).toBe('close');
  });

  it('different booths are out, however close the two people stand', () => {
    // A tile apart, across a booth boundary — this is the case that makes a
    // booth a room rather than a rug.
    expect(
      committed(
        { userId: 'a', x: 0, y: 0, zone: 'booth', zoneName: 'west' },
        { userId: 'b', x: 1, y: 0, zone: 'booth', zoneName: 'east' },
      ),
    ).toBe('out');
  });

  it('a booth occupant is out to someone standing right outside it', () => {
    expect(
      committed({ userId: 'a', x: 0, y: 0, zone: 'booth', zoneName: 'west' }, { userId: 'b', ...touching }),
    ).toBe('out');
  });

  it('leaves ordinary distance alone when nobody is in a zone', () => {
    expect(committed({ userId: 'a', x: 0, y: 0 }, { userId: 'b', ...touching })).toBe('close');
    expect(committed({ userId: 'a', x: 0, y: 0 }, { userId: 'b', ...far })).toBe('out');
  });
});
