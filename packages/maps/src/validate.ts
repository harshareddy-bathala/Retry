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
export const INTERACTIVE_KINDS = ['door', 'whiteboard', 'exit', 'seat', 'board', 'podium'] as const;

/**
 * Named regions on the optional `zones` object layer.
 *
 * Two are drawn by the client and mean nothing to the server; three change who
 * hears whom and are enforced by the proximity engine. The split matters when
 * reading a map: a `quiet` rectangle is a promise the server keeps, a
 * `whiteboard` rectangle is only a hint the camera obeys.
 */
export const CLIENT_ZONE_KINDS = ['whiteboard', 'audience'] as const;
export const SERVER_ZONE_KINDS = ['spotlight', 'booth', 'quiet'] as const;
export const ZONE_KINDS = [...CLIENT_ZONE_KINDS, ...SERVER_ZONE_KINDS] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const ZONES_LAYER = 'zones';

/** Which way a seated avatar looks. Mirrors the protocol's `dir`. */
export const SEAT_FACINGS = ['up', 'down', 'left', 'right'] as const;

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

/**
 * Errors fail the build; warnings are printed and do not.
 *
 * The distinction is not squeamishness — it is what makes it possible to add a
 * check at all. The room server THROWS AT BOOT on an invalid map, so promoting
 * a stylistic rule to an error is a decision to take the world down over a
 * misplaced shadow tile. Warnings let a rule ship, get looked at across all
 * five maps, and be promoted once it is known not to fire falsely.
 */
export type ValidationResult =
  | { ok: true; map: TiledMap; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

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
      warnings: [],
    };
  }

  const map = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];

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

  // A sheet nobody draws from is 500KB-4MB of texture the browser downloads and
  // uploads to the GPU for nothing. Cheap to leave behind when a map is
  // reworked, invisible in the file, and it costs every visitor.
  const usedRanges = new Set<string>();
  for (const layer of tileLayers.values()) {
    for (const rawGid of layer.data) {
      const gid = rawGid & GID_FLAG_MASK;
      if (gid === 0) continue;
      const owner = ranges.find((r) => gid >= r.from && gid <= r.to);
      if (owner) usedRanges.add(owner.name);
    }
  }
  for (const range of ranges) {
    if (!usedRanges.has(range.name)) {
      warnings.push(`tileset '${range.name}' is declared but no tile references it — drop it`);
    }
  }

  const ground = tileLayers.get('ground');
  const collision = tileLayers.get('collision');

  // The floor-vs-void rule, and the reason maps are allowed to be L-shaped.
  //
  // Nothing requires `ground` to be completely filled — the space outside a
  // non-rectangular room SHOULD be empty, and forcing a floor there is what
  // made every map a box. What is required is that the two agree: any tile you
  // can stand on has something to stand on. An empty tile that is also
  // unblocked is a hole an avatar walks into and hovers over the page
  // background, which reads as a rendering bug rather than a map bug.
  if (ground && collision) {
    let hole: { x: number; y: number } | null = null;
    let holes = 0;
    for (let i = 0; i < ground.data.length; i++) {
      if ((ground.data[i] ?? 0) !== 0) continue;
      if ((collision.data[i] ?? 0) !== 0) continue;
      holes += 1;
      hole ??= { x: i % map.width, y: Math.floor(i / map.width) };
    }
    if (hole) {
      errors.push(
        `${holes} walkable tile(s) have no 'ground' tile, starting at ${hole.x},${hole.y} — floor them, or mark them solid on 'collision'`,
      );
    }
  }

  // Drawn above the avatar AND impassable: the walk-behind rule applied
  // backwards. Nothing can ever appear behind it, so it is an ordinary object
  // paying for an extra layer — usually a tile pasted onto the wrong one.
  const above = tileLayers.get('objects_above');
  if (above && collision) {
    let count = 0;
    let first: { x: number; y: number } | null = null;
    for (let i = 0; i < above.data.length; i++) {
      if ((above.data[i] ?? 0) === 0 || (collision.data[i] ?? 0) === 0) continue;
      count += 1;
      first ??= { x: i % map.width, y: Math.floor(i / map.width) };
    }
    if (first) {
      warnings.push(
        `${count} tile(s) on 'objects_above' are also solid, starting at ${first.x},${first.y} — nothing can pass behind them, so they belong on 'objects'`,
      );
    }
  }

  // Every object, on every layer, inside the map. Tiled stores objects in
  // PIXELS while everything else here is tiles, so an off-by-one in an
  // authoring script lands a seat 32 tiles away rather than one — far enough
  // out that the renderer simply never draws it and the map looks fine.
  const mapPxWidth = map.width * map.tilewidth;
  const mapPxHeight = map.height * map.tileheight;
  for (const layer of map.layers) {
    if (layer.type !== 'objectgroup') continue;
    for (const obj of layer.objects) {
      const w = obj.width ?? 0;
      const h = obj.height ?? 0;
      if (obj.x < 0 || obj.y < 0 || obj.x + w > mapPxWidth || obj.y + h > mapPxHeight) {
        errors.push(
          `object '${obj.name || '(unnamed)'}' on '${layer.name}' spans ${obj.x},${obj.y} +${w}x${h}px, outside the ${mapPxWidth}x${mapPxHeight}px map`,
        );
      }
    }
  }

  // Zones: a typo'd kind is a rectangle the server ignores, which is a room
  // whose quiet corner is not quiet — and the only symptom is that someone can
  // hear you.
  const zones = map.layers.find(
    (l): l is ObjectLayer => l.type === 'objectgroup' && l.name === ZONES_LAYER,
  );
  const booths: Array<{ name: string; x: number; y: number; w: number; h: number }> = [];
  for (const obj of zones?.objects ?? []) {
    const kind = (obj.properties ?? []).find((p) => p.name === 'zone')?.value;
    if (typeof kind !== 'string' || !(ZONE_KINDS as readonly string[]).includes(kind)) {
      errors.push(
        `zone '${obj.name || '(unnamed)'}' has unknown zone kind ${JSON.stringify(kind)}; expected one of ${ZONE_KINDS.join(', ')}`,
      );
      continue;
    }
    const w = obj.width ?? 0;
    const h = obj.height ?? 0;
    if (w <= 0 || h <= 0) {
      errors.push(`zone '${obj.name || '(unnamed)'}' (${kind}) needs a non-zero width and height`);
      continue;
    }
    if (kind === 'booth') booths.push({ name: obj.name || '(unnamed)', x: obj.x, y: obj.y, w, h });
  }
  // A booth makes its occupants close to each other and out to everyone else.
  // Standing in two of them at once has no defined answer, so it is forbidden
  // here rather than resolved arbitrarily at 10Hz in the proximity engine.
  for (let i = 0; i < booths.length; i++) {
    for (let j = i + 1; j < booths.length; j++) {
      const a = booths[i]!;
      const b = booths[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        errors.push(`booth zones '${a.name}' and '${b.name}' overlap; a tile may be in only one`);
      }
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
    if (kind === 'seat') {
      const facing = props.find((p) => p.name === 'facing')?.value;
      if (typeof facing !== 'string' || !(SEAT_FACINGS as readonly string[]).includes(facing)) {
        errors.push(
          `seat '${obj.name || '(unnamed)'}' needs a facing of ${SEAT_FACINGS.join('/')}`,
        );
      }
      // A seat moves the avatar onto its tile and the server validates that
      // position against the collision layer, so a seat on a solid tile is a
      // seat nobody can use — and it fails at runtime, silently, as a resync.
      const collision = tileLayers.get('collision');
      const tx = Math.floor(obj.x / EXPECTED_TILE_SIZE);
      const ty = Math.floor(obj.y / EXPECTED_TILE_SIZE);
      if (collision && collision.data[ty * map.width + tx] !== 0) {
        errors.push(`seat '${obj.name || '(unnamed)'}' at ${tx},${ty} sits on a collision tile`);
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
    // Every spawn, not just the default. A room offering four entry points
    // where one of them is inside a wall fails for a quarter of arrivals, and
    // it fails as a resync — the avatar appears, jumps, and the player is left
    // wondering what they did.
    for (const spawn of spawns.objects) {
      if (spawn.point !== true) {
        errors.push(`spawn '${spawn.name || '(unnamed)'}' must be a point object`);
        continue;
      }
      const tx = Math.floor(spawn.x / EXPECTED_TILE_SIZE);
      const ty = Math.floor(spawn.y / EXPECTED_TILE_SIZE);
      if (collision && (collision.data[ty * map.width + tx] ?? 0) !== 0) {
        errors.push(`spawn '${spawn.name || '(unnamed)'}' at ${tx},${ty} sits on a collision tile`);
      }
    }
  }

  const doors = extractDoorSlots(map);
  const slots = new Set<number>();
  for (const door of doors) {
    if (slots.has(door.slot)) errors.push(`duplicate door_slot ${door.slot}`);
    slots.add(door.slot);
  }
  // Slots are an array index everywhere downstream: the API assigns rooms to
  // them and `reconcileDoors` walks 0..n-1. A gap does not crash anything, it
  // just makes one door permanently unassignable.
  for (let i = 0; i < doors.length; i++) {
    if (!slots.has(i)) {
      warnings.push(
        `door slots are not contiguous — ${doors.length} doors but no slot ${i}; the gap will never be assigned a room`,
      );
      break;
    }
  }

  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, map, warnings };
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
