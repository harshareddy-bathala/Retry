import { rgb, type RGBA } from './canvas.js';

// Art direction for the Retry world.
//
// The world sits inside a dark, warm UI whose accent is copper (#e2935e in
// theme.css). So: warm oak floors, muted sage-grey walls, teal fabric, and
// copper reserved for things a student can act on — doors, the whiteboard, the
// rug that marks the middle of the Commons. Nothing is fully saturated and
// nothing is pure black or white; every ramp is four steps so shading stays
// consistent across the whole set.
//
// Light comes from the upper left, everywhere, always.

export type Ramp = { darkest: RGBA; dark: RGBA; base: RGBA; light: RGBA };

const ramp = (darkest: string, dark: string, base: string, light: string): Ramp => ({
  darkest: rgb(darkest),
  dark: rgb(dark),
  base: rgb(base),
  light: rgb(light),
});

/** Warm oak planks — the default floor of every room. Low internal contrast:
 *  a floor is a background, and boards that fight each other read as brickwork. */
export const WOOD = ramp('#7d5a3f', '#8e6949', '#9c7553', '#ac8462');
/** Paler boards for the Commons atrium, so the two maps read differently. */
export const WOOD_PALE = ramp('#93765a', '#a68868', '#b59674', '#c4a684');
/** Painted plaster walls, muted sage. Light enough to read as a lit surface. */
export const WALL = ramp('#4a5952', '#61736a', '#7a8d83', '#94a79b');
/** The top face of a wall, seen from above: cooler and darker, but not black. */
export const WALL_TOP = ramp('#28312e', '#333f3a', '#404e48', '#4e5e57');
/** Rugs: warm sand, so the copper border reads as trim rather than a flood. */
export const SAND = ramp('#7a6244', '#8f7454', '#a48865', '#b89b77');
/** Copper — doors, the rug, anything the world wants you to touch. */
export const COPPER = ramp('#7d4227', '#a35a34', '#c47747', '#e2935e');
/** Desks, shelves, table tops: a lighter, yellower wood than the floor. */
export const TIMBER = ramp('#795334', '#996b45', '#b48457', '#cda071');
/** Chair frames, monitor arms, bins. */
export const METAL = ramp('#2b3037', '#3d444d', '#525b66', '#6d7783');
/** Sofa and chair upholstery. */
export const FABRIC = ramp('#1f4144', '#2c585d', '#3c7278', '#4f8f95');
/** Foliage. */
export const LEAF = ramp('#24432e', '#33553a', '#437049', '#5a8d5c');
/** Terracotta pots. */
export const CLAY = ramp('#6a3b28', '#8a4f35', '#a56445', '#bd7d5b');
/** Paper, whiteboards, mugs — never pure white. */
export const PAPER = ramp('#b8b3a8', '#d0ccc2', '#e4e1d8', '#f2f0ea');
/** Screens: dark glass with a cyan glow when lit. */
export const SCREEN = ramp('#12181d', '#1b242b', '#28343d', '#8fdcc9');

export const SHADOW = (alpha: number): RGBA => [0, 0, 0, alpha];
