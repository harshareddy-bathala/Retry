import studioA from '@foundry/maps/studio_a.json';
import { validateMap, DEFAULT_SPAWN, SPAWN_LAYER, type TiledMap } from '@foundry/maps';
import { TILE_SIZE } from '@foundry/protocol';

// The server owns the collision map too, loaded from the SAME map JSON the
// client renders — the two sides can never disagree about where a wall is.
// All positions here are in TILE units (fractions allowed; collision checks
// floor to the containing tile).

export type WorldMap = {
  id: string;
  width: number;
  height: number;
  blocked: ReadonlySet<string>;
  spawn: { x: number; y: number };
};

function load(id: string, raw: unknown): WorldMap {
  const result = validateMap(raw);
  if (!result.ok) {
    throw new Error(`map '${id}' violates the map contract: ${result.errors.join('; ')}`);
  }
  const map: TiledMap = result.map;

  const collision = map.layers.find((l) => l.type === 'tilelayer' && l.name === 'collision');
  if (collision?.type !== 'tilelayer') throw new Error('unreachable: validateMap guarantees collision');
  const blocked = new Set<string>();
  collision.data.forEach((tile, i) => {
    if (tile !== 0) blocked.add(`${i % map.width},${Math.floor(i / map.width)}`);
  });

  const spawns = map.layers.find((l) => l.type === 'objectgroup' && l.name === SPAWN_LAYER);
  if (spawns?.type !== 'objectgroup') throw new Error('unreachable: validateMap guarantees spawns');
  const def = spawns.objects.find((o) => o.name === DEFAULT_SPAWN);
  if (!def) throw new Error('unreachable: validateMap guarantees default spawn');

  return {
    id,
    width: map.width,
    height: map.height,
    blocked,
    spawn: { x: def.x / TILE_SIZE, y: def.y / TILE_SIZE },
  };
}

const worldMaps = new Map<string, WorldMap>([['studio_a', load('studio_a', studioA)]]);

export function getWorldMap(mapId: string): WorldMap | undefined {
  return worldMaps.get(mapId);
}

export function isBlocked(map: WorldMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return map.blocked.has(`${Math.floor(x)},${Math.floor(y)}`);
}
