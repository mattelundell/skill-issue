import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Pack } from '@skill-issue/contract';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');
const LESSON = '/subjects/example-subject/lessons/energi-och-effekt';

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

test.beforeEach(async ({ page }) => {
  // A term's card opens over the text in focus mode, and on a phone; on the workbench it stands beside the text instead (taking-a-lesson-on-a-wide-screen).
  await page.addInitScript(() => window.localStorage.setItem('skill-issue.lessons.reading', 'focus'));
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

test('a glossary term in a text step shows its definition and its source, and the source opens from it', async ({ page }) => {
  // Opened at its first step by address, whatever earlier files left it at.
  await page.goto(`${LESSON}/1`);
  const step = page.locator('article.step');
  await expect(page.locator('.stepcount')).toHaveText('Steg 1 av 3');

  // Each term once, where the step first names it: "Effekt" in bold, and "energi" in the same sentence before its own bold line.
  const marks = step.locator('button.term');
  await expect(marks).toHaveText(['Effekt', 'energi']);

  await step.getByRole('button', { name: 'Effekt' }).hover();
  const card = page.locator('.term-card');
  await expect(card).toBeVisible();
  await expect(card.locator('dfn')).toHaveText('Effekt');
  await expect(card.locator('.term-definition')).toHaveText('Energi per tidsenhet. Mäts i watt (W).');
  await expect(card.locator('.term-also')).toHaveText('Kallas också power');
  await expect(step.getByRole('button', { name: 'Effekt' })).toHaveAttribute('aria-expanded', 'true');

  // The card sits under its mark, inside the step, not off at the page's edge.
  const at = await step.getByRole('button', { name: 'Effekt' }).boundingBox();
  const box = await card.boundingBox();
  const within = await step.boundingBox();
  expect(at && box && within).toBeTruthy();
  if (at && box && within) {
    expect(box.y).toBeGreaterThan(at.y + at.height - 1);
    expect(box.y - (at.y + at.height)).toBeLessThan(16);
    expect(box.x).toBeGreaterThanOrEqual(within.x);
    expect(box.x + box.width).toBeLessThanOrEqual(within.x + within.width);
  }

  await card.getByRole('link', { name: 'Exempelkälla om energi och effekt' }).click();
  await expect(page).toHaveURL('/subjects/example-subject/reader/exempelkalla');
  await expect(page.getByRole('heading', { name: 'Exempelkälla om energi och effekt' })).toBeVisible();
});

test('a term opens from the keyboard and closes with Escape, back on the term', async ({ page }) => {
  await page.goto(`${LESSON}/1`);
  const step = page.locator('article.step');
  await expect(step.locator('button.term')).toHaveText(['Effekt', 'energi']);

  await step.getByRole('button', { name: 'energi' }).focus();
  await expect(page.locator('.term-card .term-definition')).toHaveText('Förmågan att uträtta arbete. I byggnader mäts den oftast i kilowattimmar (kWh).');

  await page.keyboard.press('Escape');
  await expect(page.locator('.term-card')).toHaveCount(0);
  await expect(step.getByRole('button', { name: 'energi' })).toBeFocused();
});

test('a card near the foot of the window opens above its term, so it is never cut off', async ({ page }) => {
  await page.goto(`${LESSON}/1`);
  const step = page.locator('article.step');
  const mark = step.getByRole('button', { name: 'Effekt' });
  await expect(mark).toBeVisible();

  // A window that ends just under the term leaves no room below it.
  const at = await mark.boundingBox();
  expect(at).toBeTruthy();
  if (at === null) {
    return;
  }
  await page.setViewportSize({ width: 1280, height: Math.ceil(at.y + at.height + 40) });
  await mark.hover();

  const card = page.locator('.term-card');
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  const now = await mark.boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  expect(box && now).toBeTruthy();
  if (box && now) {
    expect(box.y + box.height).toBeLessThanOrEqual(now.y);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
  }
});
