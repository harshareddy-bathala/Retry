// Character selections — the shared contract between the creator UI, the wire
// protocol, the room server's validation and the database.
//
// A student builds a character from the pack's generator layers (FR-ROOM-24,
// grown from six presets into a full creator). The persisted and wire value is
// a CANONICAL STRING, not an object:
//
//   body_03|eyes_02|outfit_07|hair_04_04|acc_11
//
// Five '|'-separated segments in fixed layer order; hair and accessory may be
// empty. One string keeps every schema that already carried `sprite: string`
// intact, gives the renderer a ready-made texture-cache key, and makes
// equality "same appearance" by construction. Layer ids come from the curated
// catalogue in assets.config.ts — they are persisted per user, so entries may
// be added but never renamed or removed once anyone has chosen them.

import { CHARACTER_CATALOG, LAYER_KEYS, type LayerKey } from '../assets.config.js';

export type AvatarSelection = {
  body: string;
  eyes: string;
  outfit: string;
  hair: string | null;
  accessory: string | null;
};

const byLayer = <T>(build: (k: LayerKey) => T): Record<LayerKey, T> => {
  const out = {} as Record<LayerKey, T>;
  for (const k of LAYER_KEYS) out[k] = build(k);
  return out;
};

/** Valid ids per layer, from the curated catalogue (present without the pack). */
export const AVATAR_LAYER_IDS: Record<LayerKey, readonly string[]> = byLayer((k) =>
  CHARACTER_CATALOG[k].map((e) => e.id),
);

const idSets = byLayer((k) => new Set(AVATAR_LAYER_IDS[k]));

export function encodeAvatar(sel: AvatarSelection): string {
  return [sel.body, sel.eyes, sel.outfit, sel.hair ?? '', sel.accessory ?? ''].join('|');
}

/** Parse and validate a wire/DB value. Null for anything not exactly canonical. */
export function decodeAvatar(value: unknown): AvatarSelection | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('|');
  if (parts.length !== 5) return null;
  const [body, eyes, outfit, hair, accessory] = parts as [string, string, string, string, string];
  if (!idSets.body.has(body) || !idSets.eyes.has(eyes) || !idSets.outfit.has(outfit)) return null;
  if (hair !== '' && !idSets.hair.has(hair)) return null;
  if (accessory !== '' && !idSets.accessory.has(accessory)) return null;
  return { body, eyes, outfit, hair: hair === '' ? null : hair, accessory: accessory === '' ? null : accessory };
}

export function isAvatarSprite(value: unknown): value is string {
  return decodeAvatar(value) !== null;
}

/** Longest legal encoding, for wire schema bounds. Currently 43 chars. */
export const MAX_SPRITE_LENGTH = 80;

// ---------------------------------------------------------------------------
// Presets — starting points in the creator, and the personalities the first
// cohort picked from. The names and blurbs predate the creator and are worth
// keeping: a blank character grid is a colder welcome than "who are you?".
// ---------------------------------------------------------------------------

export type AvatarPreset = {
  /** Historic key — migration 0006 maps these onto selections. */
  key: string;
  name: string;
  blurb: string;
  selection: AvatarSelection;
};

const sel = (
  body: number,
  eyes: number,
  outfit: number,
  hair: [number, number] | null,
  accessory: number | null,
): AvatarSelection => ({
  body: `body_${String(body).padStart(2, '0')}`,
  eyes: `eyes_${String(eyes).padStart(2, '0')}`,
  outfit: `outfit_${String(outfit).padStart(2, '0')}`,
  hair: hair ? `hair_${String(hair[0]).padStart(2, '0')}_${String(hair[1]).padStart(2, '0')}` : null,
  accessory: accessory ? `acc_${String(accessory).padStart(2, '0')}` : null,
});

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    key: 'maker',
    name: 'The Maker',
    blurb: 'Happiest mid-build, headphones on, three tabs of documentation open.',
    selection: sel(4, 2, 6, [2, 2], 4),
  },
  {
    key: 'planner',
    name: 'The Planner',
    blurb: 'Owns the whiteboard. Turns "we should" into a list with dates on it.',
    selection: sel(6, 3, 12, [7, 7], 15),
  },
  {
    key: 'nightowl',
    name: 'The Night Owl',
    blurb: 'Peaks at 2am. Will have fixed it by the time everyone else wakes up.',
    selection: sel(2, 5, 15, [11, 4], 11),
  },
  {
    key: 'explorer',
    name: 'The Explorer',
    blurb: 'First to try the thing nobody has tried, and to report back honestly.',
    selection: sel(5, 1, 3, [14, 7], 3),
  },
  {
    key: 'tinkerer',
    name: 'The Tinkerer',
    blurb: 'Takes it apart to see how it works. Usually gets it back together.',
    selection: sel(7, 4, 9, [17, 3], 16),
  },
  {
    key: 'connector',
    name: 'The Connector',
    blurb: 'Knows everyone, notices who has gone quiet, makes a group into a team.',
    selection: sel(3, 6, 18, [20, 6], null),
  },
];

/** What anyone who has never chosen walks around as. */
export const DEFAULT_SPRITE = encodeAvatar(AVATAR_PRESETS[0]!.selection);
