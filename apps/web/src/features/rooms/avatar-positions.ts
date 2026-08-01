// Per-frame world data, written by the Phaser scene and read by React's rAF
// loops. A plain module store (no React, no Phaser imports) so neither side
// depends on the other — per-frame data flows here; discrete events flow over
// the EventBus.

/** Canvas-space avatar anchors, read by the bubble overlay. */
export const avatarScreenPositions = new Map<string, { x: number; y: number }>();

/**
 * Avatar positions in TILE coordinates, read by the minimap. Screen positions
 * are useless to it: the minimap draws the whole room, most of which is off
 * screen, which is the entire reason it exists.
 */
export const avatarTilePositions = new Map<string, { x: number; y: number }>();

/**
 * The current map, published once per world build rather than per frame.
 * `blocked` is a row-major grid of the collision layer — the minimap draws
 * walls and furniture from it so the shape of the room is legible, not just a
 * scatter of dots in a rectangle.
 */
export type MinimapWorld = {
  width: number;
  height: number;
  blocked: Uint8Array;
};

export const minimapWorld = { current: null as MinimapWorld | null };
