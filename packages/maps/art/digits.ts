import type { Canvas, RGBA } from './canvas.js';

// A 3x5 pixel font, digits only. Exists so sheet previews can label each tile
// with its index — picking furniture out of a 40-row sheet by counting rows is
// how you end up with a chair where a door should be.

const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  ',': ['000', '000', '000', '010', '100'],
  ':': ['000', '010', '000', '010', '000'],
};

export function drawText(c: Canvas, text: string, x: number, y: number, colour: RGBA): void {
  let cursor = x;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) {
      cursor += 4;
      continue;
    }
    glyph.forEach((row, dy) => {
      [...row].forEach((on, dx) => {
        if (on === '1') c.set(cursor + dx, y + dy, colour);
      });
    });
    cursor += 4;
  }
}

export const textWidth = (text: string): number => text.length * 4;
