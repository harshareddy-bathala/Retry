import { build as classroom } from './classroom.js';
import { build as conference } from './conference.js';
import { build as lounge } from './lounge.js';
import { build as studioA } from './studio_a.js';

// CLI for the room scripts.
//
//   pnpm --filter @retry/maps author            # every room
//   pnpm --filter @retry/maps author studio_a   # one
//
// Then ALWAYS:  pnpm validate && pnpm preview:all && look at the PNG.
// A map that validates is not a map that looks like anything.

const rooms: Record<string, () => void> = {
  studio_a: studioA,
  classroom,
  lounge,
  conference,
};

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : Object.keys(rooms);

for (const name of names) {
  const build = rooms[name];
  if (!build) {
    console.error(`unknown room '${name}' — have: ${Object.keys(rooms).join(', ')}`);
    process.exit(1);
  }
  build();
}
