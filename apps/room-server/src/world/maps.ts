import studioA from '@retry/maps/studio_a.json';
import commons from '@retry/maps/commons.json';
import classroom from '@retry/maps/classroom.json';
import lounge from '@retry/maps/lounge.json';
import conference from '@retry/maps/conference.json';
import {
  validateMap,
  extractDoorSlots,
  DEFAULT_SPAWN,
  SERVER_ZONE_KINDS,
  SPAWN_LAYER,
  ZONES_LAYER,
  type DoorSlot,
  type TiledMap,
  type ZoneKind,
} from '@retry/maps';
import { TILE_SIZE } from '@retry/protocol';

// The server owns the collision map too, loaded from the SAME map JSON the
// client renders — the two sides can never disagree about where a wall is.
// All positions here are in TILE units (fractions allowed; collision checks
// floor to the containing tile).
//
// Phase 4: maps split into TEMPLATES (the Tiled files: 'studio_a', 'commons')
// and INSTANCES (what sessions join). 'commons' and 'studio_a' are static
// instances; every room is its own instance (mapId = room uuid) rendered from
// the room's map_template. Instances share the template's immutable geometry.

/** A named region the proximity engine honours, in TILE units. */
export type MapZone = {
  kind: ZoneKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type Geometry = {
  width: number;
  height: number;
  blocked: ReadonlySet<string>;
  spawn: { x: number; y: number };
  /**
   * Every spawn point the map offers, `default` first.
   *
   * Reading only `default` is why a busy room looked like a pile: everyone
   * arriving lands on one tile, overlapping, until they move. The rooms now
   * declare three or four entry points each.
   */
  spawns: ReadonlyArray<{ x: number; y: number }>;
  /** Only the kinds the SERVER acts on; client-only kinds never reach here. */
  zones: readonly MapZone[];
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

  // `default` first, then the rest in map order — so a map with no extra
  // spawns behaves exactly as it did.
  const points = spawns.objects
    .filter((o) => o.point === true)
    .map((o) => ({ name: o.name, x: o.x / TILE_SIZE, y: o.y / TILE_SIZE }));
  const ordered = [
    ...points.filter((p) => p.name === DEFAULT_SPAWN),
    ...points.filter((p) => p.name !== DEFAULT_SPAWN),
  ].map(({ x, y }) => ({ x, y }));

  const zoneLayer = map.layers.find((l) => l.type === 'objectgroup' && l.name === ZONES_LAYER);
  const zones: MapZone[] = [];
  if (zoneLayer?.type === 'objectgroup') {
    for (const obj of zoneLayer.objects) {
      const kind = (obj.properties ?? []).find((p) => p.name === 'zone')?.value;
      // Client-only kinds (whiteboard, audience) are camera hints and mean
      // nothing here. Filtering them out at load is what lets `zoneAt` be a
      // straight answer to "does this tile change who hears whom".
      if (typeof kind !== 'string' || !(SERVER_ZONE_KINDS as readonly string[]).includes(kind)) {
        continue;
      }
      zones.push({
        kind: kind as ZoneKind,
        name: obj.name,
        x: obj.x / TILE_SIZE,
        y: obj.y / TILE_SIZE,
        w: (obj.width ?? 0) / TILE_SIZE,
        h: (obj.height ?? 0) / TILE_SIZE,
      });
    }
  }

  return {
    width: map.width,
    height: map.height,
    blocked,
    spawn: { x: def.x / TILE_SIZE, y: def.y / TILE_SIZE },
    spawns: ordered,
    zones,
    doorSlots: extractDoorSlots(map),
  };
}

// Room templates a room may be created from, plus the Commons. Adding one is a
// line here and a line in @retry/types' ROOM_MAP_TEMPLATES — the API validates
// against that list, this map is what actually instantiates geometry.
const templates = new Map<string, ReturnType<typeof load>>([
  ['studio_a', load('studio_a', studioA)],
  ['classroom', load('classroom', classroom)],
  ['lounge', load('lounge', lounge)],
  ['conference', load('conference', conference)],
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
  const { width, height, blocked, spawn, spawns, zones } = template;
  return { id: mapId, template: templateName, width, height, blocked, spawn, spawns, zones };
}

/**
 * The server-side zone containing a point, or null.
 *
 * First match wins, and the validator forbids overlapping booths so the only
 * way to be in two at once is a `quiet` laid over a `booth` — which is a
 * deliberate authoring choice, not an accident, and resolves the way the map
 * lists them.
 */
export function zoneAt(map: WorldMap, x: number, y: number): MapZone | null {
  for (const z of map.zones) {
    if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z;
  }
  return null;
}

/**
 * How many people have to be standing at an entrance before a new arrival is
 * sent to a different one.
 *
 * Not one. The obvious rule — "take the first spawn nobody is on" — spreads
 * arrivals across the map, and in a world where being near someone is being in
 * a call with them, that is a regression, not a polish: two people opening the
 * same room together would land forty tiles apart and hear nothing. Landing on
 * top of whoever is already there is the SOCIALLY correct default, and the pile
 * it makes is cosmetic and resolves the moment anyone walks.
 *
 * So the alternates exist for the case they were actually needed for: a class
 * of thirty arriving at once.
 */
const SPAWN_CROWD = 4;
/** Tiles within which someone counts as standing at an entrance. */
const SPAWN_RADIUS = 2;

/**
 * Where a first-time arrival lands.
 *
 * The default entrance unless it is already crowded, then the first alternate
 * that is not — and the default again if every entrance is busy, because a
 * full room should behave exactly as it did before this existed.
 */
export function pickSpawn(
  map: WorldMap,
  occupied: ReadonlyArray<{ x: number; y: number }>,
): { x: number; y: number } {
  const crowd = (point: { x: number; y: number }): number =>
    occupied.filter((o) => Math.hypot(o.x - point.x, o.y - point.y) <= SPAWN_RADIUS).length;
  for (const point of map.spawns) {
    if (crowd(point) < SPAWN_CROWD) return point;
  }
  return map.spawn;
}

export function isBlocked(map: WorldMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return map.blocked.has(`${Math.floor(x)},${Math.floor(y)}`);
}
