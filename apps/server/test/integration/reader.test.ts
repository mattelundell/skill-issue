import { join } from 'node:path';
import { SourceLibrarySchema, SourcePageSchema, type SourceLibrary, type SourcePage } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const PREFIX_QUESTIONS = 'areas/grunder/lessons/enhetsprefix/questions.yaml';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const sourceFile = (id: string, title: string, body: string): string =>
  `---\nid: ${id}\ntitle: ${title}\npublisher: Testförlaget\nurl: https://example.org/${id}\naccessed: 2026-11-20\nlicence: CC BY 4.0\nkind: excerpt\n---\n\n${body}\n`;

let example: PackFiles;
/**
 * The example subject with three sources: its own, now also in English; one
 * that a single question cites and no lesson does; and one nothing cites.
 */
let pack: PackFiles;

beforeAll(async () => {
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(read.error)}`);
  }
  example = read.value;
  pack = withPrefixParSources(new Map(example), '[exempelkalla, matmetoder]')
    .set('sources/matmetoder.md', encode(sourceFile('matmetoder', 'Mätmetoder', 'Om att mäta energi.')))
    .set('sources/oanvand.md', encode(sourceFile('oanvand', 'Oanvänd källa', 'Ingen citerar den här.')))
    .set(
      'sources/exempelkalla.en.md',
      encode(
        '---\nid: exempelkalla\ntitle: Example source on energy and power\npublisher: The Example Press\nurl: https://example.org/energi\naccessed: 2026-11-21\nlicence: unknown\nkind: summary\n---\n\nA placeholder for a real source.\n',
      ),
    );
});

function withPrefixParSources(files: PackFiles, sources: string): Map<string, Uint8Array> {
  const before = new TextDecoder().decode(files.get(PREFIX_QUESTIONS));
  const marker = /(- id: prefix-par\n {2}type: matching\n {2}concepts: \[si-prefix\]\n {2}sources: )\[[^\]]*\]/;
  if (!marker.test(before)) {
    throw new Error(`${PREFIX_QUESTIONS} no longer holds prefix-par as these tests expect`);
  }
  return new Map(files).set(PREFIX_QUESTIONS, encode(before.replace(marker, `$1${sources}`)));
}

let here: Installation;

beforeEach(async () => {
  here = await install();
});

afterEach(async () => {
  await here.drop();
});

async function load(files: PackFiles): Promise<void> {
  const response = await here.app.request('/api/v1/content/packs', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: new Uint8Array(writeZip(files, 'example-subject')).buffer,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`pack refused: ${response.status} ${await response.text()}`);
  }
}

async function get(path: string): Promise<{ status: number; json: unknown }> {
  const response = await here.app.request(`/api/v1/reader${path}`);
  return { status: response.status, json: await response.json() };
}

async function library(query = ''): Promise<SourceLibrary> {
  const { status, json } = await get(`/subjects/example-subject/sources${query}`);
  expect(status).toBe(200);
  return SourceLibrarySchema.parse(json);
}

async function page(sourceId: string, query = ''): Promise<SourcePage> {
  const { status, json } = await get(`/subjects/example-subject/sources/${sourceId}${query}`);
  expect(status).toBe(200);
  return SourcePageSchema.parse(json);
}

/** Answers a check question, as the learner would, so the learning record holds it. */
async function answer(questionId: string, given: unknown): Promise<void> {
  const response = await here.app.request(`/api/v1/assessment/subjects/example-subject/questions/${questionId}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer: given, durationMs: 1000, timeZone: 'Europe/Stockholm' }),
  });
  expect(response.status).toBe(200);
}

describe('the source library', () => {
  it('lists every source in pack order, with its origin, its material and how much of the subject cites it', async () => {
    await load(pack);

    expect(await library()).toEqual({
      subjectId: 'example-subject',
      sources: [
        {
          id: 'exempelkalla',
          language: 'sv',
          title: 'Exempelkälla om energi och effekt',
          publisher: 'Exempelförlaget',
          url: 'https://example.org/energi',
          accessed: '2026-11-21',
          licence: 'unknown',
          kind: 'summary',
          body: 'Platshållare för en riktig källa. En sammanfattning med egna ord av vad\nkällan säger om energi, effekt och enhetsprefix skulle stå här.',
          // Every lesson cites it; eight questions in Swedish do, and the English translations of three of them are not counted again.
          cited: { lessons: 3, questions: 8, terms: 2 },
        },
        {
          id: 'matmetoder',
          language: 'sv',
          title: 'Mätmetoder',
          publisher: 'Testförlaget',
          url: 'https://example.org/matmetoder',
          accessed: '2026-11-20',
          licence: 'CC BY 4.0',
          kind: 'excerpt',
          body: 'Om att mäta energi.',
          // No lesson cites it, but a question in enhetsprefix's bank does, which puts that lesson on it.
          cited: { lessons: 1, questions: 1, terms: 0 },
        },
        {
          id: 'oanvand',
          language: 'sv',
          title: 'Oanvänd källa',
          publisher: 'Testförlaget',
          url: 'https://example.org/oanvand',
          accessed: '2026-11-20',
          licence: 'CC BY 4.0',
          kind: 'excerpt',
          body: 'Ingen citerar den här.',
          cited: { lessons: 0, questions: 0, terms: 0 },
        },
      ],
    });
  });

  it('shows each source in the language asked for where it is translated, and in the default language where it is not', async () => {
    await load(pack);

    const shown = (await library('?language=en')).sources.map(({ id, language, title }) => ({ id, language, title }));

    expect(shown).toEqual([
      { id: 'exempelkalla', language: 'en', title: 'Example source on energy and power' },
      { id: 'matmetoder', language: 'sv', title: 'Mätmetoder' },
      { id: 'oanvand', language: 'sv', title: 'Oanvänd källa' },
    ]);
  });

  it('leaves out a source the subject no longer holds, and stops counting a citation that was taken back', async () => {
    await load(pack);
    const reloaded = withPrefixParSources(pack, '[exempelkalla]');
    reloaded.delete('sources/oanvand.md');
    await load(reloaded);

    expect((await library()).sources.map(({ id, cited }) => ({ id, cited }))).toEqual([
      { id: 'exempelkalla', cited: { lessons: 3, questions: 8, terms: 2 } },
      { id: 'matmetoder', cited: { lessons: 0, questions: 0, terms: 0 } },
    ]);
  });

  it('does not count a question the subject no longer holds', async () => {
    await load(pack);
    const before = new TextDecoder().decode(pack.get(PREFIX_QUESTIONS));
    const at = before.indexOf('- id: prefix-par');
    const next = before.indexOf('- id: ', at + 1);
    await load(new Map(pack).set(PREFIX_QUESTIONS, encode(before.slice(0, at) + before.slice(next))));

    expect((await library()).sources.map(({ id, cited }) => ({ id, cited }))).toEqual([
      { id: 'exempelkalla', cited: { lessons: 3, questions: 7, terms: 2 } },
      { id: 'matmetoder', cited: { lessons: 0, questions: 0, terms: 0 } },
      { id: 'oanvand', cited: { lessons: 0, questions: 0, terms: 0 } },
    ]);
  });

  it('shows a source in the default language once its translation is no longer held', async () => {
    await load(pack);
    const reloaded = new Map(pack);
    reloaded.delete('sources/exempelkalla.en.md');
    await load(reloaded);

    expect((await library('?language=en')).sources[0]).toMatchObject({ id: 'exempelkalla', language: 'sv', title: 'Exempelkälla om energi och effekt' });
  });

  it('answers 404 for a subject that does not exist, and 400 for a language that is not a language code', async () => {
    await load(pack);

    expect(await get('/subjects/no-such-subject/sources')).toMatchObject({ status: 404, json: { title: 'No such subject' } });
    expect(await get('/subjects/Not%20an%20id/sources')).toMatchObject({ status: 404, json: { title: 'No such subject' } });
    expect(await get('/subjects/example-subject/sources?language=swedish')).toMatchObject({ status: 400 });
  });
});

describe('one source', () => {
  it('gives the source and what rests on it: citing lessons by area in path order, with their citing questions counted, and citing terms', async () => {
    await load(pack);

    expect(await page('exempelkalla')).toEqual({
      status: 'current',
      source: {
        id: 'exempelkalla',
        language: 'sv',
        title: 'Exempelkälla om energi och effekt',
        publisher: 'Exempelförlaget',
        url: 'https://example.org/energi',
        accessed: '2026-11-21',
        licence: 'unknown',
        kind: 'summary',
        body: 'Platshållare för en riktig källa. En sammanfattning med egna ord av vad\nkällan säger om energi, effekt och enhetsprefix skulle stå här.',
      },
      areas: [
        {
          id: 'grunder',
          language: 'sv',
          title: 'Grunder',
          lessons: [
            { id: 'energi-och-effekt', language: 'sv', title: 'Energi och effekt', questions: 3 },
            { id: 'enhetsprefix', language: 'sv', title: 'Enhetsprefix', questions: 3 },
          ],
        },
        { id: 'fordjupning', language: 'sv', title: 'Fördjupning', lessons: [{ id: 'energibalans', language: 'sv', title: 'Energibalans', questions: 2 }] },
      ],
      terms: [
        { id: 'effekt', language: 'sv', term: 'Effekt', definition: 'Energi per tidsenhet. Mäts i watt (W).' },
        { id: 'energi', language: 'sv', term: 'Energi', definition: 'Förmågan att uträtta arbete. I byggnader mäts den oftast i kilowattimmar (kWh).' },
      ],
    });
  });

  it('puts a lesson on a source when only a question in its bank cites it', async () => {
    await load(pack);

    expect(await page('matmetoder')).toMatchObject({
      status: 'current',
      areas: [{ id: 'grunder', lessons: [{ id: 'enhetsprefix', title: 'Enhetsprefix', questions: 1 }] }],
      terms: [],
    });
  });

  it('gives a source nothing cites, with nothing resting on it', async () => {
    await load(pack);

    expect(await page('oanvand')).toMatchObject({ status: 'current', source: { id: 'oanvand', title: 'Oanvänd källa' }, areas: [], terms: [] });
  });

  it('names the citing lessons and the source in the language asked for, falling back to the default per item', async () => {
    await load(pack);

    const shown = await page('exempelkalla', '?language=en');
    if (shown.status !== 'current') {
      throw new Error(`expected a current source, got ${shown.status}`);
    }

    expect({ source: [shown.source.language, shown.source.title], areas: shown.areas.map(({ language, title, lessons }) => [language, title, lessons.map((lesson) => [lesson.language, lesson.title])]) }).toEqual({
      source: ['en', 'Example source on energy and power'],
      areas: [
        ['sv', 'Grunder', [['en', 'Energy and power'], ['sv', 'Enhetsprefix']]],
        ['sv', 'Fördjupning', [['sv', 'Energibalans']]],
      ],
    });
  });

  it('still opens a source the subject no longer holds, as its last revision and marked retired', async () => {
    await load(pack);
    await load(new Map(pack).set('sources/oanvand.md', encode(sourceFile('oanvand', 'Oanvänd källa', 'Andra versionen.'))));
    const reloaded = new Map(pack);
    reloaded.delete('sources/oanvand.md');
    await load(reloaded);
    const [retired] = await here.db.query("SELECT to_json(retired_at) #>> '{}' AS at FROM catalogue.entry WHERE id = 'oanvand'");

    const shown = await page('oanvand');
    if (shown.status !== 'retired') {
      throw new Error(`expected a retired source, got ${shown.status}`);
    }
    const { retiredAt, ...rest } = shown;

    expect(rest).toEqual({
      status: 'retired',
      source: {
        id: 'oanvand',
        language: 'sv',
        title: 'Oanvänd källa',
        publisher: 'Testförlaget',
        url: 'https://example.org/oanvand',
        accessed: '2026-11-20',
        licence: 'CC BY 4.0',
        kind: 'excerpt',
        body: 'Andra versionen.',
      },
      history: { questions: 0, answers: 0 },
    });
    // The database keeps microseconds and an answer milliseconds, so the two are compared as instants to the millisecond.
    expect(new Date(retiredAt).getTime()).toBe(Math.floor(new Date(String(retired?.['at'])).getTime()));
  });

  it('names what the learner answered on a retired source’s strength: the questions that cited it then, and how many answers', async () => {
    await load(pack);
    const pairs = { type: 'matching', pairs: [{ left: 'kilo', right: 'tusen' }, { left: 'mega', right: 'miljon' }, { left: 'giga', right: 'miljard' }] };
    // prefix-par cites matmetoder; kilo-betyder does not, and must not be counted.
    await answer('prefix-par', pairs);
    await answer('prefix-par', pairs);
    await answer('kilo-betyder', { type: 'short-text', text: 'k' });
    const reloaded = withPrefixParSources(pack, '[exempelkalla]');
    reloaded.delete('sources/matmetoder.md');
    await load(reloaded);

    const shown = await page('matmetoder');

    expect(shown).toMatchObject({ status: 'retired', source: { id: 'matmetoder' }, history: { questions: 1, answers: 2 } });
  });

  it('answers 404 for a source or a subject that does not exist', async () => {
    await load(pack);

    expect(await get('/subjects/example-subject/sources/no-such-source')).toMatchObject({ status: 404, json: { title: 'No such source' } });
    expect(await get('/subjects/example-subject/sources/Not%20an%20id')).toMatchObject({ status: 404, json: { title: 'No such source' } });
    expect(await get('/subjects/no-such-subject/sources/exempelkalla')).toMatchObject({ status: 404, json: { title: 'No such subject' } });
    // A lesson is not a source, though the id exists in the subject.
    expect(await get('/subjects/example-subject/sources/enhetsprefix')).toMatchObject({ status: 404, json: { title: 'No such source' } });
  });
});
