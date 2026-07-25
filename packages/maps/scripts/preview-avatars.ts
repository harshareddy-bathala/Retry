import { writeFileSync } from 'node:fs';
import { Canvas, rgb } from '../art/canvas.js';
import { encodePng } from '../art/png.js';
import { AVATARS, AVATAR_SIZE, renderAvatar } from '../art/avatars.js';

// Every preset, every direction, every frame, blown up so the silhouettes can
// be compared side by side — which is the only way to tell whether six
// characters actually read as six different people.
const SCALE = 4;
const GAP = 8;
const sheetW = AVATAR_SIZE * 4;
const sheetH = AVATAR_SIZE * 4;
const cols = 3;
const rows = Math.ceil(AVATARS.length / cols);
const out = new Canvas(
  (sheetW * SCALE + GAP) * cols + GAP,
  (sheetH * SCALE + GAP) * rows + GAP,
);
out.rect(0, 0, out.width, out.height, rgb('#9c7553')); // on the floor colour

AVATARS.forEach((spec, i) => {
  const sheet = renderAvatar(spec);
  const ox = GAP + (i % cols) * (sheetW * SCALE + GAP);
  const oy = GAP + Math.floor(i / cols) * (sheetH * SCALE + GAP);
  for (let y = 0; y < sheet.height; y++) {
    for (let x = 0; x < sheet.width; x++) {
      const c = sheet.get(x, y);
      if (c[3] === 0) continue;
      out.rect(ox + x * SCALE, oy + y * SCALE, SCALE, SCALE, c);
    }
  }
  out.frame(ox - 1, oy - 1, sheetW * SCALE + 2, sheetH * SCALE + 2, rgb('#e2935e', 120));
});

writeFileSync(process.argv[2] ?? 'avatars-preview.png', encodePng(out.width, out.height, out.data));
console.log(AVATARS.map((a) => `${a.key}: ${a.name}`).join('\n'));
