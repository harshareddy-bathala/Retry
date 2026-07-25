import { Canvas, mix, rng, shade, type RGBA } from './canvas.js';
import {
  CLAY,
  COPPER,
  FABRIC,
  LEAF,
  METAL,
  PAPER,
  SCREEN,
  SHADOW,
  TIMBER,
  WALL,
  WALL_TOP,
  WOOD,
  WOOD_PALE,
  SAND,
  type Ramp,
} from './palette.js';

export const TILE = 32;

// One drawing function per tile. Tiles are named, not numbered: the map author
// writes `desk_l`, not `37`, so a re-ordered tileset can never silently shuffle
// the furniture. The exported TILE_NAMES array fixes the order in the sheet.

type Draw = (c: Canvas, seed: number) => void;

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/**
 * Plank floor. Boards run horizontally, 8px tall, with staggered end-joints so
 * a grid of these never shows a repeating seam — the single most obvious tell
 * of a cheap tileset.
 */
function planks(ramp: Ramp, variant: number): Draw {
  return (c, seed) => {
    const r = rng(seed + variant * 977);
    // One tone for the whole floor. Two earlier attempts gave each 8px board
    // its own shade and both read as a brick wall — at this scale, per-board
    // tone IS the brick pattern. Boards are told apart by their seam and their
    // grain, nothing else.
    c.rect(0, 0, TILE, TILE, ramp.base);
    for (let row = 0; row < 4; row++) {
      const y = row * 8;
      // Grain: long, barely-there streaks running the length of the board.
      for (let g = 0; g < 3; g++) {
        const gy = y + 1 + Math.floor(r() * 6);
        const gx = Math.floor(r() * TILE) - 8;
        c.rect(gx, gy, 10 + Math.floor(r() * 18), 1, mix(ramp.base, ramp.dark, 0.3));
      }
      // The seam: a soft shadow line with a faint catch-light under it.
      c.hline(0, y, TILE, [0, 0, 0, 38]);
      c.hline(0, y + 1, TILE, mix(ramp.base, ramp.light, 0.22));
      // At most one end-joint per tile, staggered so nothing lines up across
      // the grid — a visible column of joints is the other classic tell.
      if ((row + variant) % 3 === 0) {
        const jx = ((row * 11 + variant * 7) % 3) * 9 + 6;
        c.vline(jx, y + 2, 6, [0, 0, 0, 30]);
      }
    }
  };
}

/** Pale stone tile for the atrium threshold: 2x2 slabs with a grout line. */
const stone: Draw = (c, seed) => {
  const r = rng(seed);
  const base = mix(WOOD_PALE.light, PAPER.dark, 0.45);
  c.rect(0, 0, TILE, TILE, base);
  for (const [ox, oy] of [
    [0, 0],
    [16, 0],
    [0, 16],
    [16, 16],
  ] as const) {
    const slab = mix(base, r() < 0.5 ? PAPER.light : WOOD_PALE.base, 0.12 + r() * 0.1);
    c.rect(ox + 1, oy + 1, 14, 14, slab);
    c.hline(ox + 1, oy + 1, 14, shade(slab, 0.12));
    c.vline(ox + 1, oy + 1, 14, shade(slab, 0.12));
    c.hline(ox + 1, oy + 14, 14, shade(slab, -0.12));
    c.vline(ox + 14, oy + 1, 14, shade(slab, -0.12));
    c.speckle(ox + 2, oy + 2, 12, 12, shade(slab, -0.08), 0.06, seed + ox + oy);
  }
};

/** A rug: 3x3 of these, addressed by which edges are exposed. */
function rug(edgeTop: boolean, edgeBottom: boolean, edgeLeft: boolean, edgeRight: boolean): Draw {
  return (c, seed) => {
    // Warm sand body, copper only as trim. A rug is furniture, not a flag: the
    // first version flooded nine tiles with the UI's accent colour and pulled
    // the eye away from everything a student can actually interact with.
    const body = SAND.base;
    c.rect(0, 0, TILE, TILE, body);
    // Weave: alternating warp/weft at low contrast.
    for (let y = 0; y < TILE; y += 2) c.hline(0, y, TILE, mix(body, SAND.light, 0.14));
    for (let x = 1; x < TILE; x += 4) c.vline(x, 0, TILE, mix(body, SAND.dark, 0.12));
    c.speckle(0, 0, TILE, TILE, mix(body, SAND.dark, 0.3), 0.04, seed);
    // A single copper stripe just inside whichever edges face outward.
    const trim = COPPER.dark;
    if (edgeTop) {
      c.hline(0, 0, TILE, mix(SAND.darkest, body, 0.4));
      c.hline(0, 2, TILE, trim);
    }
    if (edgeBottom) {
      c.hline(0, TILE - 1, TILE, mix(SAND.darkest, body, 0.4));
      c.hline(0, TILE - 3, TILE, trim);
    }
    if (edgeLeft) {
      c.vline(0, 0, TILE, mix(SAND.darkest, body, 0.4));
      c.vline(2, 0, TILE, trim);
    }
    if (edgeRight) {
      c.vline(TILE - 1, 0, TILE, mix(SAND.darkest, body, 0.4));
      c.vline(TILE - 3, 0, TILE, trim);
    }
    // Fringe on the two short ends, so it reads as a rug rather than a panel.
    if (edgeLeft) for (let y = 2; y < TILE; y += 3) c.rect(0, y, 2, 1, SAND.light);
    if (edgeRight) for (let y = 2; y < TILE; y += 3) c.rect(TILE - 2, y, 2, 1, SAND.light);
    // Kilim motif on the field tiles. A rug with an empty middle reads as a
    // patch of missing floor once it is more than a couple of tiles across.
    if (!edgeTop && !edgeBottom && !edgeLeft && !edgeRight) {
      const motif = mix(SAND.darkest, COPPER.dark, 0.45);
      for (let i = 0; i < 8; i++) {
        c.rect(15 - i, 15 - i, 2, 1, motif);
        c.rect(16 + i, 15 - i, 2, 1, motif);
        c.rect(15 - i, 16 + i, 2, 1, motif);
        c.rect(16 + i, 16 + i, 2, 1, motif);
      }
      c.rect(14, 14, 4, 4, mix(SAND.light, PAPER.base, 0.3));
    }
  };
}

// ---------------------------------------------------------------------------
// Walls — 2.5D: a top face you look down on, a front face you look at
// ---------------------------------------------------------------------------

/** The flat top of a wall run. */
const wallTop: Draw = (c, seed) => {
  c.rect(0, 0, TILE, TILE, WALL_TOP.base);
  c.speckle(0, 0, TILE, TILE, WALL_TOP.light, 0.03, seed);
  c.speckle(0, 0, TILE, TILE, WALL_TOP.dark, 0.03, seed + 7);
  // The lit cap along the top edge, and the shaded inner edge where the top
  // face turns into the front face.
  c.hline(0, 0, TILE, WALL_TOP.light);
  c.hline(0, TILE - 1, TILE, WALL_TOP.darkest);
};

/**
 * The front face: plaster, a picture rail near the top, a skirting board at the
 * floor, and a contact shadow so the wall sits ON the floor rather than beside it.
 */
function wallFace(withRail: boolean): Draw {
  return (c, seed) => {
    c.rect(0, 0, TILE, TILE, WALL.base);
    c.speckle(0, 0, TILE, TILE, WALL.light, 0.03, seed);
    c.speckle(0, 0, TILE, TILE, WALL.dark, 0.03, seed + 11);
    // Light falls gently down the wall — enough to read as a lit surface, not
    // enough to turn the bottom into mud.
    for (let y = 0; y < TILE; y++) {
      c.hline(0, y, TILE, [0, 0, 0, Math.round((y / TILE) * 16)]);
    }
    if (withRail) {
      c.hline(0, 6, TILE, mix(WALL.light, PAPER.light, 0.45));
      c.hline(0, 7, TILE, mix(WALL.dark, WALL.darkest, 0.4));
    }
    // Skirting board, pale against the wall.
    c.rect(0, TILE - 5, TILE, 4, mix(WALL.light, PAPER.light, 0.4));
    c.hline(0, TILE - 5, TILE, PAPER.light);
    c.hline(0, TILE - 1, TILE, WALL.darkest);
  };
}

/** Wall face with a window: daylight, a sill, and light spilling onto the sill. */
const wallWindow: Draw = (c, seed) => {
  wallFace(false)(c, seed);
  const sky = mix(FABRIC.light, PAPER.light, 0.55);
  c.rect(5, 5, 22, 15, METAL.darkest);
  c.rect(6, 6, 20, 13, sky);
  // A hint of outside: horizon and a soft glow.
  c.rect(6, 13, 20, 6, mix(sky, LEAF.base, 0.35));
  c.rect(6, 6, 20, 3, mix(sky, PAPER.light, 0.5));
  // Frame cross.
  c.vline(15, 6, 13, mix(PAPER.base, METAL.light, 0.3));
  c.hline(6, 12, 20, mix(PAPER.base, METAL.light, 0.3));
  // Sill catching the light.
  c.rect(4, 20, 24, 2, PAPER.base);
  c.hline(4, 20, 24, PAPER.light);
  c.rect(4, 22, 24, 1, SHADOW(70));
};

/** Whiteboard mounted on the wall — the left and right halves of a 2x1 board. */
function whiteboard(half: 'l' | 'r'): Draw {
  return (c, seed) => {
    wallFace(false)(c, seed);
    // The two halves form ONE board: each draws the frame on its outer edge
    // only, so the join is invisible. Drawing a full frame per tile put a seam
    // down the middle of the board in the first pass.
    const left = half === 'l';
    const x0 = left ? 3 : 0;
    const w = TILE - 3;
    c.rect(x0, 3, w, 23, METAL.base);
    c.rect(x0 + (left ? 1 : 0), 4, w - 1, 20, PAPER.light);
    c.hline(x0 + (left ? 1 : 0), 4, w - 1, PAPER.dark); // inner top shade
    // Faint ghosts of writing so it reads as used, not showroom-new.
    const r = rng(seed);
    for (let i = 0; i < 4; i++) {
      const ly = 7 + i * 4;
      const lx = x0 + 3 + Math.floor(r() * 4);
      const len = 8 + Math.floor(r() * (w - 12));
      c.rect(lx, ly, len, 1, mix(PAPER.light, i % 2 ? FABRIC.base : COPPER.base, 0.3));
    }
    // Marker tray, and a copper marker resting on the left half.
    c.rect(x0, 24, w, 2, METAL.light);
    c.hline(x0, 24, w, PAPER.light);
    if (left) c.rect(x0 + 7, 23, 6, 1, COPPER.base);
    c.rect(x0, 26, w, 1, SHADOW(70));
  };
}

/** Door: closed and open, each 2 tiles wide. Copper frame = "you can use this". */
function door(half: 'l' | 'r', open: boolean): Draw {
  return (c, seed) => {
    // The doorway is cut into the wall face, so a door tile sits in the FACE
    // row of a wall run, not on top of it.
    wallFace(false)(c, seed);
    const left = half === 'l';
    const x0 = left ? 4 : 0;
    const w = TILE - 4;

    // A doorway is a HOLE in a wall, and the thing that sells a hole is the
    // shadow the wall's thickness casts into it. Reveal first, then a hard
    // lintel shadow across the top, then the copper architrave around it.
    c.rect(x0, 2, w, TILE - 2, mix(WALL.darkest, SCREEN.darkest, 0.55));
    c.rect(x0, 2, w, 4, SCREEN.darkest);
    if (left) c.vline(x0, 2, TILE - 2, COPPER.base);
    else c.vline(TILE - 1, 2, TILE - 2, COPPER.base);
    c.hline(x0, 2, w, COPPER.light);

    if (open) {
      // An opening you can see through: floor of the room beyond, warm light
      // spilling onto the threshold, and the leaf swung back against the jamb.
      c.rect(x0 + (left ? 1 : 0), 5, w - 1, TILE - 8, mix(WOOD.dark, SCREEN.darkest, 0.45));
      for (let y = 5; y < TILE - 3; y++) {
        const t = (y - 5) / (TILE - 8);
        c.hline(x0 + (left ? 1 : 0), y, w - 1, [226, 168, 110, Math.round(52 * t + 8)]);
      }
      // Threshold strip, brightest where the light lands.
      c.rect(x0 + (left ? 1 : 0), TILE - 3, w - 1, 3, mix(WOOD.light, COPPER.light, 0.35));
      // The open leaf, edge-on against one jamb.
      const leafX = left ? x0 + 1 : TILE - 4;
      c.rect(leafX, 5, 3, TILE - 8, TIMBER.dark);
      c.vline(leafX, 5, TILE - 8, TIMBER.light);
    } else {
      // A closed leaf, deliberately plain. Panelled joinery at 2x1 tiles read
      // as a sideboard rather than a door — the shape has to do the work, so
      // the leaf is flat, recessed, and darker than the wall around it.
      const px = x0 + (left ? 1 : 0);
      const pw = w - 1;
      // The leaf sits INSIDE the reveal, a few pixels down from the lintel, so
      // the shadow above it stays visible. That gap is the whole difference
      // between "door in a wall" and "cupboard stuck on a wall".
      c.rect(px, 6, pw, TILE - 6, TIMBER.base);
      for (let x = px; x < px + pw; x += 4) {
        c.vline(x, 7, TILE - 8, mix(TIMBER.base, TIMBER.dark, 0.55));
      }
      c.hline(px, 6, pw, TIMBER.light);
      // Cross-brace catches the light and gives the leaf a direction.
      c.rect(px, 16, pw, 2, mix(TIMBER.light, PAPER.dark, 0.25));
      // Handle on the meeting edge.
      if (left) c.rect(TILE - 5, 20, 2, 4, COPPER.light);
      else c.rect(3, 20, 2, 4, COPPER.light);
    }
    // Contact shadow on the floor below the opening.
    c.rect(x0, TILE - 1, w, 1, SHADOW(90));
  };
}

/**
 * A way out through a wall you are looking at from above (the south wall, and
 * any side wall). There is no front face to cut a door into here — you see the
 * wall's top — so the opening is a lit threshold in the dark band instead.
 */
function exit(half: 'l' | 'r'): Draw {
  return (c, seed) => {
    wallTop(c, seed);
    const left = half === 'l';
    const x0 = left ? 5 : 0;
    const w = TILE - 5;
    // The gap, floored with boards and lit from the room beyond.
    c.rect(x0, 0, w, TILE, mix(WOOD.dark, SCREEN.darkest, 0.35));
    for (let y = 0; y < TILE; y += 8) c.hline(x0, y, w, [0, 0, 0, 40]);
    for (let y = 0; y < TILE; y++) {
      c.hline(x0, y, w, [226, 168, 110, Math.round(10 + (y / TILE) * 40)]);
    }
    // Copper jambs, so it matches the doors in the Commons.
    if (left) c.vline(x0, 0, TILE, COPPER.base);
    else c.vline(TILE - 1, 0, TILE, COPPER.base);
    c.rect(x0, 0, w, 2, COPPER.darkest);
    c.rect(x0, TILE - 2, w, 2, mix(COPPER.light, PAPER.base, 0.3));
  };
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/** Desk, 2 tiles wide: timber top, metal legs, a monitor on the left half. */
function desk(half: 'l' | 'r'): Draw {
  return (c, seed) => {
    c.shadow(16, 26, 15, 5, 70);
    // Top surface with a front edge, drawn in perspective (top face + lip).
    c.rect(0, 8, TILE, 14, TIMBER.base);
    c.hline(0, 8, TILE, TIMBER.light);
    c.rect(0, 20, TILE, 2, TIMBER.dark);
    c.rect(0, 22, TILE, 2, TIMBER.darkest);
    c.speckle(0, 9, TILE, 11, mix(TIMBER.base, TIMBER.dark, 0.5), 0.05, seed);
    // Legs.
    const legX = half === 'l' ? 3 : TILE - 6;
    c.rect(legX, 24, 3, 5, METAL.dark);
    c.rect(legX, 24, 1, 5, METAL.light);

    if (half === 'l') {
      // Monitor: stand, bezel, lit screen, and the glow it throws on the desk.
      c.rect(20, 16, 6, 2, METAL.dark);
      c.rect(22, 12, 2, 4, METAL.base);
      c.rect(13, 1, 16, 12, METAL.darkest);
      c.rect(14, 2, 14, 10, SCREEN.base);
      c.rect(15, 3, 12, 8, SCREEN.dark);
      // A few lines of "code" on screen.
      const r = rng(seed);
      for (let i = 0; i < 4; i++) {
        const w = 3 + Math.floor(r() * 8);
        c.rect(16, 4 + i * 2, w, 1, i % 2 ? SCREEN.light : mix(SCREEN.light, COPPER.light, 0.5));
      }
      c.rect(13, 13, 16, 1, SHADOW(70));
      c.rect(14, 14, 14, 2, [143, 220, 201, 26]);
    } else {
      // Keyboard, mug, notebook.
      c.rect(4, 13, 14, 5, PAPER.dark);
      c.hline(4, 13, 14, PAPER.light);
      for (let i = 0; i < 6; i++) c.vline(6 + i * 2, 14, 3, mix(PAPER.dark, METAL.base, 0.4));
      c.rect(22, 12, 5, 6, PAPER.light);
      c.rect(22, 12, 5, 1, COPPER.base);
      c.rect(27, 14, 2, 3, PAPER.base); // mug handle
      c.rect(21, 11, 7, 1, SHADOW(50));
    }
  };
}

/** Chair seen from behind (tucked under a desk) and from the front. */
function chair(facing: 'up' | 'down'): Draw {
  return (c, seed) => {
    c.shadow(16, 25, 9, 4, 65);
    const seat = FABRIC.base;
    if (facing === 'up') {
      c.rect(9, 6, 14, 11, FABRIC.dark); // backrest seen from behind
      c.bevel(9, 6, 14, 11, FABRIC.base, FABRIC.darkest);
      c.rect(10, 17, 12, 5, seat);
      c.hline(10, 17, 12, FABRIC.light);
    } else {
      c.rect(10, 12, 12, 6, seat);
      c.hline(10, 12, 12, FABRIC.light);
      c.rect(9, 5, 14, 8, FABRIC.base);
      c.bevel(9, 5, 14, 8, FABRIC.light, FABRIC.darkest);
      c.rect(11, 7, 10, 4, mix(FABRIC.base, FABRIC.dark, 0.5));
    }
    // Post and star base.
    c.rect(15, 21, 2, 3, METAL.base);
    c.rect(10, 24, 12, 2, METAL.dark);
    c.rect(10, 24, 12, 1, METAL.light);
    c.speckle(0, 0, TILE, TILE, [0, 0, 0, 0], 0, seed);
  };
}

/** Sofa halves — the seating cluster in the Commons. */
function sofa(half: 'l' | 'r'): Draw {
  return (c, seed) => {
    c.shadow(16, 27, 16, 4, 70);
    // Backrest.
    c.rect(0, 4, TILE, 10, FABRIC.dark);
    c.hline(0, 4, TILE, FABRIC.base);
    // Seat cushions.
    c.rect(0, 13, TILE, 10, FABRIC.base);
    c.hline(0, 13, TILE, FABRIC.light);
    c.rect(0, 22, TILE, 2, FABRIC.darkest);
    // Cushion split in the middle of the 2-tile run.
    if (half === 'l') c.vline(TILE - 1, 14, 8, FABRIC.dark);
    else c.vline(0, 14, 8, FABRIC.dark);
    // Arm on the outer end.
    const armX = half === 'l' ? 0 : TILE - 6;
    c.rect(armX, 8, 6, 16, FABRIC.dark);
    c.bevel(armX, 8, 6, 16, FABRIC.light, FABRIC.darkest);
    // Feet.
    c.rect(half === 'l' ? 2 : TILE - 5, 24, 3, 3, TIMBER.darkest);
    c.speckle(0, 4, TILE, 19, mix(FABRIC.base, FABRIC.light, 0.4), 0.04, seed);
  };
}

/** Low table with a plant and a couple of books. */
const table: Draw = (c, seed) => {
  c.shadow(16, 26, 12, 4, 65);
  c.rect(4, 10, 24, 12, TIMBER.light);
  c.hline(4, 10, 24, mix(TIMBER.light, PAPER.light, 0.35));
  c.rect(4, 20, 24, 2, TIMBER.dark);
  c.rect(6, 22, 3, 4, TIMBER.darkest);
  c.rect(23, 22, 3, 4, TIMBER.darkest);
  // Books.
  c.rect(7, 14, 9, 4, COPPER.base);
  c.rect(7, 13, 9, 1, COPPER.light);
  c.rect(8, 12, 9, 2, FABRIC.base);
  // Mug.
  c.rect(21, 13, 5, 5, PAPER.light);
  c.rect(26, 15, 1, 2, PAPER.base);
  c.speckle(4, 11, 24, 9, mix(TIMBER.light, TIMBER.dark, 0.35), 0.05, seed);
};

/** Potted plant — the cheapest way to make a room look inhabited. */
function plant(big: boolean): Draw {
  return (c, seed) => {
    const r = rng(seed);
    c.shadow(16, 27, big ? 9 : 7, 4, 70);
    // Pot.
    const potW = big ? 14 : 11;
    const potX = 16 - potW / 2;
    c.rect(potX, 20, potW, 8, CLAY.base);
    c.bevel(potX, 20, potW, 8, CLAY.light, CLAY.darkest);
    c.rect(potX - 1, 19, potW + 2, 2, CLAY.light);
    c.rect(potX, 26, potW, 2, CLAY.darkest);
    // Foliage: overlapping leaf clusters, lit from the upper left.
    const leaves = big ? 16 : 10;
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + r() * 0.6;
      const rad = (big ? 8 : 6) * (0.55 + r() * 0.45);
      const lx = 16 + Math.cos(a) * rad;
      const ly = (big ? 12 : 14) + Math.sin(a) * rad * 0.75;
      const tone = mix(LEAF.base, a < Math.PI ? LEAF.light : LEAF.dark, 0.4 + r() * 0.3);
      c.rect(lx - 2, ly - 1, 4, 3, tone);
      c.rect(lx - 1, ly - 2, 2, 5, tone);
      c.set(lx - 2, ly - 2, mix(tone, LEAF.light, 0.5));
    }
    // Stems.
    c.vline(16, 16, 5, LEAF.darkest);
  };
}

/** Bookshelf against a wall: spines in the room's palette, never rainbow. */
const shelf: Draw = (c, seed) => {
  const r = rng(seed);
  c.shadow(16, 27, 14, 3, 70);
  c.rect(2, 2, 28, 26, TIMBER.dark);
  c.bevel(2, 2, 28, 26, TIMBER.light, TIMBER.darkest);
  c.rect(4, 4, 24, 22, shade(TIMBER.darkest, -0.25));
  for (let row = 0; row < 3; row++) {
    const y = 5 + row * 7;
    let x = 5;
    while (x < 26) {
      const w = 2 + Math.floor(r() * 2);
      if (x + w > 26) break;
      const h = 5 - Math.floor(r() * 2);
      const tone = [COPPER.base, FABRIC.base, PAPER.dark, LEAF.base, CLAY.base][
        Math.floor(r() * 5)
      ]!;
      c.rect(x, y + (6 - h), w, h, tone);
      c.vline(x, y + (6 - h), h, shade(tone, 0.25));
      x += w + 1;
    }
    c.rect(4, y + 6, 24, 1, TIMBER.base); // shelf board
  }
};

/** A rubber plant in the corner of the Commons, plus a floor lamp glow. */
const lamp: Draw = (c) => {
  c.shadow(16, 27, 7, 3, 60);
  c.rect(13, 24, 6, 3, METAL.dark);
  c.rect(15, 12, 2, 12, METAL.base);
  c.rect(15, 12, 1, 12, METAL.light);
  // Shade + the pool of light it throws.
  c.rect(9, 4, 14, 8, PAPER.dark);
  c.rect(10, 5, 12, 6, PAPER.light);
  c.bevel(9, 4, 14, 8, PAPER.light, METAL.dark);
  for (let i = 0; i < 6; i++) {
    c.rect(8 - i, 12 + i, 16 + i * 2, 1, [226, 200, 150, Math.round(30 - i * 4)]);
  }
};

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

/**
 * Tile order in the sheet. Append only — the map JSONs store gids, so
 * re-ordering this silently rearranges every room ever built.
 */
export const TILES: Array<{ name: string; draw: Draw }> = [
  // Floors
  { name: 'floor_wood_a', draw: planks(WOOD, 0) },
  { name: 'floor_wood_b', draw: planks(WOOD, 1) },
  { name: 'floor_wood_c', draw: planks(WOOD, 2) },
  { name: 'floor_pale_a', draw: planks(WOOD_PALE, 3) },
  { name: 'floor_pale_b', draw: planks(WOOD_PALE, 4) },
  { name: 'floor_stone', draw: stone },
  // Rug (3x3)
  { name: 'rug_tl', draw: rug(true, false, true, false) },
  { name: 'rug_t', draw: rug(true, false, false, false) },
  { name: 'rug_tr', draw: rug(true, false, false, true) },
  { name: 'rug_l', draw: rug(false, false, true, false) },
  { name: 'rug_c', draw: rug(false, false, false, false) },
  { name: 'rug_r', draw: rug(false, false, false, true) },
  { name: 'rug_bl', draw: rug(false, true, true, false) },
  { name: 'rug_b', draw: rug(false, true, false, false) },
  { name: 'rug_br', draw: rug(false, true, false, true) },
  // Walls
  { name: 'wall_top', draw: wallTop },
  { name: 'wall_face', draw: wallFace(true) },
  { name: 'wall_face_plain', draw: wallFace(false) },
  { name: 'wall_window', draw: wallWindow },
  { name: 'whiteboard_l', draw: whiteboard('l') },
  { name: 'whiteboard_r', draw: whiteboard('r') },
  { name: 'door_closed_l', draw: door('l', false) },
  { name: 'door_closed_r', draw: door('r', false) },
  { name: 'door_open_l', draw: door('l', true) },
  { name: 'door_open_r', draw: door('r', true) },
  { name: 'exit_l', draw: exit('l') },
  { name: 'exit_r', draw: exit('r') },
  // Furniture
  { name: 'desk_l', draw: desk('l') },
  { name: 'desk_r', draw: desk('r') },
  { name: 'chair_up', draw: chair('up') },
  { name: 'chair_down', draw: chair('down') },
  { name: 'sofa_l', draw: sofa('l') },
  { name: 'sofa_r', draw: sofa('r') },
  { name: 'table', draw: table },
  { name: 'plant_big', draw: plant(true) },
  { name: 'plant_small', draw: plant(false) },
  { name: 'shelf', draw: shelf },
  { name: 'lamp', draw: lamp },
];

export const TILE_NAMES = TILES.map((t) => t.name);
export const COLUMNS = 6;

/** Renders the whole sheet. Tile 1 in Tiled is index 0 here (firstgid = 1). */
export function renderTileset(): { canvas: Canvas; columns: number; rows: number } {
  const columns = COLUMNS;
  const rows = Math.ceil(TILES.length / columns);
  const sheet = new Canvas(columns * TILE, rows * TILE);
  TILES.forEach((tile, i) => {
    const cell = new Canvas(TILE, TILE);
    tile.draw(cell, 1000 + i * 137);
    sheet.blit(cell, (i % columns) * TILE, Math.floor(i / columns) * TILE);
  });
  return { canvas: sheet, columns, rows };
}

export type { RGBA };
