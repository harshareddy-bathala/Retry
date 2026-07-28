import { expect, test, type Browser, type Page } from '@playwright/test';
import { createStudent, dismissCreator, login, waitForWorld, walk } from './helpers.js';

// Proximity AV, driven against a real LiveKit server (docker compose `livekit`).
//
// This file exists because of one claim that the entire AV design rests on and
// that nothing else can check: **bandwidth scales with proximity, not with room
// population.** Walking away from someone must DROP their subscription, not
// mute it.
//
// That difference is invisible from the DOM. A peer whose tracks are subscribed
// and a peer whose tracks are muted render exactly the same — same bubble, same
// initials, same silence — so the assertions here go through `window.__av()`,
// the dev-only probe on the AV manager, and read the LiveKit room object
// directly.
//
// Runs in its own Playwright project (`edge-av`) with a fake camera and a
// synthetic microphone. The default `edge` project deliberately has neither,
// because "no media devices at all" is a state the app supports and the other
// specs quietly cover it.

type Probe = {
  status: string;
  room: string | null;
  peers: Array<{ userId: string; zone: string; subscribed: string[] }>;
};

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const fn = (window as unknown as { __av?: () => Probe }).__av;
    if (!fn) throw new Error('no __av probe — is this a dev build?');
    return fn();
  });
}

/** What this page has subscribed from everyone else, flattened. */
async function subscribedSources(page: Page): Promise<string[]> {
  const { peers } = await probe(page);
  return peers.flatMap((p) => p.subscribed).sort();
}

/** Inbound RTP bytes, summed across peers — proof that media actually arrived. */
async function inboundBytes(page: Page): Promise<number> {
  const per = await page.evaluate(async () => {
    const fn = (window as unknown as { __avBytes?: () => Promise<Record<string, number>> })
      .__avBytes;
    if (!fn) throw new Error('no __avBytes probe');
    return fn();
  });
  return Object.values(per).reduce((a, b) => a + b, 0);
}

async function student(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, await createStudent(name));
  return page;
}

/**
 * Get this page publishing a microphone, through the front door.
 *
 * The pre-join dialog appears once per session and is a Radix modal, so it
 * traps focus — the dock's mic button is not clickable behind it. Going through
 * the dialog is also the real path a student takes, which is the better thing
 * to be testing anyway.
 *
 * Written as "turn it on if it is off" rather than "click the toggle", because
 * the default is now muted and a test that hardcoded either default would
 * silently start asserting nothing the day it changed.
 */
async function joinWithMic(page: Page): Promise<void> {
  // WAIT for the dialog rather than probing for it. It opens on a 300ms poll
  // after the creator closes, so `isVisible()` here is a coin flip — and losing
  // that flip does not skip the dialog, it clicks the dock button underneath a
  // modal overlay that is about to appear and swallow the pointer event.
  // Every test in this file uses a fresh context, so sessionStorage is empty
  // and the check is always offered.
  const preJoin = page.getByRole('dialog', { name: /can they hear you/i });
  await preJoin.waitFor({ timeout: 20_000 });

  const mic = preJoin.getByRole('button', { name: /^mic$/i });
  if ((await mic.getAttribute('aria-pressed')) !== 'true') await mic.click();
  await preJoin.getByRole('button', { name: /join with these/i }).click();
  await expect(preJoin).toBeHidden();
  await expect(page.getByRole('button', { name: /turn the microphone off/i })).toBeVisible();
}

test.describe('proximity AV', () => {
  test('audio is subscribed when close and DROPPED when far', async ({ browser }) => {
    const ana = await student(browser, 'Ana AV');
    const ben = await student(browser, 'Ben AV');

    // The sandbox studio: a static map, so this test is about AV and not about
    // the room-creation form.
    for (const page of [ana, ben]) {
      await page.goto('/world?map=studio_a');
      await waitForWorld(page);
      await dismissCreator(page);
    }

    // Both connected to the SFU. Until this passes, nothing below means
    // anything — and for three weeks this line could not have passed at all.
    for (const page of [ana, ben]) {
      await expect.poll(async () => (await probe(page)).status, { timeout: 30_000 }).toBe('live');
      await joinWithMic(page);
    }

    // Both spawned on the same tile, so proximity has them close and each
    // should be subscribed to the other's microphone.
    await expect
      .poll(async () => (await subscribedSources(ana)).includes('microphone'), { timeout: 30_000 })
      .toBe(true);
    await expect
      .poll(async () => (await subscribedSources(ben)).includes('microphone'), { timeout: 30_000 })
      .toBe(true);

    const close = await probe(ana);
    expect(close.peers, 'Ana should see exactly one peer').toHaveLength(1);
    expect(close.peers[0]?.zone).toBe('close');

    // Subscribed is not the same as connected. If ICE were failing — the
    // classic dev failure, LiveKit advertising an address the browser cannot
    // reach — every assertion above would still pass and the room would be
    // silent. Bytes on the wire is the difference.
    await expect
      .poll(async () => inboundBytes(ana), { timeout: 30_000 })
      .toBeGreaterThan(0);

    // --- walk out of range ---------------------------------------------------
    // 4 tiles/second, so ~2.2s east clears NEAR_TILES (5) and its 0.5-tile
    // hysteresis with room to spare inside a 24-wide map.
    await ana.locator('canvas').first().click();
    await walk(ana, 'd', 2_200);

    // THE assertion. Not "muted", not "gain 0" — gone.
    await expect
      .poll(async () => (await subscribedSources(ana)).length, { timeout: 30_000 })
      .toBe(0);
    await expect
      .poll(async () => (await subscribedSources(ben)).length, { timeout: 30_000 })
      .toBe(0);
    expect((await probe(ana)).peers[0]?.zone).toBe('out');

    // The peer is still THERE — this is a dropped subscription, not a dropped
    // participant. Getting that wrong would look identical from the outside and
    // would mean walking away disconnected someone.
    expect((await probe(ana)).peers, 'the peer must still be in the room').toHaveLength(1);

    // --- and back again ------------------------------------------------------
    await walk(ana, 'a', 2_200);
    await expect
      .poll(async () => (await subscribedSources(ana)).includes('microphone'), { timeout: 30_000 })
      .toBe(true);

    await ana.context().close();
    await ben.context().close();
  });

  test('a door transition hands over to the new map’s LiveKit room', async ({ browser }) => {
    const ana = await student(browser, 'Ana Door');

    await ana.goto('/world?map=studio_a');
    await waitForWorld(ana);
    await dismissCreator(ana);
    await expect.poll(async () => (await probe(ana)).status, { timeout: 30_000 }).toBe('live');
    await joinWithMic(ana);
    const studio = (await probe(ana)).room;
    expect(studio).toBe('retry-studio_a');

    await ana.goto('/world?map=commons');
    await waitForWorld(ana);
    await expect.poll(async () => (await probe(ana)).room, { timeout: 30_000 }).toBe(
      'retry-commons',
    );
    // One LiveKit room per map instance: the old connection must be gone, not
    // left running in the background publishing your microphone into a room
    // you have walked out of.
    await expect.poll(async () => (await probe(ana)).status, { timeout: 30_000 }).toBe('live');

    await ana.context().close();
  });
});

// The pre-join check. Its whole value is that it appears at the right moment
// and does not gate the world, so those are the assertions.
test.describe('pre-join check', () => {
  test('appears once, after the character creator, and never gates the socket', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, await createStudent('Ana PreJoin'));

    await page.goto('/world?map=studio_a');

    // A brand-new account gets the character creator first. Both are modals,
    // and two stacked would trap focus in the top one and make the bottom one
    // undismissable — so the pre-join must NOT be up yet.
    const creator = page.getByRole('dialog', { name: /build your character/i });
    await creator.waitFor({ timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: /can they hear you/i })).toBeHidden();

    await dismissCreator(page);

    const preJoin = page.getByRole('dialog', { name: /can they hear you/i });
    await preJoin.waitFor({ timeout: 20_000 });

    // The socket is up BEHIND it. The dialog gates publishing, never the world:
    // `useRoomSession` keeps its [userId, mapId] deps for exactly this reason.
    await expect(page.getByText('Live', { exact: true })).toBeVisible();

    // Joining muted must leave nothing published — the default this phase
    // exists to establish. With nothing enabled there is exactly ONE button,
    // because two adjacent controls both reading "Join muted" is what the
    // first version of this dialog did.
    await expect(preJoin.getByRole('button', { name: /^join muted$/i })).toHaveCount(1);
    await preJoin.getByRole('button', { name: /^join muted$/i }).click();
    await expect(preJoin).toBeHidden();
    await expect(page.getByRole('button', { name: /turn the microphone on/i })).toBeVisible();

    // Walking through a door must not ask again.
    await page.goto('/world?map=commons');
    await waitForWorld(page);
    await page.waitForTimeout(1_500);
    await expect(preJoin).toBeHidden();

    // But it is one click away, which is what makes "once" acceptable.
    await page.getByRole('button', { name: /check mic and camera/i }).click();
    await expect(preJoin).toBeVisible();

    await context.close();
  });
});
