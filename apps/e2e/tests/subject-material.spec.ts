import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Pack } from '@skill-issue/contract';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');

test.describe.configure({ mode: 'serial' });

let example: Pack;

test.beforeAll(async ({ request }) => {
  const files = await readFolder(EXAMPLE);
  if (!files.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(files.error)}`);
  }
  const pack = checkPackFiles(files.value);
  if (!pack.ok) {
    throw new Error(`example pack does not check: ${JSON.stringify(pack.error)}`);
  }
  example = pack.value;
  // Loaded already by an earlier file, or loaded here: the same pack either way.
  const loaded = await request.post('/api/v1/content/packs', { data: example });
  expect([200, 201]).toContain(loaded.status());
});

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

test('the subject home leads to the material, and a source opens with its origin and what rests on it, at an address that survives a reload', async ({ page }) => {
  await page.goto('/subjects/example-subject');

  const block = page.locator('aside .home-block[data-module="reader"]');
  await expect(block.locator('p')).toHaveText('1 källa, från Exempelförlaget.');
  await block.getByRole('link', { name: 'Öppna källorna' }).click();

  await expect(page).toHaveURL('/subjects/example-subject/reader');
  await expect(page.getByRole('navigation', { name: 'Ämnet' }).getByRole('link', { name: 'Material' })).toHaveAttribute('aria-current', 'page');
  const row = page.locator('.src-row[data-source="exempelkalla"]');
  await expect(row.getByRole('heading')).toHaveText('Exempelkälla om energi och effekt');
  await expect(row.locator('.origin-line')).toContainText('Exempelförlaget');
  await expect(row.locator('.uses')).toHaveText('3 lektioner8 frågor');

  await row.getByRole('link', { name: 'Exempelkälla om energi och effekt' }).click();

  await expect(page).toHaveURL('/subjects/example-subject/reader/exempelkalla');
  const origin = page.getByRole('region', { name: 'Ursprung' });
  await expect(origin.locator('dd').first()).toHaveText('Exempelförlaget');
  await expect(origin.getByRole('link', { name: 'example.org' })).toHaveAttribute('href', 'https://example.org/energi');
  const rests = page.getByRole('complementary', { name: 'Det här vilar på källan' });
  await expect(rests.locator('> p')).toHaveText('3 lektioner, 8 frågor och 2 begrepp.');
  // Lessons mark each citing lesson; none has been begun when this file runs.
  await expect(rests.locator('li')).toHaveText(['Energi och effektInte påbörjad · 3 frågor', 'EnhetsprefixInte påbörjad · 3 frågor', 'EnergibalansInte påbörjad · 2 frågor']);
  await expect(rests.locator('dt')).toHaveText(['Effekt', 'Energi']);
  await expect(page).toHaveTitle('Exempelkälla om energi och effekt · Exempelämne');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Exempelkälla om energi och effekt' })).toBeVisible();

  await page.getByRole('link', { name: '← Alla källor' }).click();
  await expect(page).toHaveURL('/subjects/example-subject/reader');
});

test('a search finds a word from its start and says when nothing matches', async ({ page }) => {
  await page.goto('/subjects/example-subject/reader');
  const search = page.getByRole('searchbox', { name: 'Sök i källorna' });

  // The library listens for "/" once it has loaded and drawn its search box.
  await expect(search).toBeVisible();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await search.fill('enhetsprefix');
  await expect(page.locator('.src-row mark')).toHaveText('enhetsprefix');

  await search.fill('nhetsprefix');
  await expect(page.locator('.result-count')).toHaveText('Inga källor innehåller ”nhetsprefix”.');
});

test('an unknown source is answered with “no such source”, naming its id', async ({ page }) => {
  await page.goto('/subjects/example-subject/reader/no-such-source');

  const alert = page.getByRole('alert');
  await expect(alert.getByRole('heading')).toHaveText('Källan finns inte');
  await expect(alert.locator('code')).toHaveText('no-such-source');
});

test('at phone width neither the library nor a source scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['/subjects/example-subject/reader', '/subjects/example-subject/reader/exempelkalla']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.src-row, .source-title').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBe(0);
  }
});
