import { addObject, dropUnusedTilesets, loadMap, resize, save } from '../src/tiled.js';
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

// The Commons — the front door of the whole world.
//
//   pnpm --filter @retry/maps author commons
//   ...then RESTART THE API.
//
// This is the riskiest map in the repo and it is worth being explicit about
// why. The twelve doors are the only map geometry another service reads: the
// API assigns a room to a door BY COORDINATE, stores that coordinate on the
// room row, and matches on it forever after. Moving a door orphans every room
// that owned it.
//
// It is survivable because `reconcileDoors` in apps/api exists precisely for
// this — at boot it nulls any door coordinate the map no longer has and hands
// the freed rooms new slots, oldest first. So the sequence is: author, restart
// the API, and the wall re-fills itself. Skip the restart and the Commons shows
// twelve doors that open onto nothing.
//
// `room_members.last_position` does NOT self-heal. Everyone who was standing
// somewhere in the old 40x16 Commons respawns at the default spawn, and anyone
// whose stored position is now inside a wall gets resynced out of it. That was
// accepted when the reshape was chosen.

const reception: Piece = {
  sheet: 'museum', col: 0, row: 1, w: 7, h: 3, solidRows: 2, aboveRows: 1,
};
const bench: Piece = { sheet: 'museum', col: 0, row: 9, w: 2, h: 1, solidRows: 0 };
const benchGrey: Piece = { sheet: 'museum', col: 2, row: 10, w: 2, h: 1, solidRows: 0 };
const poster: Piece = {
  sheet: 'museum', col: 14, row: 9, w: 2, h: 2, solidRows: 1, aboveRows: 1,
};
const poster2: Piece = {
  sheet: 'museum', col: 14, row: 7, w: 2, h: 2, solidRows: 1, aboveRows: 1,
};
const plinth: Piece = { sheet: 'museum', col: 2, row: 12, w: 2, h: 2, solidRows: 1, aboveRows: 1 };
const plinth2: Piece = { sheet: 'museum', col: 4, row: 12, w: 2, h: 2, solidRows: 1, aboveRows: 1 };
const vase: Piece = { sheet: 'museum', col: 8, row: 9, w: 2, h: 2, solidRows: 1, aboveRows: 1 };
const stanchion: Piece = {
  sheet: 'museum', col: 13, row: 1, w: 1, h: 3, solidRows: 1, aboveRows: 2,
};
const palm: Piece = { sheet: 'livingroom', col: 13, row: 0, w: 2, h: 3, solidRows: 1, aboveRows: 2 };
const plant: Piece = { sheet: 'livingroom', col: 11, row: 1, w: 1, h: 2, solidRows: 1, aboveRows: 1 };

const W = 44;
const H = 20;

/** Twelve doors, two tiles wide, three apart, on the gallery's north wall. */
const DOOR_COUNT = 12;
const DOOR_ROW = 1;
const DOOR_X0 = 4;
const DOOR_STEP = 3;

export function build(): void {
  const map = loadMap('commons');
  blank(map);
  resize(map, W, H);

  // A wide atrium with a narrower gallery above it. The gallery is a corridor
  // whose whole job is the twelve doors, and keeping it narrow is what makes
  // "go to the door wall" a direction rather than a search.
  const gallery = { x: 2, y: 0, w: 40, h: 8 };
  const atrium = { x: 0, y: 6, w: W, h: 14 };

  shell(map, gallery, 'plaster');
  shell(map, atrium, 'plaster');
  opening(map, 3, 6, 38, 2);

  const gi = interior(gallery);
  const ai = interior(atrium);
  floor(map, 'carpetBlue', gi.x, gi.y, gi.w, gi.h);
  floor(map, 'cream', ai.x, ai.y, ai.w, ai.h);
  floor(map, 'carpetBlue', 3, 6, 38, 2);

  seal(map);
  castShadows(map);

  // --- the door wall
  for (let i = 0; i < DOOR_COUNT; i++) {
    const x = DOOR_X0 + i * DOOR_STEP;
    addObject(map, 'interactables', {
      name: `door_${i}`,
      x,
      y: DOOR_ROW,
      w: 2,
      h: 1,
      properties: [
        { name: 'interactive', type: 'string', value: 'door' },
        { name: 'door_slot', type: 'int', value: i },
      ],
    });
    // A stanchion between each pair, so twelve doors read as twelve doors and
    // not as one long wall with holes in it.
    if (i > 0) place(map, stanchion, x - 1, 2);
  }

  // --- the atrium: a reception you arrive at, and a gallery of projects
  place(map, reception, 3, 8);
  seat(map, 3, 11, 'up');
  seat(map, 4, 11, 'up');
  place(map, palm, 1, 8);
  place(map, palm, 41, 8);

  // Posters along the SOUTH wall. The first version hung them at row 8, in
  // open floor with nothing behind them, and six clipboards floating in the
  // middle of an atrium is not a gallery. A poster needs a wall.
  for (let i = 0; i < 6; i++) {
    place(map, i % 2 === 0 ? poster : poster2, 12 + i * 5, 16);
  }
  for (const x of [14, 20, 26, 32]) {
    place(map, x % 4 === 0 ? plinth : plinth2, x, 10);
  }
  place(map, vase, 38, 10);

  // Benches in twos, facing the door wall — two people on a bench is a
  // conversation, a row of eight is a waiting room.
  for (const x of [10, 17, 24, 31]) {
    place(map, bench, x, 13);
    place(map, benchGrey, x + 2, 13);
    seat(map, x, 13, 'up');
    seat(map, x + 1, 13, 'up');
    seat(map, x + 2, 13, 'up');
  }
  // Two more in the gallery itself, for waiting outside a door.
  // Between stanchions, which stand at 6, 9, 12 … 36.
  for (const x of [7, 31]) {
    place(map, benchGrey, x, 4);
    seat(map, x, 4, 'up');
    seat(map, x + 1, 4, 'up');
  }

  place(map, plant, 1, 16);
  place(map, plant, 42, 16);
  animated(map, 'coffee', 40, 9);
  animated(map, 'cat', 21, 14);
  animated(map, 'sprout', 6, 16);
  animated(map, 'sprout', 39, 16);

  zone(map, 'quiet', 'reception', 2, 8, 8, 4);

  interactable(map, 'exit', 'exit', 21, 17, 2, 1, 'Leave the Commons');
  spawn(map, 'default', 21, 12);
  spawn(map, 'west', 6, 13);
  spawn(map, 'east', 37, 13);
  spawn(map, 'gallery', 22, 5);
  spawn(map, 'south', 21, 17);

  const dropped = dropUnusedTilesets(map);
  save(map, 'commons');
  console.log(
    `commons: ${W}x${H}, ${DOOR_COUNT} doors${dropped.length > 0 ? ` (dropped ${dropped.join(', ')})` : ''}`,
  );
  console.log('  the door coordinates moved — RESTART THE API so reconcileDoors re-heals them');
}
