import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');

// Runs after the lesson file: its sittings are the first in this installation.
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
  // Loaded already by an earlier file, or loaded here: the same pack either way.
  const loaded = await request.post('/api/v1/content/packs', { data: pack.value });
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

/** Answers whichever question is on screen, right or wrong, through its own input. */
async function answer(question: Locator, right: boolean): Promise<void> {
  const id = await question.getAttribute('data-question');
  switch (id) {
    case 'kwh-eller-kw':
      await question.getByRole('radio', { name: right ? /kW$/ : /kWh$/ }).check();
      return;
    case 'berakna-energi':
      await question.getByRole('textbox', { name: 'Svar i kWh' }).fill(right ? '6' : '5');
      return;
    case 'effekt-ar-takt':
      await question.getByRole('radio', { name: right ? /Sant/ : /Falskt/ }).check();
      return;
    case null:
    default:
      throw new Error(`no answer written for ${String(id)}`);
  }
}

async function sit(page: Page, right: boolean): Promise<void> {
  await page.goto('/subjects/example-subject/assessment/lesson/energi-och-effekt');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Energi och effekt');
  await page.getByRole('button', { name: 'Börja provet' }).click();
  await expect(page.locator('.stepcount')).toHaveText('Fråga 1 av 2');
  await answer(page.locator('.q[data-question]'), right);
  await expect(page.locator('.feedback')).toHaveCount(0);
  await page.getByRole('button', { name: 'Nästa fråga' }).click();
  await expect(page.locator('.stepcount')).toHaveText('Fråga 2 av 2');
  await answer(page.locator('.q[data-question]'), right);
  await page.getByRole('button', { name: 'Lämna in' }).click();
}

test('a lesson exam sat with wrong answers fails, and reviews every answer with the right one', async ({ page }) => {
  await sit(page, false);

  await expect(page.getByRole('heading', { name: 'Inte godkänt' })).toBeVisible();
  await expect(page.getByText('0 av 2 rätt. Godkänt vid 50 %.')).toBeVisible();
  await expect(page.locator('.review li')).toHaveCount(2);
  await expect(page.locator('.review li .feedback').first()).toContainText('Inte rätt.Rätt svar:');
});

test('sat again with right answers it passes, and the path marks the lesson passed', async ({ page }) => {
  await sit(page, true);

  await expect(page.getByRole('heading', { name: 'Godkänt' })).toBeVisible();
  await expect(page.getByText('2 av 2 rätt. Godkänt vid 50 %.')).toBeVisible();

  await page.getByRole('link', { name: 'Till ämnet' }).click();
  await expect(page.locator('li[data-lesson="energi-och-effekt"]')).toHaveAttribute('data-state', 'passed');
  const area = page.locator('section[data-area="grunder"]');
  await expect(area.getByRole('link', { name: 'Skriv områdesprovet' })).toHaveAttribute('href', '/subjects/example-subject/assessment/area/grunder');
});

test('the area exam draws from every lesson in the area', async ({ page }) => {
  await page.goto('/subjects/example-subject/assessment/area/grunder');
  await page.getByRole('button', { name: 'Börja provet' }).click();

  await expect(page.locator('.stepcount')).toHaveText('Fråga 1 av 4');
});
