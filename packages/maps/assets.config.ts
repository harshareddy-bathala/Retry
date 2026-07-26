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

/** Every generator layer is this grid; bodies are wider and get cropped to it. */
export const CHAR_SHEET = { columns: 56, rows: 20 } as const;

type Sheet = { key: string; file: string; note: string };

/**
 * Tilesets we draw rooms from. Deliberately NOT `Interiors_32x32.png`: at
 * 512x34,048 it is taller than the 16,384px texture limit on a lot of GPUs and
 * mobile chips, and would fail to upload as a single WebGL texture. The
 * per-theme sheets top out at 512x3,904.
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
];

/**
 * Character layers, composited in the pack's documented order:
 * body → eyes → outfit → hairstyle → accessory.
 *
 * `take` is a count taken from the front of the sorted list, or 'all'. We do
 * not need 200 hairstyles in the bundle to give a student a real choice, and
 * every sheet we take is 50 kB before cropping.
 */
export const CHARACTER_LAYERS = [
  { key: 'body', dir: '2_Characters/Character_Generator/Bodies/32x32', take: 'all' as const },
  { key: 'eyes', dir: '2_Characters/Character_Generator/Eyes/32x32', take: 'all' as const },
  { key: 'outfit', dir: '2_Characters/Character_Generator/Outfits/32x32', take: 24 },
  { key: 'hair', dir: '2_Characters/Character_Generator/Hairstyles/32x32', take: 24 },
  { key: 'accessory', dir: '2_Characters/Character_Generator/Accessories/32x32', take: 12 },
];

/** Where the build writes. Gitignored — nothing LimeZu-derived is committed. */
export const OUT_DIR = 'generated';
