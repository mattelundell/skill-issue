import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Pack } from '@skill-issue/contract';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');
const LESSON = '/subjects/example-subject/lessons/energibalans';

// The steps of this file build on one another: written, browsed, searched, followed back.
test.describe.configure({ mode: 'serial' });

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

test('a note is written beside a step, with a quote from the step, and kept', async ({ page }) => {
  // Opened at its first step by address, whatever earlier files left it at.
  await page.goto(`${LESSON}/1`);
  await expect(page.locator('.stepcount')).toHaveText('Steg 1 av 2');
  await expect(page).toHaveURL(LESSON);

  await page.keyboard.press('n');
  const pane = page.getByRole('region', { name: 'Anteckning' });
  await expect(pane.getByText('Energibalans · steg 1')).toBeVisible();
  const field = pane.getByRole('textbox', { name: 'Anteckning vid steg 1' });
  await expect(field).toBeFocused();

  await field.fill('Allt som går in går ut igen.');
  await expect(pane.locator('output')).toHaveText('Sparad. Hamnar under Fördjupning › Energibalans.');

  // Select a phrase in the step, then quote it with the key.
  await page.locator('.step').getByText(/genom väggar, fönster/).evaluate((element) => {
    const text = element.firstChild;
    if (text === null) {
      throw new Error('the step has no text to select');
    }
    const start = (text.textContent ?? '').indexOf('genom väggar');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 'genom väggar, fönster'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press('q');
  await expect(field).toHaveValue('Allt som går in går ut igen.\n\n> genom väggar, fönster\n\n');
  await expect(pane.locator('output')).toHaveText('Sparad. Hamnar under Fördjupning › Energibalans.');

  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Anteckna' }).click();
  await expect(page.getByRole('textbox', { name: 'Anteckning vid steg 1' })).toHaveValue('Allt som går in går ut igen.\n\n> genom väggar, fönster\n\n');
});

test('the note is found by browsing and by search, and links back to its step', async ({ page }) => {
  await page.goto('/subjects/example-subject');
  const block = page.locator('.home-block[data-module="notes"]');
  await expect(block).toContainText('1 anteckning, senast i Energibalans.');
  await block.getByRole('link', { name: 'Bläddra' }).click();

  await expect(page).toHaveURL('/subjects/example-subject/notes');
  await expect(page.getByRole('navigation', { name: 'Ämnet' }).getByRole('link', { name: 'Anteckningar' })).toHaveAttribute('aria-current', 'page');
  const area = page.getByRole('region', { name: 'Fördjupning' });
  const lesson = area.getByRole('article', { name: 'Energibalans' });
  await expect(lesson).toContainText('Allt som går in går ut igen.');
  await expect(lesson.locator('blockquote')).toHaveText('genom väggar, fönster');

  const search = page.getByRole('searchbox', { name: 'Sök i anteckningarna' });
  await search.fill('väg');
  await expect(page.locator('.notes-count')).toHaveText('1 anteckning innehåller ”väg”');
  await search.fill('balans');
  await expect(page.locator('.notes-count')).toHaveText('Inga anteckningar innehåller ”balans”.');
  await search.fill('allt går');
  await expect(page.locator('.notes-count')).toHaveText('1 anteckning innehåller ”allt går”');

  await page.getByRole('link', { name: 'Steg 1' }).click();
  await expect(page).toHaveURL(LESSON);
  await expect(page.locator('.stepcount')).toHaveText('Steg 1 av 2');
});
