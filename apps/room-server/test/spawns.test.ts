import { describe, expect, it } from 'vitest';
import { instantiate, pickSpawn } from '../src/world/maps.js';

// Spawn choice (rooms plan Phase 6b). The rule is deliberately NOT "the first
// free entrance" — see pickSpawn's comment. These tests pin the trade-off, so
// that changing it later is a decision rather than an accident.
describe('pickSpawn', () => {
  const world = instantiate('studio_a', 'studio_a');
  if (!world) throw new Error('studio_a failed to instantiate');

  it('sends an arrival to the default when the room is empty', () => {
    expect(pickSpawn(world, [])).toEqual(world.spawn);
  });

  it('puts a second arrival ON TOP of the first, because that is a call', () => {
    // The whole social mechanic: two people opening the same room together
    // must be able to hear each other without walking.
    expect(pickSpawn(world, [world.spawn])).toEqual(world.spawn);
    expect(pickSpawn(world, [world.spawn, world.spawn, world.spawn])).toEqual(world.spawn);
  });

  it('uses another entrance once a crowd has built at the default', () => {
    const crowd = Array.from({ length: 4 }, () => world.spawn);
    const picked = pickSpawn(world, crowd);
    expect(picked).not.toEqual(world.spawn);
    expect(world.spawns).toContainEqual(picked);
  });

  it('falls back to the default when every entrance is busy', () => {
    const everywhere = world.spawns.flatMap((s) => Array.from({ length: 4 }, () => s));
    expect(pickSpawn(world, everywhere)).toEqual(world.spawn);
  });

  it('offers more than one entrance in the first place', () => {
    expect(world.spawns.length).toBeGreaterThan(1);
  });
});
