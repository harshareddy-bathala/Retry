import { z } from 'zod';

// Every Retry map must contain exactly these named tile layers (Phase 0
// contract — the client renders 'ground'/'objects', both sides build the
// collision set from 'collision'), plus a 'spawns' object layer with a point
// named 'default'. This module is pure (no fs) so both the CLI script and the
// room server can reuse it.

export const REQUIRED_TILE_LAYERS = ['ground', 'objects', 'collision'] as const;
/** Recognised but not required — validated when present. */
export const OPTIONAL_TILE_LAYERS = ['ground_overlay', 'objects_above'] as const;
export const SPAWN_LAYER = 'spawns';
export const DEFAULT_SPAWN = 'default';
export const EXPECTED_TILE_SIZE = 32;

/** The `interactive` values the renderer knows how to activate. */
export const INTERACTIVE_KINDS = ['door', 'whiteboard', 'exit'] as const;

/**
 * Animated ambience. Each object's NAME on this layer is an animation key from
 * assets.config.ts's ANIMATED_OBJECTS; the renderer skips a key it does not
 * know, so `validateMap` takes the valid set as an argument and reports the
 * typo instead of leaving a prop invisibly absent. Callers without the
 * generated manifest (the room server, which never draws) simply omit it.
 */
export const PROPS_LAYER = 'props';

/**
 * Tiled sets the top three bits of a gid for flipped/rotated placements.
 * Masking them off recovers the tile id for range checks.
 */
export const GID_FLAG_MASK = 0x1fffffff;

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

// Declared tilesets carry the gid space. Once maps are hand-authored in Tiled
// a human can reference a tile that no declared sheet contains — the gid-range
// check below is what catches that before the renderer draws garbage.
const tilesetRefSchema = z.object({
  name: z.string(),
  firstgid: z.number().int().positive(),
  tilecount: z.number().int().positive(),
});

export const tiledMapSchema = z.object({
  type: z.literal('map'),
  orientation: z.literal('orthogonal'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  tilesets: z.array(tilesetRefSchema),
  layers: z.array(layerSchema),
});

export type TiledMap = z.infer<typeof tiledMapSchema>;
export type TileLayer = z.infer<typeof tileLayerSchema>;
export type ObjectLayer = z.infer<typeof objectLayerSchema>;

export type ValidationResult =
  | { ok: true; map: TiledMap }
  | { ok: false; errors: string[] };

export type ValidateOptions = {
  /**
   * Known animation keys. `props` object names are checked only when this is
   * a NON-EMPTY list: an empty one means "the caller could not find out"
   * (a pack-less build), not "no animation is permitted".
   */
  animationKeys?: readonly string[];
};

export function validateMap(raw: unknown, options: ValidateOptions = {}): ValidationResult {
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

  // Optional layers are validated when present — a wrong-sized objects_above
  // is a bug, not a feature the map opted out of.
  for (const name of OPTIONAL_TILE_LAYERS) {
    const layer = tileLayers.get(name);
    if (layer && layer.data.length !== map.width * map.height) {
      errors.push(
        `tile layer '${name}' has ${layer.data.length} tiles, expected ${map.width * map.height} (${map.width}x${map.height})`,
      );
    }
  }

  // Every non-zero gid must land inside a declared tileset's range. Sorting by
  // firstgid lets one binary-search-free pass find the owning sheet.
  const ranges = [...map.tilesets]
    .sort((a, b) => a.firstgid - b.firstgid)
    .map((t) => ({ name: t.name, from: t.firstgid, to: t.firstgid + t.tilecount - 1 }));
  const maxGid = ranges.length > 0 ? ranges[ranges.length - 1]!.to : 0;
  for (const layer of tileLayers.values()) {
    let bad: number | null = null;
    for (const raw of layer.data) {
      const gid = raw & GID_FLAG_MASK;
      if (gid === 0) continue;
      if (gid > maxGid || !ranges.some((r) => gid >= r.from && gid <= r.to)) {
        bad = gid;
        break;
      }
    }
    if (bad !== null) {
      errors.push(
        `tile layer '${layer.name}' references gid ${bad}, outside every declared tileset (max valid gid ${maxGid})`,
      );
    }
  }

  // Interactables must be activatable: a kind the renderer knows, and doors
  // need an integer slot. A GUI author can typo a property name and the object
  // silently becomes scenery — this is the check that makes it loud.
  const interactables = map.layers.find(
    (l): l is ObjectLayer => l.type === 'objectgroup' && l.name === INTERACTABLES_LAYER,
  );
  for (const obj of interactables?.objects ?? []) {
    const props = obj.properties ?? [];
    const kind = props.find((p) => p.name === 'interactive')?.value;
    if (kind === undefined) continue; // plain decoration on the layer is fine
    if (typeof kind !== 'string' || !(INTERACTIVE_KINDS as readonly string[]).includes(kind)) {
      errors.push(
        `interactable '${obj.name || '(unnamed)'}' has unknown interactive kind ${JSON.stringify(kind)}; expected one of ${INTERACTIVE_KINDS.join(', ')}`,
      );
      continue;
    }
    if (kind === 'door') {
      const slot = props.find((p) => p.name === 'door_slot')?.value;
      if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0) {
        errors.push(`door '${obj.name || '(unnamed)'}' needs a non-negative integer door_slot`);
      }
    }
  }

  if (options.animationKeys && options.animationKeys.length > 0) {
    const known = new Set(options.animationKeys);
    const props = map.layers.find(
      (l): l is ObjectLayer => l.type === 'objectgroup' && l.name === PROPS_LAYER,
    );
    for (const obj of props?.objects ?? []) {
      if (!known.has(obj.name)) {
        errors.push(
          `props object '${obj.name}' is not a known animation (add it to ANIMATED_OBJECTS, or fix the name)`,
        );
      }
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
