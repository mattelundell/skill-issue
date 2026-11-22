import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Pack } from '@skill-issue/contract';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');

// One installation for the whole file, in this order: it starts empty.
test.describe.configure({ mode: 'serial' });

let example: Pack;

test.beforeAll(async () => {
  const files = await readFolder(EXAMPLE);
  if (!files.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(files.error)}`);
  }
  const pack = checkPackFiles(files.value);
  if (!pack.ok) {
    throw new Error(`example pack does not check: ${JSON.stringify(pack.error)}`);
  }
  example = pack.value;
});

/** Every request a page makes that leaves this machine. The app bundles its fonts and fetches nothing from outside. */
const leaving = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const outside: string[] = [];
  leaving.set(page, outside);
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== '127.0.0.1') {
      outside.push(request.url());
    }
  });
});

test.afterEach(({ page }) => {
  expect(leaving.get(page)).toEqual([]);
});

test('an empty installation welcomes, and a subject loaded while the start screen is open appears on its next refresh, marked as new', async ({ page, request }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Välkommen');
  await expect(page.getByRole('heading', { name: 'Inga ämnen än' })).toBeVisible();

  const loaded = await request.post('/api/v1/content/packs', { data: example });
  expect(loaded.status()).toBe(201);
  // Nothing has asked the server again yet.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Välkommen');

  await page.clock.fastForward(30_000);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dina ämnen');
  const row = page.locator('.ledger-row', { has: page.getByRole('link', { name: 'Exempelämne', exact: true }) });
  await expect(row.getByText('Nytt')).toBeVisible();
  await expect(row.locator('.chip')).toHaveText(['English', 'svenska']);
});

test('the subject home is reached from the start screen, draws the path, survives a reload and leads back', async ({ page }) => {
  await page.goto('/');
  // Nothing begun yet, so the way in is to begin.
  await page.getByRole('link', { name: 'Börja: Exempelämne' }).click();

  await expect(page).toHaveURL('/subjects/example-subject');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Exempelämne');
  await expect(page.getByRole('navigation', { name: 'Ämnet' }).getByRole('link')).toHaveText(['Översikt', 'Material', 'Repetition', 'Anteckningar', 'Framsteg']);
  await expect(page.getByText('2 områden')).toBeVisible();
  await expect(page.locator('section[data-area] h3')).toHaveText(['Grunder', 'Fördjupning']);
  await expect(page.locator('section[data-area="fordjupning"] .requires')).toHaveText('Bygger på Grunder.');
  await expect(page.locator('section[data-area="grunder"] li .lesson')).toHaveText(['Energi och effekt', 'Enhetsprefix']);
  await expect(page.locator('section[data-area="fordjupning"] li .lesson')).toHaveText(['Energibalans']);
  await expect(page).toHaveTitle('Exempelämne · Skill Issue');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Exempelämne');

  await page.getByRole('link', { name: 'Alla ämnen' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dina ämnen');
});

test('an unknown subject is answered with “no such subject”, naming its id', async ({ page }) => {
  await page.goto('/subjects/no-such-subject');

  const alert = page.getByRole('alert');
  await expect(alert.getByRole('heading')).toHaveText('Ämnet finns inte');
  await expect(alert.locator('code')).toHaveText('no-such-subject');
});

test('the interface switches to English and stays so after a reload', async ({ page }) => {
  await page.goto('/subjects/example-subject');
  await page.getByRole('combobox', { name: 'Språk', exact: true }).selectOption('en');

  await expect(page.getByText('2 areas')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'All subjects' })).toBeVisible();
  await expect(page.locator('section[data-area="fordjupning"] .requires')).toHaveText('Builds on Grunder.');
});

test('at phone width neither screen scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['/', '/subjects/example-subject']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBe(0);
  }
});
