import { AVATARS, type AvatarSpec } from '../src/avatars.js';
import { Canvas, mix, rgb, shade, type RGBA } from './canvas.js';

// Six avatars a student picks by personality, not by appearance (FR-ROOM-24).
//
// The design rule: at 32px, seen from above, at game zoom, you have a
// SILHOUETTE and one colour. Faces are four pixels. So each preset gets a
// distinct headwear/accessory outline — headphones, a bun, a beanie, a
// backpack, curls, a scarf — and a distinct top colour, and those two things
// have to carry the whole character. Everything else is shading.

export const AVATAR_SIZE = 32;
export const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type Direction = (typeof DIRECTIONS)[number];
/** Column 0 is idle; 1–3 are the walk cycle (played 1,2,3,2). */
export const FRAMES = 4;

export { AVATARS };

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

type Tone = { base: RGBA; light: RGBA; dark: RGBA; line: RGBA };

const tone = (hex: string): Tone => {
  const base = rgb(hex);
  return {
    base,
    light: shade(base, 0.2),
    dark: shade(base, -0.2),
    // Outlines are a darkened version of the fill, never black: a black
    // outline at this size turns every character into a sticker.
    line: shade(base, -0.5),
  };
};

/**
 * One frame. The character is built from the feet up so later parts overlap
 * earlier ones the way they would in life — legs, torso, arms, head, hair,
 * accessory.
 */
function drawFrame(c: Canvas, spec: AvatarSpec, dir: Direction, frame: number): void {
  const skin = tone(spec.skin);
  const hair = tone(spec.hair);
  const top = tone(spec.top);
  const bottom = tone(spec.bottom);
  const shoes = tone(spec.shoes);
  const accent = rgb(spec.accent);

  // Walk cycle: frames 1 and 3 are the two strides, 0 and 2 are passing poses.
  // The body lifts a pixel mid-stride, which is what sells the walk.
  const stride = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const bob = frame === 1 || frame === 3 ? 0 : frame === 2 ? -1 : 0;
  const y0 = bob;

  const side = dir === 'left' || dir === 'right';
  const flip = dir === 'left' ? -1 : 1;
  const cx = 16;

  // Contact shadow — grounds the character on the floor.
  for (let dx = -6; dx <= 6; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const d = (dx * dx) / 36 + (dy * dy) / 4;
      if (d <= 1) c.set(cx + dx, 28 + dy, [0, 0, 0, Math.round(55 * (1 - d * 0.6))]);
    }
  }

  // --- legs -----------------------------------------------------------------
  // Proportions are deliberately not realistic: a big head on a short body is
  // what makes a 32px character read as a CHARACTER rather than a game piece.
  // Roughly 10px head : 8px torso : 7px legs.
  const legY = 21 + y0;
  if (side) {
    const front = cx - 2 + stride * 2 * flip;
    const back = cx - 2 - stride * 2 * flip;
    c.rect(back, legY, 4, 5, bottom.dark);
    c.rect(back, legY + 4, 4, 3, shoes.dark);
    c.rect(front, legY, 4, 5, bottom.base);
    c.rect(front, legY + 4, 4, 3, shoes.base);
    c.hline(front, legY + 4, 4, shoes.light);
  } else {
    c.rect(cx - 5, legY + (stride > 0 ? 1 : 0), 4, 5 - (stride > 0 ? 1 : 0), bottom.base);
    c.rect(cx + 1, legY + (stride < 0 ? 1 : 0), 4, 5 - (stride < 0 ? 1 : 0), bottom.base);
    c.rect(cx - 5, legY + 4, 4, 3, shoes.base);
    c.rect(cx + 1, legY + 4, 4, 3, shoes.base);
    c.vline(cx, legY, 7, bottom.dark);
  }

  // --- torso ----------------------------------------------------------------
  const torsoY = 14 + y0;
  const torsoH = 8;
  const torsoW = side ? 9 : 12;
  const torsoX = cx - Math.floor(torsoW / 2);
  c.rect(torsoX, torsoY, torsoW, torsoH, top.base);
  // Light from the upper left, on every character, like everything else.
  c.vline(torsoX, torsoY, torsoH, top.light);
  c.vline(torsoX + torsoW - 1, torsoY, torsoH, top.dark);
  c.hline(torsoX, torsoY, torsoW, top.light);
  c.hline(torsoX, torsoY + torsoH - 1, torsoW, top.line);
  if (!side) {
    // Collar/zip line so the front reads as clothing rather than a block.
    c.vline(cx, torsoY + 1, 5, mix(top.base, top.dark, 0.6));
    c.rect(cx - 2, torsoY, 5, 2, mix(top.light, skin.base, 0.25));
  }

  // --- arms -----------------------------------------------------------------
  const armY = torsoY + 1;
  if (side) {
    const swing = stride * 2;
    c.rect(cx - 2 + swing * flip, armY, 3, 6, top.dark);
    c.rect(cx - 2 + swing * flip, armY + 5, 3, 2, skin.base);
  } else {
    c.rect(torsoX - 2, armY - stride, 3, 6, top.dark);
    c.rect(torsoX + torsoW - 1, armY + stride, 3, 6, top.dark);
    c.rect(torsoX - 2, armY + 5 - stride, 3, 2, skin.base);
    c.rect(torsoX + torsoW - 1, armY + 5 + stride, 3, 2, skin.base);
  }

  // --- head -----------------------------------------------------------------
  const headY = 3 + y0;
  const headH = 11;
  const headW = side ? 11 : 12;
  const headX = cx - Math.floor(headW / 2) + (side ? flip : 0);
  c.rect(headX, headY, headW, headH, skin.base);
  c.hline(headX, headY, headW, skin.light);
  c.vline(headX + headW - 1, headY, headH, skin.dark);
  c.rect(headX, headY + headH, headW, 1, skin.dark); // jaw/neck shadow

  if (dir === 'down') {
    c.rect(headX + 2, headY + 5, 2, 2, hair.line);
    c.rect(headX + headW - 4, headY + 5, 2, 2, hair.line);
    c.rect(headX + 5, headY + 8, 3, 1, mix(skin.dark, hair.line, 0.4));
  } else if (side) {
    c.rect(flip > 0 ? headX + headW - 4 : headX + 2, headY + 5, 2, 2, hair.line);
    c.rect(flip > 0 ? headX + headW - 1 : headX, headY + 7, 1, 1, skin.dark);
  }

  // --- hair -----------------------------------------------------------------
  const h = spec.hairStyle;
  if (h !== 'beanie') {
    // A 4px cap over a 9px head is a helmet; 3px leaves temples and forehead,
    // which is what stops every dark-haired preset reading as the same blob.
    const capH = h === 'bun' ? 4 : 5;
    c.rect(headX - 1, headY - 1, headW + 2, capH, hair.base);
    c.hline(headX - 1, headY - 1, headW + 2, hair.light);
    if (dir === 'up') c.rect(headX - 1, headY - 1, headW + 2, headH, hair.base);
  }
  switch (h) {
    case 'short':
      c.rect(headX - 1, headY + 2, 2, 3, hair.base);
      c.rect(headX + headW - 1, headY + 2, 2, 3, hair.dark);
      break;
    case 'bun':
      // Small and set BACK on the skull. Centred and tall, it reads as a
      // bowler hat — which is exactly what the first pass produced.
      {
        const bx = dir === 'left' ? headX + headW - 4 : dir === 'right' ? headX : cx - 2;
        c.rect(bx, headY - 3, 4, 3, hair.base);
        c.hline(bx, headY - 3, 4, hair.light);
        c.rect(bx + 1, headY - 4, 2, 1, hair.base);
      }
      c.rect(headX - 1, headY + 2, 2, 4, hair.base);
      break;
    case 'beanie':
      c.rect(headX - 1, headY - 3, headW + 2, 6, accent);
      c.hline(headX - 1, headY - 3, headW + 2, shade(accent, 0.25));
      c.rect(headX - 1, headY + 1, headW + 2, 2, shade(accent, -0.2));
      c.rect(cx - 1, headY - 5, 3, 2, shade(accent, 0.2));
      break;
    case 'crop':
      c.rect(headX - 1, headY - 2, headW + 2, 4, hair.base);
      c.rect(headX + 1, headY - 3, headW - 3, 2, hair.dark);
      break;
    case 'curls':
      // Volume that hugs the skull: wider than tall, sitting ON the head. The
      // first attempt arced blobs upward and produced rabbit ears.
      c.rect(headX - 2, headY - 3, headW + 4, 5, hair.base);
      c.rect(headX - 3, headY - 1, headW + 6, 4, hair.base);
      c.hline(headX - 1, headY - 3, headW + 2, hair.light);
      for (const [bx, by] of [
        [headX - 3, headY - 2],
        [headX + 2, headY - 4],
        [headX + headW - 3, headY - 3],
        [headX + headW, headY - 1],
      ] as const) {
        c.rect(bx, by, 3, 3, hair.base);
        c.set(bx, by, hair.light);
      }
      c.rect(headX - 3, headY + 2, 3, 3, hair.dark);
      c.rect(headX + headW, headY + 2, 3, 3, hair.dark);
      break;
    case 'long':
      c.rect(headX - 2, headY - 1, headW + 4, 5, hair.base);
      c.rect(headX - 2, headY + 2, 3, 10, hair.base);
      c.rect(headX + headW - 1, headY + 2, 3, 10, hair.dark);
      c.hline(headX - 2, headY - 1, headW + 4, hair.light);
      break;
  }

  // --- the thing you actually recognise them by -----------------------------
  switch (spec.extra) {
    case 'headphones':
      // Band over the top, cups on both sides — reads from every direction.
      c.rect(headX - 2, headY - 2, headW + 4, 2, tone('#22262c').base);
      c.rect(headX - 3, headY + 1, 3, 5, tone('#2c323a').base);
      c.rect(headX + headW, headY + 1, 3, 5, tone('#2c323a').base);
      c.rect(headX - 3, headY + 2, 1, 3, accent);
      c.rect(headX + headW + 2, headY + 2, 1, 3, accent);
      break;
    case 'glasses':
      if (dir !== 'up') {
        // Pale lenses first, then dark frames: dark-on-dark against dark hair
        // is invisible at this size, which is what the first pass did.
        const gy = headY + 4;
        const lens = mix(skin.light, rgb('#cfe0e4'), 0.55);
        c.rect(headX + 2, gy + 1, 2, 2, lens);
        c.rect(headX + headW - 4, gy + 1, 2, 2, lens);
        c.frame(headX + 1, gy, 4, 4, rgb('#2b2f36'));
        c.frame(headX + headW - 5, gy, 4, 4, rgb('#2b2f36'));
        c.hline(headX + 4, gy + 1, headW - 8, rgb('#2b2f36'));
        c.set(headX + 2, gy + 1, accent);
      }
      break;
    case 'mug':
      // In the hand, not beside it: the hand is the last two pixels of the arm,
      // so the mug has to start where the arm ends or it floats.
      if (dir !== 'up') {
        const handX = side ? cx - 2 + stride * 2 * flip : torsoX + torsoW - 1;
        const handY = side ? armY + 6 : armY + 6 + stride;
        c.rect(handX - 1, handY - 1, 5, 5, rgb('#e8e4da'));
        c.hline(handX - 1, handY - 1, 5, rgb('#f5f2ec'));
        c.vline(handX + 3, handY - 1, 5, rgb('#cfc9bd'));
        c.rect(handX, handY, 3, 1, rgb('#6b4a32'));
        // Steam, so it reads as coffee rather than a white box.
        c.set(handX + 1, handY - 3, [255, 255, 255, 70]);
        c.set(handX + 2, handY - 5, [255, 255, 255, 45]);
      }
      break;
    case 'backpack':
      // Straps in front, pack behind — so it reads walking away too.
      if (dir === 'up') {
        c.rect(torsoX + 1, torsoY + 1, torsoW - 2, 8, tone('#3f4a3a').base);
        c.rect(torsoX + 1, torsoY + 1, torsoW - 2, 1, tone('#4f5c48').base);
        c.rect(torsoX + 3, torsoY + 4, torsoW - 6, 3, accent);
      } else if (side) {
        // A pack has depth: it sticks out behind the shoulders, above the hip.
        const px = flip > 0 ? torsoX - 4 : torsoX + torsoW;
        c.rect(px, torsoY, 4, 9, tone('#3f4a3a').base);
        c.hline(px, torsoY, 4, tone('#54634c').base);
        c.rect(px, torsoY + 3, 4, 2, accent);
        c.rect(px + (flip > 0 ? 3 : 0), torsoY + 1, 1, 7, tone('#2c352a').base);
      } else {
        // Straps over both shoulders, and the top of the pack showing above them.
        c.rect(torsoX + 1, torsoY - 2, torsoW - 2, 2, tone('#3f4a3a').base);
        c.vline(torsoX + 2, torsoY, 8, accent);
        c.vline(torsoX + torsoW - 3, torsoY, 8, accent);
        c.set(torsoX + 2, torsoY + 4, shade(accent, -0.3));
        c.set(torsoX + torsoW - 3, torsoY + 4, shade(accent, -0.3));
      }
      break;
    case 'tool':
      // A spanner in one hand and rolled sleeves.
      c.rect(torsoX - 2, armY + 3, 3, 3, skin.base);
      if (dir !== 'up') {
        const tx = side ? cx + 3 * flip : torsoX - 3;
        c.rect(tx, armY + 7, 2, 5, rgb('#8d959f'));
        c.rect(tx - 1, armY + 6, 4, 2, rgb('#b3bcc7'));
      }
      break;
    case 'scarf':
      c.rect(torsoX - 1, torsoY - 1, torsoW + 2, 3, accent);
      c.hline(torsoX - 1, torsoY - 1, torsoW + 2, shade(accent, 0.25));
      if (dir !== 'up') c.rect(torsoX + torsoW - 3, torsoY + 2, 3, 6, shade(accent, -0.12));
      break;
  }
}

/** One 128x128 sheet: 4 columns (idle + 3 walk) by 4 rows (down/left/right/up). */
export function renderAvatar(spec: AvatarSpec): Canvas {
  const sheet = new Canvas(AVATAR_SIZE * FRAMES, AVATAR_SIZE * DIRECTIONS.length);
  DIRECTIONS.forEach((dir, row) => {
    for (let frame = 0; frame < FRAMES; frame++) {
      const cell = new Canvas(AVATAR_SIZE, AVATAR_SIZE);
      drawFrame(cell, spec, dir, frame);
      sheet.blit(cell, frame * AVATAR_SIZE, row * AVATAR_SIZE);
    }
  });
  return sheet;
}
