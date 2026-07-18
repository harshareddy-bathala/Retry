// Canvas-space avatar positions, written by the Phaser scene every frame and
// read by the React bubble overlay's rAF loop. A plain module store (no React,
// no Phaser imports) so neither side depends on the other — per-frame data
// flows here; discrete events flow over the EventBus.
export const avatarScreenPositions = new Map<string, { x: number; y: number }>();
