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

// The Classroom — a room that has a front.
//
//   pnpm --filter @retry/maps author classroom
//
// Everything points north at the board, which is the one thing a teaching room
// needs and the old rectangle did not have: standing at the front of this room
// means something, because there is a front.
//
// The south-west wing is the reading corner — a `quiet` zone, so the two people
// who wanted to talk something through can do it without the whole class
// hearing, and without leaving.

const desk: Piece = { sheet: 'classroom', col: 1, row: 1, w: 2, h: 2 };
const lectern: Piece = { sheet: 'classroom', col: 5, row: 1, w: 2, h: 2 };
const board: Piece = { sheet: 'classroom', col: 10, row: 3, w: 2, h: 2, solidRows: 1, aboveRows: 1 };
const bigBoard: Piece = {
  sheet: 'classroom', col: 13, row: 5, w: 2, h: 2, solidRows: 1, aboveRows: 1,
};
const shelf: Piece = { sheet: 'classroom', col: 0, row: 13, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const shelf2: Piece = { sheet: 'classroom', col: 2, row: 13, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const shelf3: Piece = { sheet: 'classroom', col: 4, row: 13, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const cork: Piece = { sheet: 'classroom', col: 0, row: 6, w: 2, h: 1, solidRows: 1 };
const globe: Piece = { sheet: 'classroom', col: 13, row: 1, w: 1, h: 2, solidRows: 1, aboveRows: 1 };
const plant: Piece = { sheet: 'livingroom', col: 11, row: 1, w: 1, h: 2, solidRows: 1, aboveRows: 1 };
// solidRows 0 because you SIT here. A seat marks a tile the server teleports
// an avatar onto, and it validates that tile against collision — so a chair
// that blocks movement is a chair nobody can use.
const armchair: Piece = { sheet: 'livingroom', col: 2, row: 5, w: 2, h: 2, solidRows: 0 };

const W = 24;
const H = 20;

export function build(): void {
  const map = loadMap('classroom');
  blank(map);
  resize(map, W, H);

  const hall = { x: 0, y: 0, w: W, h: 14 };
  const wing = { x: 0, y: 12, w: 11, h: 8 };

  shell(map, hall, 'wood');
  shell(map, wing, 'wood');
  opening(map, 1, 12, 9, 2);

  const hi = interior(hall);
  const wi = interior(wing);
  floor(map, 'sand', hi.x, hi.y, hi.w, hi.h);
  floor(map, 'carpetYellow', wi.x, wi.y, wi.w, wi.h);
  floor(map, 'carpetYellow', 1, 12, 9, 2);

  seal(map);
  castShadows(map);

  // --- the front of the room
  place(map, bigBoard, 8, 2);
  place(map, board, 11, 2);
  interactable(map, 'whiteboard', 'whiteboard', 8, 2, 5, 3, 'Open the whiteboard');
  place(map, lectern, 14, 3);
  interactable(map, 'podium', 'podium', 14, 3, 2, 2, 'Take the floor');
  seat(map, 14, 5, 'up');
  place(map, cork, 2, 2);
  place(map, globe, 21, 2);

  // --- three rows of desks, all facing the board
  for (const y of [6, 9]) {
    for (let i = 0; i < 5; i++) {
      const x = 2 + i * 4;
      place(map, desk, x, y);
      seat(map, x, y + 2, 'up');
      seat(map, x + 1, y + 2, 'up');
    }
  }

  // --- the reading corner
  place(map, shelf, 1, 14);
  place(map, shelf2, 3, 14);
  place(map, shelf3, 5, 14);
  place(map, armchair, 7, 16);
  seat(map, 7, 16, 'up');
  seat(map, 8, 16, 'up');
  zone(map, 'quiet', 'reading corner', 1, 14, 9, 4);
  zone(map, 'audience', 'the floor', 2, 5, 20, 6);

  place(map, plant, 22, 10);
  animated(map, 'sprout', 21, 11);
  animated(map, 'cat', 4, 11);

  interactable(map, 'exit', 'exit', 20, 11, 2, 1, 'Leave the classroom');
  spawn(map, 'default', 12, 11);
  spawn(map, 'back', 18, 11);
  spawn(map, 'front', 5, 5);
  spawn(map, 'corner', 9, 17);

  const dropped = dropUnusedTilesets(map);
  save(map, 'classroom');
  console.log(`classroom: ${W}x${H}${dropped.length > 0 ? ` (dropped ${dropped.join(', ')})` : ''}`);
}
