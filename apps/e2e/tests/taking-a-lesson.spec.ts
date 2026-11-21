import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Pack } from '@skill-issue/contract';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');
const LESSON = '/subjects/example-subject/lessons/energi-och-effekt';

// The steps of this file build on one another: begun, left, resumed, finished.
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

test('the subject home suggests the first lesson, and the lesson is taken a step at a time', async ({ page }) => {
  await page.goto('/subjects/example-subject');
  await expect(page.getByRole('heading', { name: 'Börja med Energi och effekt' })).toBeVisible();

  await page.locator('.home-block[data-module="lessons"]').getByRole('link', { name: 'Börja' }).click();

  await expect(page).toHaveURL(LESSON);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Energi och effekt');
  await expect(page.locator('.stepcount')).toHaveText('Steg 1 av 3');
  await expect(page.locator('.step')).toContainText('Effekt är hur fort energi används');

  await page.getByRole('button', { name: 'Fortsätt' }).click();
  await expect(page.locator('.stepcount')).toHaveText('Steg 2 av 3');
  await expect(page.locator('.step-kind')).toHaveText('Exempel');
});

test('left midway, the lesson is marked on the path and offered on the start screen, and opens where it was left', async ({ page }) => {
  await page.goto(LESSON);
  await expect(page.locator('.stepcount')).toHaveText('Steg 2 av 3');
  await expect(page.getByRole('note')).toContainText('Välkommen tillbaka. Du fortsätter där du slutade, på steg 2 av 3.');

  await page.getByRole('link', { name: 'Lämna lektionen' }).click();
  await expect(page).toHaveURL('/subjects/example-subject');
  await expect(page.locator('li[data-lesson="energi-och-effekt"] .state-word')).toHaveText('Pågår, steg 2 av 3');
  await expect(page.getByRole('heading', { name: 'Fortsätt: Energi och effekt' })).toBeVisible();

  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Exempelämne' });
  await expect(panel.getByText('Fortsätt där du slutade')).toBeVisible();
  await expect(panel.getByText('Grunder: Energi och effekt, steg 2 av 3')).toBeVisible();
  await panel.getByRole('link', { name: 'Fortsätt' }).click();

  await expect(page).toHaveURL(LESSON);
  await expect(page.locator('.stepcount')).toHaveText('Steg 2 av 3');
  await page.reload();
  await expect(page.locator('.stepcount')).toHaveText('Steg 2 av 3');
});

test('gone through to its end, the lesson offers the next one, and says so on the path', async ({ page }) => {
  await page.goto(LESSON);
  await page.getByRole('button', { name: 'Fortsätt' }).click();
  await expect(page.locator('.step-kind')).toHaveText('Kontroll');
  await expect(page.locator('.placeholder')).toContainText('Här finns en kontroll med 2 frågor');

  await page.getByRole('button', { name: 'Avsluta lektionen' }).click();

  await expect(page.getByRole('heading', { name: 'Lektionen är genomgången' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nästa lektion: Enhetsprefix' })).toHaveAttribute('href', '/subjects/example-subject/lessons/enhetsprefix');
  await page.getByRole('link', { name: 'Till ämnet' }).click();
  await expect(page.locator('li[data-lesson="energi-och-effekt"] .state-word')).toHaveText('Pågår, alla steg genomgångna');
  await expect(page.getByRole('heading', { name: 'Nästa lektion: Enhetsprefix' })).toBeVisible();
});

test('a lesson draws its image from the subject’s files', async ({ page }) => {
  await page.goto('/subjects/example-subject/lessons/energibalans');

  const image = page.getByRole('img', { name: 'Energiflöde genom en byggnad' });
  await expect(image).toBeVisible();
  await expect.poll(async () => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
});

test('a source links each lesson resting on it, with its state, and the lesson links back to the source', async ({ page }) => {
  await page.goto('/subjects/example-subject/reader/exempelkalla');
  const rests = page.getByRole('complementary', { name: 'Det här vilar på källan' });
  const lesson = rests.locator('li[data-lesson="energi-och-effekt"]');
  await expect(lesson.locator('.sub')).toContainText('Pågår, alla steg genomgångna');

  await lesson.getByRole('link', { name: 'Energi och effekt' }).click();

  await expect(page).toHaveURL(LESSON);
  await page.getByRole('link', { name: 'Exempelkälla om energi och effekt (Exempelförlaget)' }).click();
  await expect(page).toHaveURL('/subjects/example-subject/reader/exempelkalla');
});
