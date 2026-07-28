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
  // By accessible NAME, not by title attribute. The rail is icon-only, and a
  // `title` is not a reliable name for assistive tech and shows nothing at all
  // on touch — so the buttons carry aria-label and a tooltip instead. The name
  // gains ", N unread" when messages are waiting.
  await page.getByRole('button', { name: /^chat/i }).click();
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
    await ana.getByLabel(/room name/i).fill(roomName);
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

  test('narrowing the window explains itself without dropping you out of the world', async ({
    browser,
  }) => {
    // The gate used to be an early return, and `canRenderWorld` also sat in the
    // connect effect's dependencies — so dragging a window narrower for one
    // second disconnected the socket, stopped LiveKit and dropped the avatar
    // out of the map, then rejoined from scratch on the way back. A slow drag
    // across the boundary thrashed it dozens of times.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await login(page, await createStudent('Resize Drive'));
    await page.goto('/world');
    await waitForWorld(page);
    await dismissCreator(page);

    // Count sockets from here on. A surviving session opens none.
    await page.evaluate(() => {
      const w = window as unknown as { __wsOpens: number };
      w.__wsOpens = 0;
      const Original = WebSocket;
      const Counting = function (...args: unknown[]): WebSocket {
        w.__wsOpens += 1;
        return new (Original as unknown as new (...a: unknown[]) => WebSocket)(...args);
      };
      (window as unknown as { WebSocket: unknown }).WebSocket = Counting;
    });

    await page.setViewportSize({ width: 900, height: 800 });
    await expect(page.getByText(/needs a bigger screen/i)).toBeVisible();
    // No game loop runs behind an explanation nobody can read past.
    await expect(page.locator('canvas')).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByText(/needs a bigger screen/i)).toBeHidden();
    await expect(page.getByText('Live', { exact: true })).toBeVisible();

    const opened = await page.evaluate(
      () => (window as unknown as { __wsOpens?: number }).__wsOpens ?? 0,
    );
    expect(opened, 'the session must survive a resize across the gate').toBe(0);

    await context.close();
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
