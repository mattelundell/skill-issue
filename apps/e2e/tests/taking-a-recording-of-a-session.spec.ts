import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { SessionFileSchema, type Pack } from '@skill-issue/contract';
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

/** A note, so the Notes tab has a search to type into; removed again afterwards, since later files read the notes. */
const NOTE = '/api/v1/notes/subjects/example-subject/lessons/energi-och-effekt/steps/0';

test.beforeEach(async ({ request }) => {
  expect((await request.put(NOTE, { data: { body: 'En anteckning att söka i.' } })).status()).toBe(200);
});

test.afterEach(async ({ request }) => {
  expect((await request.put(NOTE, { data: { body: ' ' } })).status()).toBe(204);
});

test('a session is recorded from the footer, without what was typed, and exported as one file', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Felsökning' }).click();
  await expect(page).toHaveURL('/diagnostics');
  await page.getByRole('button', { name: 'Börja spela in' }).click();
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Spelar in' })).toBeVisible();

  // A whole page load: what was held goes in the beacon as the page leaves, and the new page goes on recording.
  await page.goto('/subjects/example-subject/notes');
  const search = page.getByRole('searchbox', { name: 'Sök i anteckningarna' });
  await search.fill('hemligt sökord');
  // The search asks the server once typing pauses.
  await page.waitForResponse((response) => response.url().includes('/api/v1/notes/subjects/example-subject/notes?q='));
  await search.press('Escape');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Spelar in' }).click();
  await page.getByRole('button', { name: 'Sluta spela in' }).click();
  await expect(page.getByRole('button', { name: 'Börja spela in' })).toBeVisible();
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Felsökning' })).toBeVisible();

  const row = page.locator('.recording-row').first();
  const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('link', { name: 'Exportera' }).click()]);
  const text = await readFile(await download.path(), 'utf8');
  const file = SessionFileSchema.parse(JSON.parse(text));

  expect(download.suggestedFilename()).toMatch(/^skill-issue-session-\d+-\d{4}-\d{2}-\d{2}\.json$/);
  expect(file.recording).toMatchObject({ endedBy: 'learner', client: { interfaceLanguage: 'sv' } });
  const seen = file.events.map(({ source, event }) => {
    switch (event.kind) {
      case 'call':
        return `${source} ${event.method} ${event.url}`;
      case 'navigate':
        return `${source} navigate ${event.page}`;
      case 'click':
        return `${source} click ${event.name ?? event.element}`;
      case 'key':
        return `${source} key ${event.key}${event.inField ? ' in a field' : ''}`;
      case 'error':
      case 'rejection':
      case 'visibility':
      case 'fault':
        return `${source} ${event.kind}`;
      default: {
        const unhandled: never = event;
        return unhandled;
      }
    }
  });
  // In the order they happened, each kind of thing the session did.
  const inOrder = [
    'interface navigate /diagnostics',
    'interface navigate /subjects/example-subject/notes',
    'api GET /api/v1/notes/subjects/example-subject/notes?q=…',
    'interface key Escape in a field',
    'interface click Spelar in',
    'interface navigate /diagnostics',
    'interface click Sluta spela in',
  ];
  // Each found after the one before it: a page visited twice is two lines.
  let from = 0;
  const found = inOrder.map((line) => {
    const at = seen.indexOf(line, from);
    from = at + 1;
    return at >= 0 ? line : `missing: ${line}`;
  });
  expect({ found, seen }).toEqual({ found: inOrder, seen });
  // Nothing typed is in the file, not even through the address the search asked.
  expect(text).not.toContain('hemligt');
  expect(text).not.toContain('sökord');

  // Removed again, so later files find no recording of this one's.
  await row.getByRole('button', { name: 'Ta bort' }).click();
  await row.getByRole('button', { name: 'Ta bort för gott' }).click();
  await expect(page.getByText('Inga inspelningar ännu.')).toBeVisible();
});
