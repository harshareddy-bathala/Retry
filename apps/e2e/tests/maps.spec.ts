import { expect, test, type Page } from '@playwright/test';
import { createStudent, dismissCreator, login, waitForWorld } from './helpers.js';

// The maps, driven (rooms plan Phase 6).
//
// Everything here is about what types cannot check: whether the world actually
// DRAWS. Phase 6 rebuilt all five rooms from a tileset nothing used, and moved
// tileset loading out of `preload` into a mid-scene loader. Both fail the same
// silent way — a black canvas, no error, a live socket.

/** Tileset names currently in the Phaser cache, via the dev-only game handle. */
async function tilesets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const game = (window as unknown as { __roomGame?: { textures: { getTextureKeys(): string[] } } })
      .__roomGame;
    if (!game) throw new Error('no __roomGame handle — is this a dev build?');
    return game.textures
      .getTextureKeys()
      .filter((k) => k.startsWith('tiles-'))
      .map((k) => k.slice('tiles-'.length))
      .sort();
  });
}

/**
 * Wait until the room's artwork has actually landed.
 *
 * `waitForWorld` is no longer enough on its own, and finding that out is half
 * the value of this file: with tilesets loaded per template, the canvas is
 * created BEFORE the sheets it draws with arrive. Anything asserting about a
 * drawn room has to wait for the textures, not the element.
 */
async function waitForTiles(page: Page, sheet: string): Promise<void> {
  await expect
    .poll(async () => (await tilesets(page)).includes(sheet), { timeout: 20_000 })
    .toBe(true);
}

/** Is anything but the fade colour on screen? A flat canvas is the failure. */
async function canvasHasContent(page: Page): Promise<boolean> {
  const shot = await page.locator('canvas').first().screenshot();
  // A PNG of one flat colour compresses to almost nothing. Deliberately loose:
  // the assertion is "a room got drawn", not a pixel match.
  return shot.byteLength > 20_000;
}

test.describe('maps', () => {
  test('the Commons draws, and pays only for its own sheets', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await login(page, await createStudent('Mapper One'));
    await page.goto('/world?map=commons');
    await dismissCreator(page);
    await waitForWorld(page);
    await waitForTiles(page, 'museum');

    // The Commons draws on museum; it must NOT have paid for the classroom or
    // kitchen sheets other rooms use. That is the whole point of per-template
    // loading — the union of all five used to be loaded for every visitor.
    const sheets = await tilesets(page);
    expect(sheets).not.toContain('kitchen');
    expect(sheets).not.toContain('classroom');

    expect(await canvasHasContent(page), 'the Commons rendered as a flat colour').toBe(true);
    expect(errors, 'page errors while drawing the Commons').toEqual([]);
  });

  test('changing map fetches the new sheets mid-scene', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await login(page, await createStudent('Mapper Two'));
    await page.goto('/world?map=commons');
    await dismissCreator(page);
    await waitForWorld(page);
    await waitForTiles(page, 'museum');

    // studio_a draws on `classroom`, which the Commons does not — so this
    // transition genuinely has to fetch. Without that the test would pass for
    // the wrong reason.
    expect(await tilesets(page)).not.toContain('classroom');

    await page.goto('/world?map=studio_a');
    await waitForWorld(page);
    await waitForTiles(page, 'classroom');

    expect(await canvasHasContent(page), 'the studio rendered as a flat colour').toBe(true);
    expect(errors).toEqual([]);
  });
});
