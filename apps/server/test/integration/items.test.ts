import { join } from 'node:path';
import type { Pack } from '@skill-issue/contract';
import { readFolder, writeZip } from '@skill-issue/pack';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const BASE = '/api/v1/content/subjects/example-subject';

let here: Installation;

beforeEach(async () => {
  here = await install();
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(read.error)}`);
  }
  const loaded = await here.app.request('/api/v1/content/packs', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: new Uint8Array(writeZip(read.value, 'example-subject')).buffer,
  });
  if (loaded.status !== 201) {
    throw new Error(`example pack not loaded: ${loaded.status}`);
  }
});

afterEach(async () => {
  await here.drop();
});

async function put(path: string, body: unknown, query = '', type = 'application/json'): Promise<{ status: number; json: unknown }> {
  const response = await here.app.request(`${BASE}${path}${query}`, { method: 'PUT', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: response.status, json: await response.json() };
}

async function exported(): Promise<Pack> {
  const response = await here.app.request(`${BASE}/pack`);
  expect(response.status).toBe(200);
  // oxlint-disable-next-line typescript/no-unsafe-return -- compared field by field below
  return response.json();
}

const revisions = async (id: string, language = 'sv') =>
  here.db.query("SELECT revision, body->>'prompt' AS prompt FROM catalogue.revision WHERE subject_id = 'example-subject' AND kind = 'question' AND id = $1 AND language = $2 ORDER BY revision", [
    id,
    language,
  ]);

/** A question new to the energi-och-effekt lesson's bank. */
const fresh = {
  language: 'sv',
  lesson: 'energi-och-effekt',
  id: 'watt-ar-joule-per-sekund',
  type: 'true-false',
  concepts: ['effekt'],
  sources: ['exempelkalla'],
  prompt: 'En watt är en joule per sekund.',
  answer: true,
  explanation: 'Effekt är energi per tidsenhet: 1 W = 1 J/s.',
};

describe('one question put into an existing subject', () => {
  it('is added to its lesson’s bank at revision 1, and nothing else in the subject changes', async () => {
    const { status, json } = await put(`/questions/${fresh.id}`, fresh);

    expect(status).toBe(201);
    expect(json).toMatchObject({
      subject: 'example-subject',
      stored: true,
      created: false,
      added: [{ kind: 'question', id: fresh.id, language: 'sv' }],
      changed: [],
      retired: [],
      item: { kind: 'question', id: fresh.id, language: 'sv', revision: 1 },
    });
    expect(await revisions(fresh.id)).toEqual([{ revision: 1, prompt: fresh.prompt }]);
    const asked = await here.app.request(`/api/v1/assessment/subjects/example-subject/questions?ids=${fresh.id}`);
    expect(await asked.json()).toMatchObject({ questions: [{ id: fresh.id, type: 'true-false', prompt: fresh.prompt }] });
    expect((await exported()).questions.find((q) => q.id === fresh.id)).toMatchObject({ lesson: 'energi-och-effekt', language: 'sv' });
  });

  it('put again changed gets revision 2, keeping revision 1', async () => {
    await put(`/questions/${fresh.id}`, fresh);

    const { status, json } = await put(`/questions/${fresh.id}`, { ...fresh, prompt: 'Är en watt en joule per sekund?' });

    expect(status).toBe(200);
    expect(json).toMatchObject({ stored: true, added: [], changed: [{ kind: 'question', id: fresh.id, language: 'sv' }], retired: [], item: { revision: 2 } });
    expect(await revisions(fresh.id)).toEqual([
      { revision: 1, prompt: fresh.prompt },
      { revision: 2, prompt: 'Är en watt en joule per sekund?' },
    ]);
  });

  it('put again unchanged stores nothing and stays at its revision', async () => {
    await put(`/questions/${fresh.id}`, fresh);

    const { status, json } = await put(`/questions/${fresh.id}`, fresh);

    expect(status).toBe(200);
    expect(json).toMatchObject({ stored: false, added: [], changed: [], retired: [], item: { revision: 1 } });
    expect(await revisions(fresh.id)).toHaveLength(1);
  });

  it('replaces an existing question of the pack in place, in its own language only', async () => {
    const before = (await exported()).questions.find((q) => q.id === 'kwh-eller-kw' && q.language === 'sv');
    expect(before).toBeDefined();

    const { json } = await put('/questions/kwh-eller-kw', { ...before, prompt: 'Vilken av enheterna anger effekt?' });

    expect(json).toMatchObject({ changed: [{ kind: 'question', id: 'kwh-eller-kw', language: 'sv' }], added: [], retired: [], item: { revision: 2 } });
    expect(await revisions('kwh-eller-kw', 'en')).toHaveLength(1);
  });

  it('replaces a translation without touching its original', async () => {
    const english = (await exported()).questions.find((q) => q.id === 'kwh-eller-kw' && q.language === 'en');
    expect(english).toBeDefined();

    const { status, json } = await put('/questions/kwh-eller-kw', { ...english, prompt: 'Which of the units gives power?' });

    expect(status).toBe(200);
    expect(json).toMatchObject({ changed: [{ kind: 'question', id: 'kwh-eller-kw', language: 'en' }], added: [], retired: [], item: { language: 'en', revision: 2 } });
    expect(await revisions('kwh-eller-kw', 'sv')).toEqual([{ revision: 1, prompt: 'Vilken enhet anger effekt?' }]);
  });

  it('citing a source the subject does not hold is refused with that fault, and nothing is stored', async () => {
    const { status, json } = await put(`/questions/${fresh.id}`, { ...fresh, sources: ['ingen-sadan-kalla'] });

    expect(status).toBe(422);
    expect(json).toMatchObject({ status: 422, faults: [{ code: 'unknown-source', item: `question ${fresh.id}`, field: 'sources[0]' }] });
    expect((json as { faults: unknown[] }).faults).toHaveLength(1);
    expect(await revisions(fresh.id)).toEqual([]);
  });

  it('on a dry run says what would change and the revision it would get, and stores nothing', async () => {
    const { status, json } = await put(`/questions/${fresh.id}`, fresh, '?dryRun=true');

    expect(status).toBe(200);
    expect(json).toMatchObject({ stored: false, added: [{ kind: 'question', id: fresh.id, language: 'sv' }], item: { revision: 1 } });
    expect(await revisions(fresh.id)).toEqual([]);
  });
});

describe('the other kinds of single item', () => {
  it('a lesson put changed gets a new revision', async () => {
    const lesson = (await exported()).lessons.find((l) => l.id === 'enhetsprefix');
    const { status, json } = await put('/lessons/enhetsprefix', { ...lesson, title: 'Prefix för enheter' });
    expect(status).toBe(200);
    expect(json).toMatchObject({ changed: [{ kind: 'lesson', id: 'enhetsprefix', language: 'sv' }], added: [], retired: [], item: { kind: 'lesson', revision: 2 } });
  });

  it('a source put changed gets a new revision', async () => {
    const source = (await exported()).sources.find((s) => s.id === 'exempelkalla');
    const { json } = await put('/sources/exempelkalla', { ...source, publisher: 'Exempelutgivaren AB' });
    expect(json).toMatchObject({ changed: [{ kind: 'source', id: 'exempelkalla', language: 'sv' }], item: { kind: 'source', revision: 2 } });
  });

  it('a glossary term put new is added', async () => {
    const term = { language: 'sv', id: 'watt', term: 'watt', definition: 'Enheten för effekt: en joule per sekund.', sources: ['exempelkalla'] };
    const { status, json } = await put('/glossary/watt', term);
    expect(status).toBe(201);
    expect(json).toMatchObject({ added: [{ kind: 'glossary-term', id: 'watt', language: 'sv' }], item: { kind: 'glossary-term', revision: 1 } });
  });

  it('a new lesson put alone is refused, because no area lists it', async () => {
    const lesson = (await exported()).lessons.find((l) => l.id === 'enhetsprefix');
    const { status, json } = await put('/lessons/ny-lektion', { ...lesson, id: 'ny-lektion' });
    expect(status).toBe(422);
    expect((json as { faults: unknown[] }).faults).toContainEqual(expect.objectContaining({ code: 'lesson-not-in-area', item: 'lesson ny-lektion', field: 'id' }));
  });
});

describe('a single item that cannot be taken', () => {
  it('whose id differs from the address is answered 400', async () => {
    const { status, json } = await put('/questions/annat-id', fresh);
    expect(status).toBe(400);
    expect(json).toMatchObject({ title: 'The id in the address is not the item’s' });
  });

  it('of the wrong kind for its address is answered 422 with what the schema expected', async () => {
    const { status, json } = await put(`/lessons/${fresh.id}`, fresh);
    expect(status).toBe(422);
    expect((json as { faults: { item: string | null }[] }).faults.length).toBeGreaterThan(0);
    expect(await revisions(fresh.id)).toEqual([]);
  });

  it('that would make a file of the subject larger than a pack may hold is refused, so the subject can always be exported and loaded again', async () => {
    const source = (await exported()).sources.find((s) => s.id === 'exempelkalla');
    const body = 'x'.repeat(17 * 1024 * 1024);

    const { status, json } = await put('/sources/exempelkalla', { ...source, body });

    expect(status).toBe(422);
    expect((json as { faults: unknown[] }).faults).toEqual([expect.objectContaining({ code: 'pack-too-large', expected: 'a file of at most 16777216 bytes' })]);
    const stored = await here.db.query("SELECT revision FROM catalogue.revision WHERE subject_id = 'example-subject' AND kind = 'source' AND id = 'exempelkalla'");
    expect(stored).toEqual([{ revision: 1 }]);
  });

  it('into a subject that does not exist is answered 404', async () => {
    const response = await here.app.request(`/api/v1/content/subjects/ingen/questions/${fresh.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fresh) });
    expect(response.status).toBe(404);
  });

  it('into a collection that does not exist is answered 404', async () => {
    const { status } = await put(`/areas/grunder`, {});
    expect(status).toBe(404);
  });

  it('sent as anything but JSON is answered 415', async () => {
    const { status } = await put(`/questions/${fresh.id}`, JSON.stringify(fresh), '', 'text/plain');
    expect(status).toBe(415);
    expect(await revisions(fresh.id)).toEqual([]);
  });
});
