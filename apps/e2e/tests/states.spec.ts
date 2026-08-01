import { expect, test } from '@playwright/test';
import { createStudent, login } from './helpers.js';

// Loading, empty and failed are three different things. Across the whole web
// app there used to be exactly one `isError` and zero `isLoading`, so a request
// that failed was drawn identically to one that returned nothing — and a throw
// inside a lazy route blanked the entire application.
//
// These drive the failure paths by breaking real requests, because a state
// nobody has ever seen is a state nobody has ever checked.

test.describe('failure states', () => {
  test('a failed rooms fetch reads as failed, not as empty', async ({ page }) => {
    await login(page, await createStudent('Err'));
    // Break the list endpoint only — auth and the shell keep working.
    await page.route('**/api/rooms', (route) =>
      route.request().method() === 'GET' ? route.abort('failed') : route.continue(),
    );
    await page.goto('/rooms');

    await expect(page.getByText(/couldn't load your rooms/i)).toBeVisible();
    // The bug: this is what used to show instead.
    await expect(page.getByText(/no rooms yet/i)).toBeHidden();

    await page.unroute('**/api/rooms');
    await page.getByRole('button', { name: /try again/i }).click();
    await expect(page.getByText(/no rooms yet/i)).toBeVisible();
  });

  // NOT covered here: a lazy route whose CHUNK fails to load. Aborting the
  // module request is not deterministic — once the browser has the module,
  // interception no longer decides whether it resolves, so the test passed
  // alone and failed inside the suite. It was verified by hand instead: the
  // app shell, its nav and the footer all survive, and the route shows "Rooms
  // stopped working" with a working Try again. Every lazy route is wrapped in
  // `LazyRoute` (main.tsx) and the canvas has its own boundary in WorldPage.
});
