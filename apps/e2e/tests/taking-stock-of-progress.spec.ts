import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { SubjectProgressSchema, type Pack } from '@skill-issue/contract';
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
 * Runs after the lesson, exam and review files, which answered questions in
 * "Energi och effekt" today — "kwh-eller-kw" wrong among them — and passed its
 * exam. What the figures are is the module's own tests' business, worked by
 * hand; here the page is held to what the server says.
 */

/*
 * The share remembered on a start-screen row is not tested here: with one
 * subject loaded, the resume panel offers it and its row is hidden.
 */

const percent = (share: number): string => `${String(Math.floor(share * 100 + 1e-9))} %`;

test('the Progress tab shows what is remembered by area and lesson, the last days and the weak spots, as the server counts them', async ({ page, request }) => {
  const response = await request.get('/api/v1/progress/subjects/example-subject?timeZone=Europe/Stockholm');
  expect(response.status()).toBe(200);
  const progress = SubjectProgressSchema.parse(await response.json());
  expect(progress.met).toBeGreaterThanOrEqual(2);

  await page.goto('/subjects/example-subject');
  await page.getByRole('link', { name: 'Framsteg' }).click();
  await expect(page).toHaveURL('/subjects/example-subject/progress');

  await expect(page.locator('#progress-recall')).toHaveText(`${percent(progress.recall ?? 0)} av ämnets frågor minns du just nu`.replace(' %', ' %'));
  await expect(page.getByText(`Du har svarat på ${String(progress.met)} av 8 frågor.`)).toBeVisible();

  const grunder = page.getByRole('region', { name: 'Grunder' });
  await expect(grunder.getByRole('listitem')).toHaveCount(2);
  const energibalans = progress.areas[1]?.lessons[0];
  const state = energibalans?.mastered === true ? 'Behärskad' : energibalans?.passed === true ? 'Godkänd' : '';
  await expect(page.getByRole('region', { name: 'Fördjupning' }).getByRole('listitem')).toHaveText([`Energibalans${state}${percent(energibalans?.recall ?? 0)}`.replace(' %', '\u00a0%')]);
  const lesson = progress.areas[0]?.lessons[0];
  expect(lesson?.passed).toBe(true);
  await expect(grunder.getByRole('listitem').first()).toContainText(lesson?.mastered === true ? 'Behärskad' : 'Godkänd');

  const time = page.getByRole('region', { name: 'Över tid' });
  await expect(time.locator('rect.answers')).toHaveCount(progress.days.filter((day) => day.answers > 0).length);

  // "kwh-eller-kw" was answered wrong, and it tests "effekt".
  const weak = page.getByRole('region', { name: 'Svaga punkter' });
  await expect(weak.locator('li b').filter({ hasText: /^effekt$/ })).toHaveCount(1);
  await weak.getByRole('link', { name: 'Energi och effekt' }).first().click();
  await expect(page).toHaveURL(/\/subjects\/example-subject\/lessons\/energi-och-effekt/);
});
