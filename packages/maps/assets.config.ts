// What we take from LimeZu "Modern Interiors" — the single list.
//
// The pack is 53,536 files. This file is the whole of our relationship with it:
// nothing enters the app that is not named here, and `pnpm assets:build` reports
// how much of the pack we are actually using, so growing our coverage is a
// deliberate edit rather than something that quietly never happens.
//
// Licence: limezu.itch.io. Usable and editable in this project, NOT
// redistributable — see docs/assets-setup.md and ATTRIBUTION.md.

/** Only the full version. The free version's licence is NON-COMMERCIAL. */
export const PACK_DIR = 'assets/moderninteriors-win';
export const PACK_LICENCE_MARKER = 'MODERN INTERIORS FULL VERSION LICENSE';

/**
 * The free download shares a directory root with the paid pack and carries a
 * licence that forbids commercial use. Building from it by accident would put
 * non-commercially-licensed art into a product for 5,000 students, so the
 * build refuses to read from here at all.
 */
export const FORBIDDEN_DIRS = ['assets/Modern_Interiors_Free_v2.2'];

/** 32px matches TILE_SIZE, the wire protocol and the existing map contract. */
export const TILE = 32;

/**
 * Character frames are one tile WIDE and two tiles TALL — the head sits above
 * the tile the body occupies, which is what gives the pack its depth. This is
 * not the same as our old 32x32 avatars and the renderer has to know it.
 */
export const CHAR_FRAME = { width: 32, height: 64 } as const;

/**
 * The generator sheets are a 56x20 grid of CHAR_FRAME cells. Measured, not
 * assumed: the sheets are 1792x1312 — the 32px beyond row 20 is empty padding —
 * except bodies, which are 1854 wide. The extra 62px of body width is real
 * content in rows 11-12 (lift/throw), which we never use; everything must be
 * addressed by (column, row) and cropped to the 1792 grid, never by linear
 * frame index, or body frames drift one column per row against every other
 * layer.
 */
export const CHAR_SHEET = { columns: 56, rows: 20 } as const;

/**
 * Direction order inside a 24-frame animation row. Measured from the eyes
 * layer (an up-facing frame has no eye pixels; a down-facing frame has two
 * eyes; left/right have one eye left/right of the frame's centre). This is the
 * pack's order, and it is not the order our old hand-drawn sheets used.
 */
export const DIRECTION_ORDER = ['right', 'up', 'left', 'down'] as const;
export type Direction = (typeof DIRECTION_ORDER)[number];

/**
 * The animation rows we ship, in the order they appear in the CROPPED strips
 * the build emits. `sourceRow` is the row in the pack's 20-row sheet; the
 * cropped strip re-rows them from 0. Each row is 6 frames per direction, in
 * DIRECTION_ORDER, columns 0-23.
 *
 * The pack has 18 more rows (sit, phone, reading, …) — add them here when the
 * renderer learns to play them, and the strips grow one row each.
 */
export const ANIMATION_ROWS = [
  { key: 'idle', sourceRow: 1, frames: 6, frameRate: 4 },
  { key: 'walk', sourceRow: 2, frames: 6, frameRate: 10 },
] as const;
export type AnimationKey = (typeof ANIMATION_ROWS)[number]['key'];

/** Geometry of the cropped strips `assets:build` writes. */
export const STRIP = {
  columns: DIRECTION_ORDER.length * 6, // 24 frames per row
  rows: ANIMATION_ROWS.length,
  width: DIRECTION_ORDER.length * 6 * CHAR_FRAME.width, // 768
  height: ANIMATION_ROWS.length * CHAR_FRAME.height, // 128
} as const;

type Sheet = { key: string; file: string; note: string };

/**
 * Tilesets we draw rooms from. Deliberately NOT `Interiors_32x32.png`: at
 * 512x34,048 it is taller than the 16,384px texture limit on a lot of GPUs and
 * mobile chips, and would fail to upload as a single WebGL texture. The
 * per-theme sheets top out at 512x3,904.
 *
 * Order matters: `author-maps.ts` assigns firstgids in this order, so new
 * sheets are APPENDED — inserting one in the middle would silently renumber
 * every gid in the committed maps.
 */
export const TILESETS: Sheet[] = [
  {
    key: 'floors',
    file: '1_Interiors/32x32/Room_Bulder_subfiles_32x32/Room_Builder_Floors_32x32.png',
    note: 'floor materials, 3x2 tileable blocks',
  },
  {
    key: 'walls',
    file: '1_Interiors/32x32/Room_Bulder_subfiles_32x32/Room_Builder_Walls_32x32.png',
    note: 'wall runs, 2 tiles tall: capped upper, skirted lower',
  },
  {
    key: 'generic',
    file: '1_Interiors/32x32/Theme_Sorter_32x32/1_Generic_32x32.png',
    note: 'doors, windows, stairs, rugs, plants, counters',
  },
  {
    key: 'classroom',
    file: '1_Interiors/32x32/Theme_Sorter_32x32/5_Classroom_and_library_32x32.png',
    note: 'desks, chalkboards, bookshelves, printers, a desktop PC — the project room',
  },
  {
    key: 'conference',
    file: '1_Interiors/32x32/Theme_Sorter_32x32/13_Conference_Hall_32x32.png',
    note: 'conference tables, lectern, projection screen — the demo stage',
  },
  {
    key: 'livingroom',
    file: '1_Interiors/32x32/Theme_Sorter_32x32/2_LivingRoom_32x32.png',
    note: 'sofas, armchairs, coffee tables — the lounge',
  },
  {
    key: 'kitchen',
    file: '1_Interiors/32x32/Theme_Sorter_32x32/12_Kitchen_32x32.png',
    note: 'counters and a coffee machine; counters double as workbenches',
  },
  {
    key: 'basement',
    file: '1_Interiors/32x32/Theme_Sorter_32x32/14_Basement_32x32.png',
    note: 'server racks, wall screens, shelving — the workshop',
  },
  {
    key: 'museum',
    file: '1_Interiors/32x32/Theme_Sorter_32x32/22_Museum_32x32.png',
    note: 'reception, benches, display cases — the Commons, and the project gallery',
  },
  {
    key: 'tvstudio',
    file: '1_Interiors/32x32/Theme_Sorter_32x32/23_Television_and_Film_Studio_32x32.png',
    note: 'monitor walls, studio lights, green screen — the demo stage',
  },
  // --- appended 2026-07-26: the structural sheets that stop rooms looking flat
  {
    key: 'walls3d',
    file: '1_Interiors/32x32/Room_Bulder_subfiles_32x32/Room_Builder_3d_walls_32x32.png',
    note: '2.5D wall faces — dark top, lit front — for walls seen from above',
  },
  {
    key: 'shadows',
    file: '1_Interiors/32x32/Room_Bulder_subfiles_32x32/Room_Builder_Floor_Shadows_32x32.png',
    note: 'soft floor shadows cast by walls; an overlay layer, not a floor',
  },
  {
    key: 'borders',
    file: '1_Interiors/32x32/Room_Bulder_subfiles_32x32/Room_Builder_borders_32x32.png',
    note: 'skirting and trim where floor meets wall',
  },
  {
    key: 'entryways',
    file: '1_Interiors/32x32/Room_Bulder_subfiles_32x32/Room_Builder_Arched_Entryways_32x32.png',
    note: 'arched openings between rooms — doorways that are not doors',
  },
  {
    key: 'connectors',
    file: '1_Interiors/32x32/Room_Bulder_subfiles_32x32/Room_Builder_Floor_Connectors_32x32.png',
    note: 'clean seams where two floor materials meet',
  },
];

// ---------------------------------------------------------------------------
// Animated objects
// ---------------------------------------------------------------------------

/**
 * Horizontal frame strips from `3_Animated_objects`. The pack ships each object
 * twice — as a gif preview and as a spritesheet — and only the spritesheets are
 * usable. Two quirks are handled here rather than at runtime: some filenames
 * contain SPACES and encode their loop range (`..._6-9 loop_32x32.png`), and
 * these sheets are palette-indexed PNGs rather than RGBA (browsers do not care;
 * our preview tools needed teaching).
 *
 * `loop` is [firstFrame, lastFrame] for objects that idle on a sub-range;
 * omitted means the whole strip loops. Doors do not loop at all — the renderer
 * plays them forwards to open and backwards to close.
 */
export type AnimatedObject = {
  key: string;
  file: string;
  frameHeight: number;
  loop?: readonly [number, number];
  note: string;
};

const ANIM_DIR = '3_Animated_objects/32x32/spritesheets';

export const ANIMATED_OBJECTS: AnimatedObject[] = [
  {
    key: 'door',
    file: `${ANIM_DIR}/animated_door_1_32x32.png`,
    frameHeight: 64,
    note: '5 frames: 0 shut, 4 wide open. The Commons doors.',
  },
  {
    key: 'doorLocked',
    file: `${ANIM_DIR}/animated_door_1_locked_32x32.png`,
    frameHeight: 64,
    note: 'the same door with a lock plate — knock / invite-only rooms',
  },
  {
    key: 'coffee',
    file: `${ANIM_DIR}/animated_coffee_32x32.png`,
    frameHeight: 64,
    note: 'coffee machine, brewing — the lounge bar',
  },
  {
    key: 'server',
    file: `${ANIM_DIR}/animated_control_room_server_32x32.png`,
    frameHeight: 96,
    note: 'server rack with blinking lights — the studio',
  },
  {
    key: 'cat',
    file: `${ANIM_DIR}/animated_cat_32x32.png`,
    frameHeight: 32,
    note: 'a cat. Every good virtual space has one.',
  },
  {
    key: 'candle',
    file: `${ANIM_DIR}/animated_candle_32x32.png`,
    frameHeight: 64,
    note: 'candle flame — the lounge',
  },
  {
    key: 'sprout',
    file: `${ANIM_DIR}/animated_sprout_32x32.png`,
    frameHeight: 64,
    note: 'a small plant swaying — anywhere that needs life',
  },
];

// ---------------------------------------------------------------------------
// Emotes — the thought-bubble atlas
// ---------------------------------------------------------------------------

/**
 * `UI_thinking_emotes_animation_32x32.png` is a 10x10 grid, not a strip, so it
 * cannot go through ANIMATED_OBJECTS. Each emote is a PAIR of adjacent cells
 * (the bubble's two-frame bob), and only a handful are worth offering, so the
 * build crops the chosen pairs into one single-row strip the same way it crops
 * character layers — two frames per emote, in the order below.
 *
 * Keys are PERSISTED in nothing and sent on the wire, but they are validated
 * server-side against this list, so adding is free and renaming breaks the
 * client of anyone mid-session. Add, don't rename.
 */
export const EMOTE_SHEET = '4_User_Interface_Elements/UI_thinking_emotes_animation_32x32.png';

export type EmoteEntry = { key: string; col: number; row: number; label: string };

export const EMOTES: EmoteEntry[] = [
  { key: 'hey', col: 0, row: 4, label: 'Hey!' },
  { key: 'question', col: 2, row: 5, label: 'Question' },
  { key: 'building', col: 4, row: 4, label: 'Heads down' },
  { key: 'love', col: 4, row: 2, label: 'Love it' },
  { key: 'nice', col: 4, row: 6, label: 'Nice' },
  { key: 'afk', col: 6, row: 5, label: 'Back soon' },
  { key: 'music', col: 6, row: 6, label: 'Music' },
  { key: 'help', col: 0, row: 5, label: 'Need help' },
];

/**
 * The three-dot bubble, used for "someone is typing" rather than as an emote
 * anyone can pick. Same strip, appended after the emotes above.
 */
export const TYPING_FRAMES = { col: 2, row: 9 } as const;

// ---------------------------------------------------------------------------
// Character generator — the curated catalogue
// ---------------------------------------------------------------------------

export const LAYER_KEYS = ['body', 'eyes', 'outfit', 'hair', 'accessory'] as const;
export type LayerKey = (typeof LAYER_KEYS)[number];

/** Layers a character cannot exist without. hair/accessory may be null. */
export const REQUIRED_LAYER_KEYS = ['body', 'eyes', 'outfit'] as const;

/** Pack directories per layer, under PACK_DIR. */
export const LAYER_DIRS: Record<LayerKey, string> = {
  body: '2_Characters/Character_Generator/Bodies/32x32',
  eyes: '2_Characters/Character_Generator/Eyes/32x32',
  outfit: '2_Characters/Character_Generator/Outfits/32x32',
  hair: '2_Characters/Character_Generator/Hairstyles/32x32',
  accessory: '2_Characters/Character_Generator/Accessories/32x32',
};

export type CatalogEntry = {
  /** Stable id — persisted per user in the DB. Never rename or reuse one. */
  id: string;
  /** What the creator UI shows next to the live preview. */
  label: string;
  /** Source filename inside the layer's pack directory. */
  file: string;
};

const body = (n: number): CatalogEntry => ({
  id: `body_${String(n).padStart(2, '0')}`,
  label: `Tone ${n}`,
  file: `Body_32x32_${String(n).padStart(2, '0')}.png`,
});
const eyes = (n: number): CatalogEntry => ({
  id: `eyes_${String(n).padStart(2, '0')}`,
  label: `Eyes ${n}`,
  file: `Eyes_32x32_${String(n).padStart(2, '0')}.png`,
});
const outfit = (n: number, variant = 1): CatalogEntry => ({
  id: `outfit_${String(n).padStart(2, '0')}`,
  label: `Outfit ${n}`,
  file: `Outfit_${String(n).padStart(2, '0')}_32x32_${String(variant).padStart(2, '0')}.png`,
});
const hair = (style: number, colour: number): CatalogEntry => ({
  id: `hair_${String(style).padStart(2, '0')}_${String(colour).padStart(2, '0')}`,
  label: `Hair ${style}`,
  file: `Hairstyle_${String(style).padStart(2, '0')}_32x32_${String(colour).padStart(2, '0')}.png`,
});
const accessory = (n: number, name: string, label: string): CatalogEntry => ({
  id: `acc_${String(n).padStart(2, '0')}`,
  label,
  file: `Accessory_${String(n).padStart(2, '0')}_${name}_32x32_01.png`,
});

/**
 * The choices the character creator offers. A subset on purpose: the full
 * generator is 9x7x132x200x84 sheets and we will not ship 6 MB of hairstyles.
 * Growing this list is an edit + `pnpm assets:build`; ids are persisted per
 * user, so entries may be added freely but never renamed or removed once
 * anyone has chosen them.
 *
 * Hair colours cycle through the pack's 7 variants so the default palette
 * already has variety before we curate per-style colours.
 */
export const CHARACTER_CATALOG: Record<LayerKey, CatalogEntry[]> = {
  body: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(body),
  eyes: [1, 2, 3, 4, 5, 6, 7].map(eyes),
  outfit: Array.from({ length: 20 }, (_, i) => outfit(i + 1)),
  hair: Array.from({ length: 20 }, (_, i) => hair(i + 1, (i % 7) + 1)),
  accessory: [
    accessory(1, 'Ladybug', 'Ladybug'),
    accessory(2, 'Bee', 'Bee'),
    accessory(3, 'Backpack', 'Backpack'),
    accessory(4, 'Snapback', 'Snapback'),
    accessory(5, 'Dino_Snapback', 'Dino cap'),
    accessory(8, 'Detective_Hat', 'Detective hat'),
    accessory(11, 'Beanie', 'Beanie'),
    accessory(12, 'Mustache', 'Moustache'),
    accessory(13, 'Beard', 'Beard'),
    accessory(15, 'Glasses', 'Glasses'),
    accessory(16, 'Monocle', 'Monocle'),
    accessory(19, 'Party_Cone', 'Party cone'),
  ],
};

/** Where the build writes. Gitignored — nothing LimeZu-derived is committed. */
export const OUT_DIR = 'generated';
