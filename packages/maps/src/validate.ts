import { z } from 'zod';

// Every Retry map must contain exactly these named tile layers (Phase 0
// contract — the client renders 'ground'/'objects', both sides build the
// collision set from 'collision'), plus a 'spawns' object layer with a point
// named 'default'. This module is pure (no fs) so both the CLI script and the
// room server can reuse it.

export const REQUIRED_TILE_LAYERS = ['ground', 'objects', 'collision'] as const;
export const SPAWN_LAYER = 'spawns';
export const DEFAULT_SPAWN = 'default';
export const EXPECTED_TILE_SIZE = 32;

const tileLayerSchema = z.object({
  type: z.literal('tilelayer'),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  data: z.array(z.number().int().nonnegative()),
});

const objectPropertySchema = z.object({
  name: z.string(),
  value: z.unknown(),
});

const objectLayerSchema = z.object({
  type: z.literal('objectgroup'),
  name: z.string(),
  objects: z.array(
    z.object({
      name: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number().optional(),
      height: z.number().optional(),
      point: z.boolean().optional(),
      // Tiled custom properties (e.g. interactive:'door', door_slot:0) must
      // survive parsing — zod strips unknown keys, so they are declared here.
      properties: z.array(objectPropertySchema).optional(),
    }),
  ),
});

const layerSchema = z.discriminatedUnion('type', [tileLayerSchema, objectLayerSchema]);

export const tiledMapSchema = z.object({
  type: z.literal('map'),
  orientation: z.literal('orthogonal'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  layers: z.array(layerSchema),
});

export type TiledMap = z.infer<typeof tiledMapSchema>;
export type TileLayer = z.infer<typeof tileLayerSchema>;
export type ObjectLayer = z.infer<typeof objectLayerSchema>;

export type ValidationResult =
  | { ok: true; map: TiledMap }
  | { ok: false; errors: string[] };

export function validateMap(raw: unknown): ValidationResult {
  const parsed = tiledMapSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }

  const map = parsed.data;
  const errors: string[] = [];

  if (map.tilewidth !== EXPECTED_TILE_SIZE || map.tileheight !== EXPECTED_TILE_SIZE) {
    errors.push(
      `tile size must be ${EXPECTED_TILE_SIZE}x${EXPECTED_TILE_SIZE}, got ${map.tilewidth}x${map.tileheight}`,
    );
  }

  const tileLayers = new Map(
    map.layers.filter((l): l is TileLayer => l.type === 'tilelayer').map((l) => [l.name, l]),
  );
  for (const name of REQUIRED_TILE_LAYERS) {
    const layer = tileLayers.get(name);
    if (!layer) {
      errors.push(`missing required tile layer '${name}'`);
      continue;
    }
    if (layer.data.length !== map.width * map.height) {
      errors.push(
        `tile layer '${name}' has ${layer.data.length} tiles, expected ${map.width * map.height} (${map.width}x${map.height})`,
      );
    }
  }

  const spawns = map.layers.find(
    (l): l is ObjectLayer => l.type === 'objectgroup' && l.name === SPAWN_LAYER,
  );
  if (!spawns) {
    errors.push(`missing required object layer '${SPAWN_LAYER}'`);
  } else {
    const defaultSpawn = spawns.objects.find((o) => o.name === DEFAULT_SPAWN);
    if (!defaultSpawn) {
      errors.push(`object layer '${SPAWN_LAYER}' has no point object named '${DEFAULT_SPAWN}'`);
    } else if (defaultSpawn.point !== true) {
      errors.push(`spawn '${DEFAULT_SPAWN}' must be a point object`);
    }
  }

  const slots = new Set<number>();
  for (const door of extractDoorSlots(map)) {
    if (slots.has(door.slot)) errors.push(`duplicate door_slot ${door.slot}`);
    slots.add(door.slot);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, map };
}

// ---------------------------------------------------------------------------
// Door slots (rooms build plan Phase 4)
// ---------------------------------------------------------------------------

export const INTERACTABLES_LAYER = 'interactables';

/** A Commons door slot in TILE coordinates (top-left tile of the door). */
export type DoorSlot = { slot: number; x: number; y: number };

/**
 * Door slots are anonymous in the map file — objects on the 'interactables'
 * layer with `interactive: 'door'` and an integer `door_slot`. Which room (if
 * any) owns a slot is assigned at runtime from the database, never baked in.
 * Used by the room server (door state) and the API (slot assignment on room
 * creation), so it lives here beside the map contract.
 */
export function extractDoorSlots(map: TiledMap): DoorSlot[] {
  const layer = map.layers.find(
    (l): l is ObjectLayer => l.type === 'objectgroup' && l.name === INTERACTABLES_LAYER,
  );
  const doors: DoorSlot[] = [];
  for (const obj of layer?.objects ?? []) {
    const props = obj.properties ?? [];
    if (!props.some((p) => p.name === 'interactive' && p.value === 'door')) continue;
    const slotProp = props.find((p) => p.name === 'door_slot');
    if (typeof slotProp?.value !== 'number' || !Number.isInteger(slotProp.value)) continue;
    doors.push({
      slot: slotProp.value,
      x: Math.floor(obj.x / EXPECTED_TILE_SIZE),
      y: Math.floor(obj.y / EXPECTED_TILE_SIZE),
    });
  }
  return doors.sort((a, b) => a.slot - b.slot);
}
