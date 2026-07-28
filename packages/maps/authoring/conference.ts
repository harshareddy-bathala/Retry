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

// The Conference Hall — a room with a stage and an audience.
//
//   pnpm --filter @retry/maps author conference
//
// This is the only room where the zones do real work. The stage is a
// `spotlight`: stand on it and the whole map hears you, which is the entire
// point of demo day and is impossible under plain proximity audio — a presenter
// five tiles from the back row is inaudible to it.
//
// The audience block is a `audience` zone, which is client-side only: it tells
// the camera to favour the stage. The green room behind is `quiet`, so the next
// two presenters can argue about their slides while someone else is talking.

const stage: Piece = { sheet: 'conference', col: 5, row: 7, w: 5, h: 3, solidRows: 0 };
const screen: Piece = {
  sheet: 'conference', col: 0, row: 8, w: 5, h: 3, solidRows: 1, aboveRows: 2,
};
const boardroom: Piece = { sheet: 'conference', col: 0, row: 4, w: 5, h: 2, solidRows: 2 };
// An audience chair is walked onto, not walked around: solidRows 0, and the
// seat sits on its lower tile.
const chair: Piece = { sheet: 'conference', col: 11, row: 6, w: 1, h: 2, solidRows: 0, aboveRows: 1 };
const bannerRed: Piece = {
  sheet: 'conference', col: 5, row: 4, w: 1, h: 2, solidRows: 1, aboveRows: 1,
};
const bannerBlue: Piece = {
  sheet: 'conference', col: 7, row: 4, w: 1, h: 2, solidRows: 1, aboveRows: 1,
};
const bar: Piece = { sheet: 'conference', col: 9, row: 5, w: 4, h: 1 };
const cooler: Piece = {
  sheet: 'conference', col: 14, row: 8, w: 1, h: 3, solidRows: 1, aboveRows: 2,
};
const pot: Piece = { sheet: 'conference', col: 11, row: 8, w: 1, h: 2, solidRows: 1, aboveRows: 1 };
const plant: Piece = { sheet: 'livingroom', col: 11, row: 1, w: 1, h: 2, solidRows: 1, aboveRows: 1 };

const W = 26;
const H = 22;

export function build(): void {
  const map = loadMap('conference');
  blank(map);
  resize(map, W, H);

  const hall = { x: 0, y: 0, w: W, h: 16 };
  const greenRoom = { x: 7, y: 14, w: 12, h: 8 };

  shell(map, hall, 'plaster');
  shell(map, greenRoom, 'plaster');
  opening(map, 8, 14, 10, 2);

  const hi = interior(hall);
  const gi = interior(greenRoom);
  floor(map, 'cream', hi.x, hi.y, hi.w, hi.h);
  floor(map, 'green', gi.x, gi.y, gi.w, gi.h);
  floor(map, 'green', 8, 14, 10, 2);
  // The stage floor is a different material, so it reads as raised even before
  // anyone stands on it.
  floor(map, 'carpetBlue', 9, 2, 8, 4);

  seal(map);
  castShadows(map);

  // --- the stage
  place(map, screen, 10, 2);
  interactable(map, 'whiteboard', 'whiteboard', 10, 2, 5, 3, 'Open the whiteboard');
  place(map, stage, 10, 5);
  interactable(map, 'podium', 'podium', 10, 5, 5, 3, 'Take the stage');
  place(map, bannerRed, 8, 2);
  place(map, bannerBlue, 17, 2);
  zone(map, 'spotlight', 'the stage', 10, 5, 5, 3);

  // --- the audience: three rows of chairs with an aisle
  for (const y of [9, 12]) {
    for (const x of [3, 4, 5, 6, 8, 9, 10, 11, 14, 15, 16, 17, 19, 20, 21, 22]) {
      place(map, chair, x, y);
      seat(map, x, y + 1, 'up');
    }
  }
  zone(map, 'audience', 'the floor', 2, 8, 22, 6);

  // --- the edges
  place(map, boardroom, 1, 2);
  seat(map, 1, 4, 'up');
  seat(map, 2, 4, 'up');
  place(map, bar, 20, 4);
  place(map, cooler, 24, 2);
  place(map, plant, 1, 12);
  place(map, plant, 24, 12);
  place(map, pot, 7, 6);
  place(map, pot, 18, 6);

  // --- the green room
  place(map, boardroom, 9, 16);
  seat(map, 9, 18, 'up');
  seat(map, 10, 18, 'up');
  seat(map, 11, 18, 'up');
  place(map, chair, 15, 17);
  place(map, chair, 16, 17);
  seat(map, 15, 18, 'up');
  seat(map, 16, 18, 'up');
  zone(map, 'quiet', 'green room', 8, 16, 10, 4);

  animated(map, 'sprout', 8, 12);
  animated(map, 'cat', 17, 12);

  interactable(map, 'exit', 'exit', 2, 12, 2, 1, 'Leave the hall');
  spawn(map, 'default', 13, 12);
  spawn(map, 'west', 3, 7);
  spawn(map, 'east', 22, 7);
  spawn(map, 'backstage', 13, 19);

  const dropped = dropUnusedTilesets(map);
  save(map, 'conference');
  console.log(`conference: ${W}x${H}${dropped.length > 0 ? ` (dropped ${dropped.join(', ')})` : ''}`);
}
