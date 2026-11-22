import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Pack } from '@skill-issue/contract';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');

test.beforeAll(async ({ request }) => {
  const files = await readFolder(EXAMPLE);
  if (!files.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(files.error)}`);
  }
  const pack = checkPackFiles(files.value);
  if (!pack.ok) {
    throw new Error(`example pack does not check: ${JSON.stringify(pack.error)}`);
  }
  const example: Pack = pack.value;
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

/*
 * The example subject is written in Swedish, with its subject entry and the
 * lesson "Energi och effekt" translated into English; the rest is not.
 */

test('a subject read in English shows its path in English where translated and marks the rest, while the interface stays Swedish, and keeps what was learnt', async ({ page }) => {
  await page.goto('/subjects/example-subject/progress');
  const remembered = await page.locator('#progress-recall').textContent();

  await page.goto('/subjects/example-subject');
  const picker = page.getByRole('combobox', { name: 'Innehållets språk' });
  await expect(picker).toHaveValue('sv');
  await picker.selectOption('en');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Example subject');
  await expect(page.locator('li[data-lesson="energi-och-effekt"]')).toContainText('Energy and power');
  // Not translated: shown in Swedish, and said so.
  await expect(page.locator('li[data-lesson="energibalans"]')).toContainText('på svenska');
  await expect(page.getByRole('link', { name: 'Översikt' })).toBeVisible();

  // The choice holds after a reload, and the lesson opens in English.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Example subject');
  await page.locator('li[data-lesson="energi-och-effekt"]').getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Energy and power' })).toBeVisible();

  // What is remembered belongs to the questions, not to a language.
  await page.goto('/subjects/example-subject/progress');
  await expect(page.locator('#progress-recall')).toHaveText(remembered ?? '');
});
