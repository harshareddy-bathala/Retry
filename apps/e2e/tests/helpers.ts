import type { Page } from '@playwright/test';

// Account setup for the drive.
//
// Users are REGISTERED through the real API and verified through Mailpit's
// HTTP API rather than seeded into the database or handed a minted token. That
// costs a few seconds per run and buys the thing a drive is for: the path a
// student actually takes exists and works, end to end, including the parts
// nobody would think to unit-test.

const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api';
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
/** The college domain the API allows. */
const EMAIL_DOMAIN = 'nttf.co.in';
const PASSWORD = 'DriveTest!2026x';

export type Student = { email: string; password: string; name: string };

/** Unique per run, so repeated drives never collide on the unique email index. */
function uniqueEmail(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}@${EMAIL_DOMAIN}`;
}

type MailpitMessage = { ID: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** The newest message to this address, waited for — SMTP delivery is not instant. */
async function latestMessageBody(email: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const search = await fetchJson<{ messages: MailpitMessage[] }>(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const id = search.messages[0]?.ID;
    if (id) {
      const message = await fetchJson<{ Text: string; HTML: string }>(
        `${MAILPIT}/api/v1/message/${id}`,
      );
      return `${message.Text}\n${message.HTML}`;
    }
    if (Date.now() > deadline) throw new Error(`no verification email for ${email}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Register, verify and onboard a student. Returns credentials for the UI login. */
export async function createStudent(name: string): Promise<Student> {
  const email = uniqueEmail('drive');
  await fetchJson(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });

  const body = await latestMessageBody(email);
  const token = /token=([A-Za-z0-9_-]+)/.exec(body)?.[1];
  if (!token) throw new Error(`no verify token in the email to ${email}`);
  const verified = await fetch(`${API}/auth/verify-email?token=${token}`);
  if (!verified.ok) throw new Error(`verify failed: ${verified.status}`);

  return { email, password: PASSWORD, name };
}

/** Log in through the UI and land wherever the app sends a verified student. */
export async function login(page: Page, student: Student): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(student.email);
  await page.getByLabel(/password/i).fill(student.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  // Onboarding is shown once, on the first login of a fresh account, and it is
  // a real form: department, batch year and semester are all required, so the
  // drive fills them rather than clicking Finish at an empty form.
  await page.waitForURL(/\/(onboarding)?$/, { timeout: 20_000 }).catch(() => undefined);
  if (page.url().includes('/onboarding')) {
    await page.locator('#department').selectOption({ index: 1 });
    await page.getByLabel(/batch year/i).fill('2023-2026');
    await page.locator('#semester').selectOption({ index: 1 });
    await page.getByRole('button', { name: /finish setup/i }).click();
    await page.waitForURL(/localhost:\d+\/$/, { timeout: 20_000 });
  }
}

/**
 * Walk. Movement is a held key, not a discrete event: the scene reads key
 * state every frame, so a press/release pair with a real gap is the only way
 * to move a real distance.
 */
export async function walk(page: Page, key: 'w' | 'a' | 's' | 'd', ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  // Let the final stop message and the proximity debounce land.
  await page.waitForTimeout(400);
}

/**
 * The world is ready when its canvas is up and the socket says it is open.
 * `.first()` because the minimap is a canvas too — the world's is the one
 * Phaser appends first.
 */
export async function waitForWorld(page: Page): Promise<void> {
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByText('Live', { exact: true }).waitFor({ timeout: 30_000 });
}

/** Dismiss the character creator, which opens on a student's first-ever entry. */
export async function dismissCreator(page: Page): Promise<void> {
  const save = page.getByRole('button', { name: /that's me/i });
  if (await save.isVisible().catch(() => false)) {
    await save.click();
    await save.waitFor({ state: 'hidden', timeout: 10_000 });
  }
}
