import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { readFolder, writeZip } from '@skill-issue/pack';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');

/** The example as a zip under a subject id no other file uses, broken where `broken` says. */
async function zipOf(path: string, broken: boolean): Promise<void> {
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example unreadable: ${JSON.stringify(read.error)}`);
  }
  const files = new Map(read.value);
  for (const file of ['subject.yaml', 'subject.en.yaml']) {
    files.set(file, new TextEncoder().encode(new TextDecoder().decode(files.get(file)).replace('id: example-subject\n', 'id: zip-subject\n')));
  }
  if (broken) {
    files.delete('sources/exempelkalla.md');
  }
  await writeFile(path, writeZip(files, 'zip-subject'));
}

test('a zip chosen on the page is checked by the server, and nothing is stored until the learner says so', async ({ page }, info) => {
  const good = info.outputPath('zip-subject.zip');
  await zipOf(good, false);

  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Ladda in ämne' }).click();
  await expect(page).toHaveURL('/packs');
  await page.getByLabel('Välj fil').setInputFiles(good);

  await expect(page.getByRole('heading', { name: 'Ett nytt ämne: zip-subject' })).toBeVisible();
  await page.getByRole('button', { name: 'Avbryt' }).click();
  // Checked, and cancelled: the subject was never stored.
  expect((await page.request.get('/api/v1/content/subjects/zip-subject')).status()).toBe(404);
});

test('a broken pack is answered with each fault, naming its file', async ({ page }, info) => {
  const broken = info.outputPath('broken.zip');
  await zipOf(broken, true);

  await page.goto('/packs');
  await page.getByLabel('Välj fil').setInputFiles(broken);

  const alert = page.getByRole('alert');
  await expect(alert.getByRole('heading')).toHaveText(/^Paketet har \d+ fel$/);
  await expect(alert.getByRole('listitem').first()).toContainText('exempelkalla');
  expect((await page.request.get('/api/v1/content/subjects/zip-subject')).status()).toBe(404);
});
