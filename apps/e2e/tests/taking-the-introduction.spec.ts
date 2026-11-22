import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { checkPackFiles, readFolder } from '@skill-issue/pack';

const INTRODUCTION = join(import.meta.dirname, '..', '..', '..', 'examples', 'introduction');

test.beforeAll(async ({ request }) => {
  const files = await readFolder(INTRODUCTION);
  if (!files.ok) {
    throw new Error(`introduction unreadable: ${JSON.stringify(files.error)}`);
  }
  const pack = checkPackFiles(files.value);
  if (!pack.ok) {
    throw new Error(`introduction does not check: ${JSON.stringify(pack.error)}`);
  }
  const loaded = await request.post('/api/v1/content/packs', { data: pack.value });
  expect([200, 201]).toContain(loaded.status());
});

test('the introduction is listed first, taken in a few steps without studying, and then leaves the start page with a way back', async ({ page }) => {
  await page.goto('/');
  // First among the subjects, whatever its id sorts as.
  await expect(page.locator('.ledger-row').first()).toHaveAttribute('data-subject', 'kom-igang');
  await page.getByRole('link', { name: 'Börja: Kom igång' }).click();
  await page.locator('.home-block[data-module="lessons"]').getByRole('link', { name: 'Börja' }).click();

  // The first lesson: two steps, a question that is hard to get wrong, a last step.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Så läser du');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.getByRole('radio', { name: 'Sant' }).check();
  await page.getByRole('button', { name: 'Svara' }).click();
  await expect(page.getByText('Efter varje svar står vad som var rätt och varför.')).toBeVisible();
  await page.getByRole('button', { name: 'Fortsätt' }).click();
  await page.getByRole('button', { name: 'Avsluta lektionen' }).click();
  await expect(page.getByRole('heading', { name: 'Lektionen är genomgången' })).toBeVisible();

  // The second: free recall, graded by the learner.
  await page.getByRole('link', { name: 'Nästa lektion: Det som händer sen' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Det som händer sen');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Visa svaret' }).click();
  await page.getByRole('radio', { name: 'Jag kunde det', exact: true }).check();
  await page.getByRole('button', { name: 'Svara' }).click();
  await page.getByRole('button', { name: 'Fortsätt' }).click();
  await expect(page.locator('.step')).toContainText('Klart! Introduktionen försvinner nu från startsidan.');
  await page.getByRole('button', { name: 'Avsluta lektionen' }).click();
  await expect(page.getByRole('heading', { name: 'Lektionen är genomgången' })).toBeVisible();

  await page.goto('/');
  const back = page.getByRole('link', { name: 'Visa introduktionen igen: Kom igång' });
  await expect(back).toBeVisible();
  await expect(page.locator('.ledger-row[data-subject="kom-igang"]')).toHaveCount(0);
  await back.click();
  await expect(page).toHaveURL('/subjects/kom-igang');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kom igång');
});
