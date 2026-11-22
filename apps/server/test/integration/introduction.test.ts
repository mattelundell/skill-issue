import { join } from 'node:path';
import { readFolder, writeZip } from '@skill-issue/pack';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCatalogue } from '../../src/core/catalogue/catalogue.js';
import { introduce } from '../../src/core/introduction.js';
import { install, type Installation } from './installation.js';

const EXAMPLES = join(import.meta.dirname, '..', '..', '..', '..', 'examples');
const INTRODUCTION = join(EXAMPLES, 'introduction');

let here: Installation;

beforeEach(async () => {
  here = await install();
});

afterEach(async () => {
  await here.drop();
});

const listed = async (): Promise<unknown> => (await here.app.request('/api/v1/content/subjects')).json();
const revisions = async (): Promise<number> => Number((await here.db.query('SELECT count(*) AS n FROM catalogue.revision'))[0]?.['n']);

describe('the introduction on the first start', () => {
  it('is loaded into an installation that holds no subject, as an introduction in both languages', async () => {
    expect(await introduce(here.db, createCatalogue(here.db), INTRODUCTION)).toBe('loaded');

    expect(await listed()).toEqual([
      {
        id: 'kom-igang',
        defaultLanguage: 'sv',
        languages: ['en', 'sv'],
        title: 'Kom igång',
        summary: 'En kort rundtur i appen — några minuter, och inget här kan bli fel. Den försvinner från startsidan när du är klar.',
        role: 'introduction',
      },
    ]);
  });

  it('is not loaded again on the next start', async () => {
    await introduce(here.db, createCatalogue(here.db), INTRODUCTION);
    const before = await revisions();

    expect(await introduce(here.db, createCatalogue(here.db), INTRODUCTION)).toBe('not-empty');

    expect(await revisions()).toBe(before);
  });

  it('leaves an installation that already holds a subject alone', async () => {
    const read = await readFolder(join(EXAMPLES, 'example-subject'));
    if (!read.ok) {
      throw new Error(`example unreadable: ${JSON.stringify(read.error)}`);
    }
    const loaded = await here.app.request('/api/v1/content/packs', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: new Uint8Array(writeZip(read.value, 'example-subject')).buffer,
    });
    expect(loaded.status).toBe(201);

    expect(await introduce(here.db, createCatalogue(here.db), INTRODUCTION)).toBe('not-empty');

    expect(((await listed()) as { id: string }[]).map((subject) => subject.id)).toEqual(['example-subject']);
  });

  it('says it failed, and stores nothing, when its folder cannot be read; the application starts all the same', async () => {
    expect(await introduce(here.db, createCatalogue(here.db), join(EXAMPLES, 'no-such-folder'))).toBe('failed');

    expect(await listed()).toEqual([]);
  });
});
