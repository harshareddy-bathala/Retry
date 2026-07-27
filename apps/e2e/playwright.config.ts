import { defineConfig, devices } from '@playwright/test';

// The rooms drive (W6). This is the suite that replaced four throwaway scripts.
//
// It runs against a stack you started yourself (`pnpm dev`) rather than
// managing one: the world needs Postgres, Redis and the licensed art pack
// built, none of which a test runner should be deciding to provision. If the
// stack is not up, the first navigation fails with a clear message.
//
// It drives the SYSTEM Edge rather than a downloaded Chromium. The pack, the
// stack and the browser are all local prerequisites here; adding a 150 MB
// browser download to a repo that already needs a paid art pack helps nobody,
// and Edge is on every Windows machine this project is developed on.

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  // The world is real-time: a proximity zone alone takes 300ms to commit, and
  // a two-browser handshake is several of those in a row.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Two browsers in one test share a room; parallel files would share a world.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: WEB,
    channel: 'msedge',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Nobody is going to click through a permission prompt in CI, and a denied
    // camera is a supported state anyway — bubbles fall back to initials.
    permissions: [],
  },
  projects: [{ name: 'edge', use: { ...devices['Desktop Chrome'] } }],
});
