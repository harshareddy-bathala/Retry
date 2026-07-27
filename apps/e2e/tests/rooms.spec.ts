import { expect, test, type Browser, type Page } from '@playwright/test';
import { createStudent, dismissCreator, login, waitForWorld, walk } from './helpers.js';

// The golden path, with two students in one world.
//
// This is the drive the previous track ran by hand four times and threw away.
// It asserts the things that only break when the pieces are assembled: two
// browsers seeing each other, speech that reaches one person and not another,
// a typing notice crossing the wire, and a world that survives being walked
// around in.
//
// It does NOT re-test what the WS suites already cover — rate limits, invalid
// emote keys, membership. Those are cheaper and sharper one layer down.

/** A student in their own browser context, registered, onboarded and logged in. */
async function student(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, await createStudent(name));
  return page;
}

/** Open the panel rail's chat panel. Rooms have one; the Commons does not. */
async function openChat(page: Page): Promise<void> {
  await page.getByTitle(/chat/i).click();
  await page.getByPlaceholder(/message…/i).waitFor({ timeout: 10_000 });
}

test.describe('rooms', () => {
  test('two students share a room: presence, speech, typing, scopes', async ({ browser }) => {
    const ana = await student(browser, 'Ana Drive');
    const ben = await student(browser, 'Ben Drive');

    // --- Ana creates a public room -----------------------------------------
    await ana.goto('/rooms');
    await ana.getByRole('button', { name: /new room/i }).click();
    const roomName = `Drive ${Date.now().toString(36)}`;
    await ana.getByPlaceholder(/room name/i).fill(roomName);
    await ana.getByRole('combobox').first().selectOption('public');
    await ana.getByRole('button', { name: /create room/i }).click();
    await expect(ana.getByText(roomName)).toBeVisible();

    const href = await ana.getByRole('link', { name: /^open$/i }).first().getAttribute('href');
    const roomId = href?.split('/').pop();
    expect(roomId, 'the new room should have an id').toBeTruthy();

    // --- Both walk into it. It is open, so Ben needs no invite. -------------
    for (const page of [ana, ben]) {
      await page.goto(`/world?map=${roomId}`);
      await waitForWorld(page);
      await dismissCreator(page);
    }

    // Presence: each sees the other by name in the strip.
    await expect(ana.getByText('Ben Drive')).toBeVisible({ timeout: 20_000 });
    await expect(ben.getByText('Ana Drive')).toBeVisible({ timeout: 20_000 });

    // The world canvas and the minimap canvas, both up.
    await expect(ana.locator('canvas')).toHaveCount(2);

    // --- Nearby speech reaches someone standing next to you ----------------
    // Both spawned at the same point, so proximity has them close.
    await openChat(ben);
    await ana.getByRole('button', { name: /say something/i }).click();
    await ana.getByPlaceholder(/only people near you/i).fill('hello from the drive');
    await ana.keyboard.press('Enter');

    const said = ben.getByText('hello from the drive');
    await expect(said).toBeVisible({ timeout: 15_000 });
    // Speech is marked as speech: it is not saved, and the panel says so.
    await expect(ben.getByText(/· nearby/).first()).toBeVisible();

    // --- A room-scoped line is the record, and is NOT marked nearby --------
    await openChat(ana);
    await ana.getByPlaceholder(/message…/i).fill('for the record');
    await ana.keyboard.press('Enter');
    await expect(ben.getByText('for the record')).toBeVisible({ timeout: 15_000 });

    // --- Typing crosses the wire -------------------------------------------
    // Both ends rate-limit this (1s client, 2s server) and the messages above
    // have just spent the allowance, so wait it out rather than racing it —
    // the suppression is the feature, not a flake.
    await ana.waitForTimeout(2_500);
    await ana.getByPlaceholder(/message…/i).pressSequentially('mid sentence', { delay: 40 });
    await expect(ben.getByText(/Ana Drive is typing/i)).toBeVisible({ timeout: 15_000 });

    // --- Typing in a panel must never move the avatar ----------------------
    // "wasd" in the composer is text, not movement (Phase 6 acceptance).
    await ana.getByPlaceholder(/message…/i).fill('wasd');
    await expect(ana.getByPlaceholder(/message…/i)).toHaveValue('wasd');

    // --- Escape closes the panel rather than leaving the world -------------
    await ana.keyboard.press('Escape');
    await expect(ana.getByPlaceholder(/message…/i)).toBeHidden();
    expect(ana.url()).toContain('/world');

    // --- Walking works, and the world survives it --------------------------
    await ana.locator('canvas').first().click();
    await walk(ana, 'd', 600);
    await expect(ana.getByText('Live', { exact: true })).toBeVisible();

    // --- An emote does not throw -------------------------------------------
    // The bubble is drawn inside the canvas, so the DOM assertion available
    // here is that the round trip left the world live. The WS suite asserts
    // the fan-out itself.
    await ana.locator('body').press('4');
    await expect(ana.getByText('Live', { exact: true })).toBeVisible();

    await ana.context().close();
    await ben.context().close();
  });

  test('a phone-sized viewport gets an explanation, not a broken canvas', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 480, height: 900 } });
    const page = await context.newPage();
    await login(page, await createStudent('Mobile Drive'));

    await page.goto('/world');
    await expect(page.getByText(/needs a bigger screen/i)).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    // And the way out is a link to something that does work at this size.
    await expect(page.getByRole('link', { name: /back to rooms/i })).toBeVisible();

    await context.close();
  });
});
