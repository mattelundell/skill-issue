import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Pack } from '@skill-issue/contract';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');
const LESSON = '/subjects/example-subject/lessons/energibalans';
const NOTEBOOK = '/api/v1/notes/subjects/example-subject/notebook';

/** A one-pixel PNG, as a screenshot pasted from the clipboard would arrive. */
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// The steps of this file build on one another: written, formatted, browsed, searched, exported.
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

test.afterAll(async ({ request }) => {
  // Later files read the notebook, so what this one wrote goes again.
  for (const path of ['lessons/energibalans', 'areas/grunder']) {
    expect((await request.put(`${NOTEBOOK}/${path}`, { data: { body: ' ' } })).status()).toBe(204);
  }
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

test('the notebook opens beside a lesson at its section, quotes the step, and keeps what is written', async ({ page }) => {
  await page.goto(`${LESSON}/1`);
  await expect(page.locator('.stepcount')).toHaveText('Steg 1 av 2');

  await page.keyboard.press('n');
  const notebook = page.getByRole('region', { name: 'Anteckningsboken' });
  await expect(notebook.getByRole('heading', { name: 'Energibalans' })).toBeVisible();
  const field = notebook.getByRole('textbox', { name: 'Anteckning under Energibalans' });
  await expect(field).toBeFocused();

  await field.fill('Allt som går in går ut igen.');
  await expect(notebook.locator('.status output')).toHaveText('Sparat');

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
  await expect(notebook.locator('.status output')).toHaveText('Sparat');

  await page.reload();
  await page.getByRole('button', { name: /^Anteckningsboken/ }).click();
  await expect(page.getByRole('textbox', { name: 'Anteckning under Energibalans' })).toHaveValue('Allt som går in går ut igen.\n\n> genom väggar, fönster\n\n');
});

test('the bar formats the selection, ⌘Z undoes it, and Escape reads the note without closing the notebook', async ({ page }) => {
  await page.goto(`${LESSON}/1`);
  await expect(page.locator('.stepcount')).toHaveText('Steg 1 av 2');
  await page.keyboard.press('n');
  const notebook = page.getByRole('region', { name: 'Anteckningsboken' });
  const field = notebook.getByRole('textbox', { name: 'Anteckning under Energibalans' });
  await expect(field).toBeFocused();
  const before = await field.inputValue();
  const start = before.indexOf('Allt');
  await field.evaluate((element, at) => {
    if (element instanceof HTMLTextAreaElement) {
      element.setSelectionRange(at, at + 4);
    }
  }, start);

  await notebook.getByRole('button', { name: 'Fet' }).click();
  await expect(field).toHaveValue(before.replace('Allt', '**Allt**'));
  await page.keyboard.press('ControlOrMeta+z');
  await expect(field).toHaveValue(before);
  await page.keyboard.press('ControlOrMeta+b');
  await expect(field).toHaveValue(before.replace('Allt', '**Allt**'));

  await page.keyboard.press('Escape');
  await expect(notebook).toBeVisible();
  await expect(notebook.getByRole('textbox')).toHaveCount(0);
  await expect(notebook.locator('.read-note strong')).toHaveText('Allt');
  // Enter on the note as read writes in it again, and does not move the lesson on.
  await page.keyboard.press('Enter');
  await expect(notebook.getByRole('textbox')).toBeFocused();
  await expect(page.locator('.stepcount')).toHaveText('Steg 1 av 2');
});

test('an image pasted into a note is kept, linked and drawn from the notebook', async ({ page }) => {
  await page.goto(`${LESSON}/1`);
  await expect(page.locator('.stepcount')).toHaveText('Steg 1 av 2');
  await page.keyboard.press('n');
  const notebook = page.getByRole('region', { name: 'Anteckningsboken' });
  const field = notebook.getByRole('textbox', { name: 'Anteckning under Energibalans' });
  await expect(field).toBeFocused();

  await field.evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'skärm.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PIXEL_PNG);

  await expect(field).toHaveValue(/!\[Inklistrad bild\]\(bilder\/bild-\d+\.png\)/);
  await expect(notebook.locator('.status output')).toHaveText('Sparat');
  await page.keyboard.press('Escape');
  const image = notebook.getByRole('img', { name: 'Inklistrad bild' });
  await expect(image).toBeVisible();
  // Loaded, not merely placed: an image that failed would be swapped for its text, and one still loading is 0 wide.
  await expect.poll(async () => image.evaluate((element) => (element instanceof HTMLImageElement ? element.naturalWidth : -1))).toBe(1);
});

test('a section under another area is written from the lesson, through the contents', async ({ page }) => {
  await page.goto(`${LESSON}/1`);
  await expect(page.locator('.stepcount')).toHaveText('Steg 1 av 2');
  await page.keyboard.press('n');
  const notebook = page.getByRole('region', { name: 'Anteckningsboken' });
  const contents = notebook.getByRole('navigation', { name: 'Innehåll' });

  await contents.getByText('Grunder').click();
  await contents.getByRole('link', { name: 'Grunder' }).click();
  await expect(notebook.getByText('Du skriver under en annan lektion.')).toBeVisible();
  await notebook.getByRole('textbox', { name: 'Anteckning under Om området' }).fill('Storheterna först.');
  await expect(notebook.locator('.status output')).toHaveText('Sparat');

  await notebook.getByRole('button', { name: 'Till denna lektion' }).click();
  await expect(notebook.getByRole('heading', { name: 'Energibalans' })).toBeVisible();
});

test('the Notes tab reads the notebook in the order of the path, searches it, and exports it as a zip', async ({ page }) => {
  await page.goto('/subjects/example-subject');
  const block = page.locator('.home-block[data-module="notes"]');
  await expect(block).toContainText('2 avsnitt skrivna, senast i Grunder.');
  await block.getByRole('link', { name: 'Öppna anteckningsboken' }).click();

  await expect(page).toHaveURL('/subjects/example-subject/notes');
  const document = page.getByRole('article');
  await page.getByRole('checkbox', { name: 'Bara skrivna avsnitt' }).check();
  await expect(document.locator('[data-section]')).toHaveCount(2);
  await expect(document.locator('[data-section]').first()).toHaveAttribute('data-section', 'area/grunder');
  await expect(document.locator('[data-section="lesson/energibalans"] blockquote')).toHaveText('genom väggar, fönster');

  const search = page.getByRole('searchbox', { name: 'Sök i anteckningsboken' });
  await search.fill('storhet');
  await expect(document.locator('[data-section]')).toHaveCount(1);
  await expect(document.locator('[data-section]')).toHaveAttribute('data-section', 'area/grunder');
  await search.fill('');

  await page.getByRole('button', { name: 'Exportera …' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('link', { name: 'Exportera' }).click();
  expect((await download).suggestedFilename()).toBe('example-subject-anteckningar.zip');
});

test('every notebook is reached from the start screen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Anteckningsböcker' }).click();

  await expect(page).toHaveURL('/notes');
  await expect(page).toHaveTitle('Anteckningsböcker · Skill Issue');
  const book = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Exempelämne' }) });
  await expect(book).toContainText('2 avsnitt skrivna');
  await book.getByRole('link', { name: 'Öppna' }).click();
  await expect(page).toHaveURL('/subjects/example-subject/notes');
});
