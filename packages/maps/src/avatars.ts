// The six avatars a student picks by personality (FR-ROOM-24).
//
// Runtime data — the picker renders it, the room server validates against it,
// and `key` is stored per member. Adding a preset is safe; renaming or
// reordering keys is not, because they are written to the database.

type Hair = 'short' | 'bun' | 'beanie' | 'crop' | 'curls' | 'long';
type Extra = 'headphones' | 'glasses' | 'mug' | 'backpack' | 'tool' | 'scarf';

export type AvatarSpec = {
  /** Stable wire value. Never renumbered — it is stored per member. */
  key: string;
  name: string;
  /** Shown in the picker; this is what a student actually chooses on. */
  blurb: string;
  skin: string;
  hair: string;
  hairStyle: Hair;
  top: string;
  bottom: string;
  shoes: string;
  accent: string;
  extra: Extra;
};

export const AVATARS: AvatarSpec[] = [
  {
    key: 'maker',
    name: 'The Maker',
    blurb: 'Happiest mid-build, headphones on, three tabs of documentation open.',
    skin: '#c98d63',
    hair: '#2f2318',
    hairStyle: 'short',
    top: '#c9622f',
    bottom: '#3b4350',
    shoes: '#25292f',
    accent: '#f0a870',
    extra: 'headphones',
  },
  {
    key: 'planner',
    name: 'The Planner',
    blurb: 'Owns the whiteboard. Turns "we should" into a list with dates on it.',
    skin: '#8d5a3b',
    hair: '#1e1a17',
    hairStyle: 'bun',
    top: '#2f7f86',
    bottom: '#37414d',
    shoes: '#1f242a',
    accent: '#a8d8db',
    extra: 'glasses',
  },
  {
    key: 'nightowl',
    name: 'The Night Owl',
    blurb: 'Peaks at 2am. Will have fixed it by the time everyone else wakes up.',
    skin: '#e0b088',
    hair: '#3a2d24',
    hairStyle: 'beanie',
    top: '#3f4a7a',
    bottom: '#2b3040',
    shoes: '#1b1f26',
    accent: '#8f9ede',
    extra: 'mug',
  },
  {
    key: 'explorer',
    name: 'The Explorer',
    blurb: 'First to try the thing nobody has tried, and to report back honestly.',
    skin: '#a8703f',
    hair: '#4a2c18',
    hairStyle: 'crop',
    top: '#4d7c46',
    bottom: '#5a4a35',
    shoes: '#33291d',
    accent: '#a5cf8f',
    extra: 'backpack',
  },
  {
    key: 'tinkerer',
    name: 'The Tinkerer',
    blurb: 'Takes it apart to see how it works. Usually gets it back together.',
    skin: '#6f4426',
    hair: '#241a12',
    hairStyle: 'curls',
    top: '#a8562f',
    bottom: '#4c5560',
    shoes: '#2a2f36',
    accent: '#e2935e',
    extra: 'tool',
  },
  {
    key: 'connector',
    name: 'The Connector',
    blurb: 'Knows everyone, notices who has gone quiet, makes a group into a team.',
    skin: '#d99f74',
    hair: '#5c2f2a',
    hairStyle: 'long',
    top: '#a44a72',
    bottom: '#3d3a4a',
    shoes: '#262230',
    accent: '#e9a9c4',
    extra: 'scarf',
  },
];

export const AVATAR_KEYS: readonly string[] = AVATARS.map((a) => a.key);

/** The default for anyone who has not chosen yet, and the fallback for junk. */
export const DEFAULT_AVATAR = AVATARS[0]!.key;

export function isAvatarKey(value: unknown): value is string {
  return typeof value === 'string' && AVATAR_KEYS.includes(value);
}
