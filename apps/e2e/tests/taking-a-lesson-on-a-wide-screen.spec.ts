import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

/**
 * Reading a lesson on a laptop and a large screen: the line holds 55–75
 * characters in the workbench and in focus mode, with the note pane open and
 * closed, while a phone keeps its one column.
 */

const SUBJECT = join(import.meta.dirname, '..', 'fixtures', 'reading-subject');
const LESSON = '/subjects/reading-subject/lessons/lang-text';

test.beforeAll(async ({ request }) => {
  const files = await readFolder(SUBJECT);
  if (!files.ok) {
    throw new Error(`reading-subject unreadable: ${JSON.stringify(files.error)}`);
  }
  const pack = checkPackFiles(files.value);
  if (!pack.ok) {
    throw new Error(`reading-subject does not check: ${JSON.stringify(pack.error)}`);
  }
  const loaded = await request.post('/api/v1/content/packs', { data: pack.value });
  expect([200, 201]).toContain(loaded.status());
});

/**
 * Characters on each full line of the step's longest paragraph, read from the
 * rendered text: every character's line is taken from its own box, so this is
 * what the reader sees, not an estimate from a width.
 */
async function lineLengths(page: Page): Promise<readonly number[]> {
  return page.locator('article.step .prose-step').evaluate((step) => {
    const paragraph = [...step.querySelectorAll('p')].toSorted((a, b) => (b.textContent ?? '').length - (a.textContent ?? '').length)[0];
    if (paragraph === undefined) {
      return [];
    }
    const lines = new Map<number, number>();
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
      if (!(text instanceof Text)) {
        continue;
      }
      for (let at = 0; at < text.length; at += 1) {
        range.setStart(text, at);
        range.setEnd(text, at + 1);
        const box = range.getClientRects()[0];
        if (box !== undefined) {
          const top = Math.round(box.top);
          lines.set(top, (lines.get(top) ?? 0) + 1);
        }
      }
    }
    // The last line is as long as the paragraph happens to end, so it is left out.
    return [...lines.entries()].toSorted(([a], [b]) => a - b).map(([, count]) => count).slice(0, -1);
  });
}

async function setReading(page: Page, reading: 'bench' | 'focus'): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Fokusläge' });
  if ((await toggle.getAttribute('aria-pressed')) !== String(reading === 'focus')) {
    await toggle.click();
  }
  await expect(page.locator('.lesson')).toHaveAttribute('data-reading', reading);
}

async function setNotes(page: Page, open: boolean): Promise<void> {
  const pane = page.getByRole('textbox', { name: /Anteckning vid steg/ });
  if ((await pane.count()) > 0 !== open) {
    await page.locator('.nav .side-toggle').click();
  }
  await expect(pane).toHaveCount(open ? 1 : 0);
}

for (const width of [1440, 1920]) {
  test(`at ${width}px a line holds 55–75 characters in both ways of reading, with the note pane open and closed`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${LESSON}/1`);
    await expect(page.getByRole('heading', { name: 'Förluster mot tillskott' })).toBeVisible();

    const measured: string[] = [];
    for (const reading of ['bench', 'focus'] as const) {
      await setReading(page, reading);
      for (const open of [false, true]) {
        await setNotes(page, open);
        const lengths = await lineLengths(page);
        measured.push(`${reading} ${open ? 'open' : 'closed'}: ${lengths.join(' ')}`);
        expect(lengths.length, measured.at(-1)).toBeGreaterThanOrEqual(3);
        for (const length of lengths) {
          expect(length, measured.at(-1)).toBeGreaterThanOrEqual(55);
          expect(length, measured.at(-1)).toBeLessThanOrEqual(75);
        }
      }
    }
    await setNotes(page, false);
    test.info().annotations.push({ type: 'characters per line', description: measured.join(' | ') });
  });
}

test('the workbench shows the lesson’s steps and sources on the left and the step’s terms on the right of the text', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${LESSON}/1`);
  await setReading(page, 'bench');

  const text = await page.locator('article.step').boundingBox();
  const rail = await page.getByRole('navigation', { name: 'Lektionens steg' }).boundingBox();
  const terms = page.getByRole('region', { name: 'Begrepp i steget' });
  await expect(terms.locator('dfn')).toHaveText(['Balanstemperatur']);
  const right = await terms.boundingBox();
  expect(text && rail && right).toBeTruthy();
  if (text && rail && right) {
    expect(rail.x + rail.width).toBeLessThanOrEqual(text.x);
    expect(right.x).toBeGreaterThanOrEqual(text.x + text.width);
  }

  // Pointing at the term lights its entry, and opens nothing over the text.
  await page.locator('article.step button.term').hover();
  await expect(page.locator('.step-term.lit dfn')).toHaveText('Balanstemperatur');
  await expect(page.locator('.term-card')).toHaveCount(0);
});

test('switching the way of reading keeps the step, an open note and the place on the page, and is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(`${LESSON}/2`);
  await expect(page.getByRole('heading', { name: 'En andra sida' })).toBeVisible();
  await setReading(page, 'bench');
  await setNotes(page, true);
  const note = page.getByRole('textbox', { name: 'Anteckning vid steg 2' });
  await note.fill('Läsläget växlas med F.');

  await note.blur();

  await page.keyboard.press('f');
  await expect(page.locator('.lesson')).toHaveAttribute('data-reading', 'focus');
  await expect(page.locator('.stepcount')).toHaveText('Steg 2 av 2');
  await expect(note).toHaveValue('Läsläget växlas med F.');
  await expect(page.getByRole('heading', { name: 'En andra sida' })).toBeInViewport();

  await page.reload();
  await expect(page.locator('.lesson')).toHaveAttribute('data-reading', 'focus');
  await setReading(page, 'bench');
});

test('a phone keeps its one column: no switch, no columns beside the text, and nothing wider than the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${LESSON}/1`);
  await expect(page.getByRole('heading', { name: 'Förluster mot tillskott' })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Fokusläge' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Lektionens steg' })).toBeHidden();
  expect(await page.locator('.prose-step').evaluate((step) => getComputedStyle(step).fontSize)).toBe('16.8px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // A term opens its card where it is, since nothing stands beside the text.
  await page.locator('article.step button.term').click();
  await expect(page.locator('.term-card dfn')).toHaveText('Balanstemperatur');
});
