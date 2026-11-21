import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Pack } from '@skill-issue/contract';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');
const LESSON = '/subjects/example-subject/lessons/energibalans';

// The steps of this file build on one another: a check half answered, left, taken up again, finished.
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

test('a check half answered and left shows its answer when the lesson is opened again, and asks the rest', async ({ page }) => {
  await page.goto(LESSON);
  while ((await page.locator('.step-kind').textContent()) !== 'Kontroll') {
    await page.getByRole('button', { name: 'Fortsätt' }).click();
  }
  const ways = page.locator('[data-question="vagar-ut"]');
  await ways.getByRole('checkbox', { name: /Genom fönster/ }).check();
  await ways.getByRole('button', { name: 'Svara' }).click();
  await expect(ways.locator('.feedback')).toContainText('Inte rätt.');

  // Left before the second question: nothing of the page survives, only what the server kept.
  await page.getByRole('link', { name: 'Lämna lektionen' }).click();
  await expect(page).toHaveURL('/subjects/example-subject');
  await page.goto(LESSON);

  await expect(page.locator('.step-kind')).toHaveText('Kontroll');
  const again = page.locator('[data-question="vagar-ut"]');
  await expect(again.locator('.given')).toHaveText('Ditt svar: Genom fönster');
  await expect(again.locator('.feedback')).toContainText('Inte rätt.');
  await expect(again.getByRole('button', { name: 'Svara' })).toHaveCount(0);
  const balance = page.locator('[data-question="forklara-balans"]');
  await expect(balance.getByRole('button', { name: 'Visa svaret' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Avsluta lektionen' })).toBeDisabled();
});

test('the question answered wrong before leaving is asked again before the lesson ends', async ({ page }) => {
  await page.goto(LESSON);
  const balance = page.locator('[data-question="forklara-balans"]');
  await balance.getByRole('button', { name: 'Visa svaret' }).click();
  await balance.getByRole('radio', { name: 'Jag kunde det', exact: true }).check();
  await balance.getByRole('button', { name: 'Svara' }).click();
  await expect(balance.locator('.feedback')).toContainText('Rätt.');

  await page.getByRole('button', { name: 'Avsluta lektionen' }).click();

  await expect(page.locator('.step-kind')).toHaveText('Igen');
  const ways = page.locator('[data-question="vagar-ut"]');
  // Asked afresh: no earlier answer stands in for this round's.
  await expect(ways.locator('.given')).toHaveCount(0);
  await ways.getByRole('checkbox', { name: /Genom fönster/ }).check();
  await ways.getByRole('checkbox', { name: /Med ventilationsluften/ }).check();
  await ways.getByRole('button', { name: 'Svara' }).click();
  await expect(ways.locator('.feedback')).toContainText('Rätt.');
  await page.getByRole('button', { name: 'Avsluta lektionen' }).click();

  await expect(page.getByRole('heading', { name: 'Lektionen är genomgången' })).toBeVisible();
});

test('opened again after its end, the lesson begins a new pass with every check asked afresh', async ({ page }) => {
  await page.goto(LESSON);
  while ((await page.locator('.step-kind').textContent()) !== 'Kontroll') {
    await page.getByRole('button', { name: 'Fortsätt' }).click();
  }
  await expect(page.locator('[data-question="vagar-ut"]').getByRole('button', { name: 'Svara' })).toBeVisible();
  await expect(page.locator('.given')).toHaveCount(0);
});
