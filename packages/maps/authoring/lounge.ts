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

// The Lounge — the room where nobody is working.
//
//   pnpm --filter @retry/maps author lounge
//
// A real bar run along the north wall, seating grouped into three separate
// conversations rather than one ring of chairs, and a south-east snug.
//
// The seating groups are the whole design. Proximity audio turns furniture into
// social structure: four chairs round one table is one conversation, and two
// tables six tiles apart is two. The old lounge had its chairs in a line
// against the wall, which is one enormous conversation nobody can leave.

// A counter run is ONE tile tall on this sheet — worktop lip and cabinet door
// in the same 32px. The first guess here was row 10 col 12, which is a pale
// serving ledge and rendered as a thin brown line floating on the floor.
const counter: Piece = { sheet: 'kitchen', col: 2, row: 9, w: 5, h: 1 };
const barTop: Piece = { sheet: 'kitchen', col: 2, row: 10, w: 6, h: 1 };
const sinkUnit: Piece = { sheet: 'kitchen', col: 9, row: 7, w: 1, h: 1 };
const fridge: Piece = { sheet: 'kitchen', col: 0, row: 1, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const cupboard: Piece = { sheet: 'kitchen', col: 12, row: 1, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const sink: Piece = { sheet: 'kitchen', col: 8, row: 7, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const sofa: Piece = { sheet: 'livingroom', col: 2, row: 5, w: 2, h: 2, solidRows: 0 };
const sofa2: Piece = { sheet: 'livingroom', col: 4, row: 5, w: 2, h: 2, solidRows: 0 };
const bench: Piece = { sheet: 'livingroom', col: 1, row: 8, w: 3, h: 2, solidRows: 0 };
const table: Piece = { sheet: 'livingroom', col: 3, row: 11, w: 2, h: 2 };
const cabinet: Piece = { sheet: 'livingroom', col: 11, row: 5, w: 2, h: 2 };
const palm: Piece = { sheet: 'livingroom', col: 13, row: 0, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const plant: Piece = { sheet: 'livingroom', col: 11, row: 1, w: 1, h: 2, solidRows: 1, aboveRows: 1 };
const lamp: Piece = { sheet: 'livingroom', col: 11, row: 10, w: 1, h: 2, solidRows: 1, aboveRows: 1 };

const W = 24;
const H = 20;

export function build(): void {
  const map = loadMap('lounge');
  blank(map);
  resize(map, W, H);

  const hall = { x: 0, y: 0, w: W, h: 14 };
  const snug = { x: 13, y: 12, w: 11, h: 8 };

  shell(map, hall, 'wood');
  shell(map, snug, 'wood');
  opening(map, 14, 12, 9, 2);

  const hi = interior(hall);
  const si = interior(snug);
  floor(map, 'cream', hi.x, hi.y, hi.w, hi.h);
  floor(map, 'carpetYellow', si.x, si.y, si.w, si.h);
  floor(map, 'carpetYellow', 14, 12, 9, 2);

  seal(map);
  castShadows(map);

  // --- the bar: a continuous run, not a row of floating cabinets
  place(map, fridge, 1, 2);
  place(map, cupboard, 3, 2);
  place(map, cupboard, 5, 2);
  place(map, sink, 7, 2);
  place(map, cupboard, 9, 2);
  // The bar itself: an unbroken run you can stand along, not a row of
  // separate cabinets with gaps between them.
  place(map, counter, 1, 5);
  place(map, barTop, 6, 5);
  place(map, sinkUnit, 12, 5);
  animated(map, 'coffee', 5, 2);
  // Six stools along the run. `seat` already writes the interactable — the
  // extra hand-rolled one here had no `facing` and the validator said so.
  for (let i = 0; i < 8; i++) seat(map, 2 + i, 6, 'up');

  // --- three separate conversations
  place(map, sofa, 2, 8);
  place(map, sofa2, 5, 8);
  place(map, table, 3, 10);
  seat(map, 2, 10, 'up');
  seat(map, 6, 10, 'up');

  place(map, bench, 10, 8);
  place(map, table, 11, 10);
  seat(map, 9, 10, 'up');
  seat(map, 13, 10, 'up');

  place(map, sofa, 17, 8);
  place(map, table, 17, 10);
  seat(map, 19, 8, 'left');
  seat(map, 19, 9, 'left');

  place(map, palm, 21, 2);
  place(map, cabinet, 19, 2);
  place(map, plant, 1, 10);
  place(map, lamp, 8, 6);

  // --- the snug: quiet, and far enough from the bar to mean it
  place(map, sofa, 15, 14);
  place(map, sofa2, 18, 14);
  place(map, table, 16, 16);
  seat(map, 15, 16, 'up');
  seat(map, 19, 16, 'up');
  place(map, lamp, 21, 16);
  zone(map, 'quiet', 'the snug', 14, 14, 9, 4);

  animated(map, 'cat', 12, 11);
  animated(map, 'candle', 17, 16);
  animated(map, 'sprout', 22, 11);

  interactable(map, 'exit', 'exit', 5, 11, 2, 1, 'Leave the lounge');
  spawn(map, 'default', 9, 11);
  spawn(map, 'bar', 14, 6);
  spawn(map, 'east', 15, 11);
  spawn(map, 'snug', 22, 17);

  const dropped = dropUnusedTilesets(map);
  save(map, 'lounge');
  console.log(`lounge: ${W}x${H}${dropped.length > 0 ? ` (dropped ${dropped.join(', ')})` : ''}`);
}
