#!/usr/bin/env node
// Guards the design tokens, because ESLint cannot see inside a class string.
//
// Every rule here is a bug that shipped:
//   * `text-white` on the copper accent is ~1.9:1 — a WCAG failure — and it
//     was written at six call sites while `text-accent-ink` (~9.4:1) was used
//     at others, so the same button existed in two incompatible versions.
//   * Raw emerald/red/amber sat beside --success/--danger/--warn, and the same
//     semantic state got drawn two different ways in two different files.
//   * Raw z-index values were guesses that collided: the knock toast at z-20
//     rendered underneath the panel rail at z-30.
//
// Run: node scripts/lint-tokens.mjs   (wired into `pnpm lint`)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['src/features', 'src/components'];

const RULES = [
  {
    re: /\btext-white\b/,
    say: 'text-white — use text-accent-ink or text-danger-ink (white on accent is ~1.9:1)',
  },
  { re: /\b(?:bg|text|border|ring)-red-\d/, say: 'raw red — use the danger token' },
  { re: /\b(?:bg|text|border|ring)-emerald-\d/, say: 'raw emerald — use the success token' },
  { re: /\b(?:bg|text|border|ring)-amber-\d/, say: 'raw amber — use the warn token' },
  {
    re: /className=(?:"|'|`)[^"'`]*\bz-\d/,
    say: 'raw z-index — use z-world/overlay/hud/sidebar/toast/modal (see docs/rooms-hud.md)',
  },
  {
    re: /window\.addEventListener\(\s*['"]keydown['"]/,
    say: 'bare keydown listener — use useHotkey / useInputLayer (see docs/rooms-hud.md)',
  },
];

/** The input-layer stack is the ONE place allowed to own a keydown listener. */
const EXEMPT = ['src/features/rooms/input/'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const failures = [];
for (const scan of SCAN) {
  for (const file of walk(join(root, scan))) {
    const rel = relative(root, file).replace(/\\/g, '/');
    if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // Comments describe the rules; they do not violate them.
        if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
        for (const rule of RULES) {
          if (rule.re.test(line)) failures.push(`${rel}:${i + 1}  ${rule.say}`);
        }
      });
  }
}

if (failures.length > 0) {
  console.error(`\ntoken lint: ${failures.length} violation(s)\n`);
  failures.forEach((f) => console.error(`  ${f}`));
  console.error('');
  process.exit(1);
}
console.log('token lint: clean');
