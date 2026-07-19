import studioA from '@foundry/maps/studio_a.json';
import commons from '@foundry/maps/commons.json';
import {
  validateMap,
  extractDoorSlots,
  DEFAULT_SPAWN,
  SPAWN_LAYER,
  type DoorSlot,
  type TiledMap,
} from '@foundry/maps';
import { TILE_SIZE } from '@foundry/protocol';

// The server owns the collision map too, loaded from the SAME map JSON the
// client renders — the two sides can never disagree about where a wall is.
// All positions here are in TILE units (fractions allowed; collision checks
// floor to the containing tile).
//
// Phase 4: maps split into TEMPLATES (the Tiled files: 'studio_a', 'commons')
// and INSTANCES (what sessions join). 'commons' and 'studio_a' are static
// instances; every room is its own instance (mapId = room uuid) rendered from
// the room's map_template. Instances share the template's immutable geometry.

type Geometry = {
  width: number;
  height: number;
  blocked: ReadonlySet<string>;
  spawn: { x: number; y: number };
};

export type WorldMap = Geometry & {
  /** The instance id sessions join ('commons', 'studio_a', or a room uuid). */
  id: string;
  /** The Tiled template the client must render for this instance. */
  template: string;
};

function load(name: string, raw: unknown): Geometry & { doorSlots: DoorSlot[] } {
  const result = validateMap(raw);
  if (!result.ok) {
    throw new Error(`map '${name}' violates the map contract: ${result.errors.join('; ')}`);
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
    width: map.width,
    height: map.height,
    blocked,
    spawn: { x: def.x / TILE_SIZE, y: def.y / TILE_SIZE },
    doorSlots: extractDoorSlots(map),
  };
}

const templates = new Map<string, ReturnType<typeof load>>([
  ['studio_a', load('studio_a', studioA)],
  ['commons', load('commons', commons)],
]);

export const COMMONS_MAP_ID = 'commons';

/** Door slot positions in the Commons, in tile units (assignment lives in the DB). */
export const COMMONS_DOOR_SLOTS: readonly DoorSlot[] = templates.get('commons')?.doorSlots ?? [];

/** Maps joinable without a room row: the Commons and the studio_a sandbox. */
export const STATIC_MAP_IDS = new Set<string>(['commons', 'studio_a']);

export function instantiate(mapId: string, templateName: string): WorldMap | undefined {
  const template = templates.get(templateName);
  if (!template) return undefined;
  const { width, height, blocked, spawn } = template;
  return { id: mapId, template: templateName, width, height, blocked, spawn };
}

export function isBlocked(map: WorldMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return map.blocked.has(`${Math.floor(x)},${Math.floor(y)}`);
}
