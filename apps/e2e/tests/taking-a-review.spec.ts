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
 * Runs after taking-a-lesson.spec.ts, whose check answered "kwh-eller-kw" wrong
 * and then right, and "berakna-energi" right, all today. Only the first answer
 * of a day counts, so the wrong one brings "kwh-eller-kw" back tomorrow, and
 * the right one sends "berakna-energi" away for longer. Nothing is due today:
 * a question due today needs an answer from an earlier day, which a test run
 * within one day cannot give.
 */

test('the subject home says nothing is due today, and that one question comes back tomorrow', async ({ page }) => {
  await page.goto('/subjects/example-subject');

  const block = page.locator('.home-block[data-module="review"]');
  await expect(block.getByRole('heading', { name: 'Inget att repetera i dag' })).toBeVisible();
  await expect(block).toContainText('Nästa repetition i morgon, 1 fråga.');
});

test('the review tab opens a page that says there is nothing to review today, and leads back', async ({ page }) => {
  await page.goto('/subjects/example-subject');
  await page.getByRole('link', { name: 'Repetition' }).click();

  await expect(page).toHaveURL('/subjects/example-subject/review');
  await expect(page.getByRole('heading', { name: 'Inget att repetera i dag' })).toBeVisible();
  await expect(page.getByText('Nästa repetition i morgon, 1 fråga.')).toBeVisible();
  await page.getByRole('link', { name: 'Till ämnet' }).click();
  await expect(page).toHaveURL('/subjects/example-subject');
});
