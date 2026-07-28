import { dropUnusedTilesets, loadMap, resize, save } from '../src/tiled.js';
import {
  animated,
  blank,
  castShadows,
  floor,
  interactable,
  interior,
  opening,
  place,
  seal,
  seat,
  shell,
  spawn,
  zone,
  type Piece,
} from './kit.js';

// The Studio — where a project team actually works.
//
//   pnpm --filter @retry/maps author studio_a
//
// A hall with a south alcove, so the room has a corner you can be around rather
// than a rectangle everyone stands in the middle of. The alcove is the pairing
// end: two booths, deliberately out of earshot of the main floor once the
// server enforces `booth`.
//
// This script is disposable. The map it writes is not — open the JSON in Tiled,
// nudge a chair, and nothing here erases it unless someone re-runs the script
// on purpose.

const desk: Piece = { sheet: 'classroom', col: 1, row: 1, w: 2, h: 2 };
const teacherDesk: Piece = { sheet: 'classroom', col: 5, row: 1, w: 2, h: 2 };
const board: Piece = { sheet: 'classroom', col: 10, row: 3, w: 2, h: 2, solidRows: 1, aboveRows: 1 };
const shelf: Piece = { sheet: 'classroom', col: 0, row: 13, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const shelf2: Piece = { sheet: 'classroom', col: 4, row: 13, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const printer: Piece = { sheet: 'classroom', col: 3, row: 10, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const plant: Piece = { sheet: 'livingroom', col: 11, row: 1, w: 1, h: 2, solidRows: 1, aboveRows: 1 };
const locker: Piece = { sheet: 'classroom', col: 12, row: 5, w: 1, h: 2, solidRows: 1, aboveRows: 1 };

const W = 24;
const H = 20;

export function build(): void {
  const map = loadMap('studio_a');
  blank(map);
  resize(map, W, H);

  const hall = { x: 0, y: 0, w: W, h: 14 };
  const alcove = { x: 5, y: 12, w: 12, h: 8 };

  shell(map, hall, 'plaster');
  shell(map, alcove, 'plaster');
  // The alcove's north wall and the hall's south wall occupy the same two rows,
  // and they are not the same wall: one is drawn from the north side (cap over
  // face) and the other from the south (face over cap). Overlapping them leaves
  // a slab of wall floating inside the alcove. So the shared span is cut away
  // entirely and the two rooms become one T-shaped space — which is what the
  // alcove was for. What is left of the hall's south wall is only the part that
  // really is an outside wall.
  opening(map, 6, 12, 10, 2);

  const hi = interior(hall);
  const ai = interior(alcove);
  floor(map, 'cream', hi.x, hi.y, hi.w, hi.h);
  floor(map, 'carpetBlue', ai.x, ai.y, ai.w, ai.h);
  // The cut tiles were wall on both shells, so they have no floor of their own
  // until it is put back. The carpet runs up through the opening, which is what
  // makes the alcove read as its own place from the far side of the hall.
  floor(map, 'carpetBlue', 6, 12, 10, 2);

  // Seal the void and cast shadows HERE, before a single piece of furniture —
  // so the shadows are the building's, and the furniture keeps the contact
  // shadows the pack drew for it.
  seal(map);
  castShadows(map);

  // --- the north wall: the board everyone looks at, and the kit beside it
  place(map, board, 10, 2);
  interactable(map, 'whiteboard', 'whiteboard', 9, 2, 4, 3, 'Open the whiteboard');
  place(map, printer, 2, 2);
  place(map, shelf, 5, 2);
  place(map, shelf2, 17, 2);
  place(map, locker, 21, 2);

  // --- two facing rows of desks with a gangway between them
  for (const y of [5, 8]) {
    for (let i = 0; i < 4; i++) {
      const x = 3 + i * 5;
      place(map, desk, x, y);
      // Seats sit south of the desk facing north, so a seated avatar looks at
      // their work rather than out of the screen.
      seat(map, x, y + 2, 'up');
      seat(map, x + 1, y + 2, 'up');
    }
  }
  place(map, teacherDesk, 20, 6);
  seat(map, 20, 8, 'up');

  // --- the alcove: two booths, each its own audio island
  place(map, desk, 7, 15);
  seat(map, 7, 17, 'up');
  seat(map, 8, 17, 'up');
  place(map, desk, 13, 15);
  seat(map, 13, 17, 'up');
  seat(map, 14, 17, 'up');
  zone(map, 'booth', 'west booth', 6, 14, 4, 4);
  zone(map, 'booth', 'east booth', 12, 14, 4, 4);
  zone(map, 'whiteboard', 'board', 8, 4, 6, 3);

  place(map, plant, 1, 10);
  place(map, plant, 22, 10);
  animated(map, 'server', 22, 4);
  animated(map, 'sprout', 1, 4);
  animated(map, 'cat', 15, 11);

  // --- ways in and out
  interactable(map, 'exit', 'exit', 10, 17, 2, 1, 'Leave the studio');
  spawn(map, 'default', 11, 11);
  spawn(map, 'north', 8, 4);
  spawn(map, 'east', 18, 11);
  spawn(map, 'alcove', 11, 15);

  const dropped = dropUnusedTilesets(map);
  save(map, 'studio_a');
  console.log(`studio_a: ${W}x${H}${dropped.length > 0 ? ` (dropped ${dropped.join(', ')})` : ''}`);
}
