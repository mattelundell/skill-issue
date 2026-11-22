import { join } from 'node:path';
import { GlossarySchema, type Glossary } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

let example: PackFiles;

beforeAll(async () => {
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(read.error)}`);
  }
  example = read.value;
});

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
  const response = await here.app.request(`/api/v1/glossary${path}`);
  return { status: response.status, json: await response.json() };
}

async function glossary(query = ''): Promise<Glossary> {
  const { status, json } = await get(`/subjects/example-subject/terms${query}`);
  expect(status).toBe(200);
  return GlossarySchema.parse(json);
}

/**
 * The example subject with a second source, an English translation of its own
 * source and of one term, and a third term that cites both sources and is
 * named in two other ways.
 */
function withThreeTerms(): Map<string, Uint8Array> {
  return new Map(example)
    .set(
      'sources/matmetoder.md',
      encode('---\nid: matmetoder\ntitle: Mätmetoder\npublisher: Testförlaget\nurl: https://example.org/matmetoder\naccessed: 2026-11-20\nlicence: CC BY 4.0\nkind: excerpt\n---\n\nOm att mäta energi.\n'),
    )
    .set(
      'sources/exempelkalla.en.md',
      encode(
        '---\nid: exempelkalla\ntitle: Example source on energy and power\npublisher: The Example Press\nurl: https://example.org/energi\naccessed: 2026-11-21\nlicence: unknown\nkind: summary\n---\n\nA placeholder for a real source.\n',
      ),
    )
    .set(
      'glossary.yaml',
      encode(
        [
          '- id: effekt',
          '  term: Effekt',
          '  definition: Energi per tidsenhet. Mäts i watt (W).',
          '  alsoKnownAs: [power]',
          '  sources: [exempelkalla]',
          '- id: energi',
          '  term: Energi',
          '  definition: Förmågan att uträtta arbete. I byggnader mäts den oftast i kilowattimmar (kWh).',
          '  sources: [exempelkalla]',
          '- id: matare',
          '  term: Mätare',
          '  definition: Det som **räknar** energin som går in i byggnaden.',
          '  alsoKnownAs: [energimätare, meter]',
          '  sources: [matmetoder, exempelkalla]',
          '',
        ].join('\n'),
      ),
    )
    .set('glossary.en.yaml', encode(['- id: effekt', '  term: Power', '  definition: Energy per unit of time, in watts (W).', '  sources: [exempelkalla]', ''].join('\n')));
}

describe("a subject's glossary", () => {
  it('lists every term in pack order, with its definition, its other names and the titles of the sources it rests on', async () => {
    await load(withThreeTerms());

    expect(await glossary()).toEqual({
      subjectId: 'example-subject',
      terms: [
        {
          id: 'effekt',
          language: 'sv',
          term: 'Effekt',
          definition: 'Energi per tidsenhet. Mäts i watt (W).',
          alsoKnownAs: ['power'],
          sources: [{ id: 'exempelkalla', language: 'sv', title: 'Exempelkälla om energi och effekt' }],
        },
        {
          id: 'energi',
          language: 'sv',
          term: 'Energi',
          definition: 'Förmågan att uträtta arbete. I byggnader mäts den oftast i kilowattimmar (kWh).',
          // A term written with no other names has an empty list, not a missing field.
          alsoKnownAs: [],
          sources: [{ id: 'exempelkalla', language: 'sv', title: 'Exempelkälla om energi och effekt' }],
        },
        {
          id: 'matare',
          language: 'sv',
          term: 'Mätare',
          definition: 'Det som **räknar** energin som går in i byggnaden.',
          alsoKnownAs: ['energimätare', 'meter'],
          // In the order the term cites them, not the pack's order of sources.
          sources: [
            { id: 'matmetoder', language: 'sv', title: 'Mätmetoder' },
            { id: 'exempelkalla', language: 'sv', title: 'Exempelkälla om energi och effekt' },
          ],
        },
      ],
    });
  });

  it('shows each term and source title in the language asked for where translated, and in the default language where not, saying which', async () => {
    await load(withThreeTerms());

    const { terms } = await glossary('?language=en');

    expect(terms.map(({ id, language, term, alsoKnownAs }) => ({ id, language, term, alsoKnownAs }))).toEqual([
      // The translation names no other forms, so the Swedish ones are not borrowed for it.
      { id: 'effekt', language: 'en', term: 'Power', alsoKnownAs: [] },
      { id: 'energi', language: 'sv', term: 'Energi', alsoKnownAs: [] },
      { id: 'matare', language: 'sv', term: 'Mätare', alsoKnownAs: ['energimätare', 'meter'] },
    ]);
    expect(terms[0]?.definition).toBe('Energy per unit of time, in watts (W).');
    expect(terms[2]?.sources).toEqual([
      { id: 'matmetoder', language: 'sv', title: 'Mätmetoder' },
      { id: 'exempelkalla', language: 'en', title: 'Example source on energy and power' },
    ]);
  });

  it('leaves out a term the subject no longer holds once a reload drops it', async () => {
    await load(withThreeTerms());
    await load(new Map(withThreeTerms()).set('glossary.yaml', encode('- id: energi\n  term: Energi\n  definition: Förmågan att uträtta arbete.\n  sources: [exempelkalla]\n')).set('glossary.en.yaml', encode('[]\n')));

    expect((await glossary()).terms.map(({ id, definition }) => ({ id, definition }))).toEqual([{ id: 'energi', definition: 'Förmågan att uträtta arbete.' }]);
  });

  it('answers 404 for a subject that does not exist, and 400 for a language that is not a language code', async () => {
    await load(withThreeTerms());

    expect((await get('/subjects/no-such-subject/terms')).status).toBe(404);
    expect((await get('/subjects/Not%20an%20id/terms')).status).toBe(404);
    const bad = await get('/subjects/example-subject/terms?language=not%20a%20language');
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ status: 400, title: 'language must be a language code such as sv, en or en-GB' });
  });
});
