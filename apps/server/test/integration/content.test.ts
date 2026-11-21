import { join } from 'node:path';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { SubjectOutlineSchema, type ItemRef, type LoadResult, type Pack, type SubjectOutline } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/core/app.js';
import { catalogueMigrations } from '../../src/core/catalogue/migrations.js';
import type { DbConnection } from '../../src/core/db.js';
import { migrate } from '../../src/core/migrate.js';
import { createRegistry } from '../../src/core/registry.js';
import { modules } from '../../src/modules/index.js';
import { createScratchDatabase } from './database.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const QUESTIONS_1 = 'areas/grunder/lessons/energi-och-effekt/questions.yaml';

interface Installation {
  readonly app: OpenAPIHono;
  readonly db: DbConnection;
  readonly drop: () => Promise<void>;
}

/** A fresh database with the application's migrations applied, and the application on it. */
async function install(): Promise<Installation> {
  const { db, drop } = await createScratchDatabase();
  const registry = createRegistry(modules);
  if (!registry.ok) {
    throw new Error(`modules do not register: ${registry.error.kind}`);
  }
  const migrated = await migrate(db, [...catalogueMigrations, ...registry.value.migrations]);
  if (!migrated.ok) {
    throw new Error(`migrations failed: ${JSON.stringify(migrated.error)}`);
  }
  return { app: buildApp({ db, registry: registry.value, version: 'test' }), db, drop };
}

let example: PackFiles;
let here: Installation;
const others: Installation[] = [];

beforeAll(async () => {
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(read.error)}`);
  }
  example = read.value;
});

beforeEach(async () => {
  here = await install();
});

afterEach(async () => {
  await here.drop();
  await Promise.all(others.splice(0).map(async (other) => other.drop()));
});

const zipOf = (files: PackFiles): Uint8Array => writeZip(files, 'example-subject');

function edited(path: string, from: string, to: string): PackFiles {
  const before = new TextDecoder().decode(example.get(path));
  if (!before.includes(from)) {
    throw new Error(`${path} does not contain ${JSON.stringify(from)}`);
  }
  return new Map(example).set(path, new TextEncoder().encode(before.replace(from, to)));
}

async function post(app: OpenAPIHono, body: Uint8Array | string, type: string, query = ''): Promise<{ status: number; json: unknown }> {
  const response = await app.request(`/api/v1/content/packs${query}`, {
    method: 'POST',
    headers: { 'content-type': type },
    body: typeof body === 'string' ? body : new Uint8Array(body).buffer,
  });
  return { status: response.status, json: await response.json() };
}

const loadZip = async (files: PackFiles, app = here.app, query = ''): Promise<{ status: number; json: unknown }> =>
  post(app, zipOf(files), 'application/zip', query);

async function exported(app = here.app): Promise<Pack> {
  const response = await app.request('/api/v1/content/subjects/example-subject/pack');
  expect(response.status).toBe(200);
  // oxlint-disable-next-line typescript/no-unsafe-return -- the test compares it whole against what was loaded
  return response.json();
}

/** Every item of the example pack, in the order the load reports them. */
const EXAMPLE_ITEMS: readonly ItemRef[] = [
  { kind: 'area', id: 'fordjupning', language: 'sv' },
  { kind: 'area', id: 'grunder', language: 'sv' },
  { kind: 'asset', id: 'assets/energiflode.png', language: null },
  { kind: 'glossary-term', id: 'effekt', language: 'sv' },
  { kind: 'glossary-term', id: 'energi', language: 'sv' },
  { kind: 'lesson', id: 'energi-och-effekt', language: 'en' },
  { kind: 'lesson', id: 'energi-och-effekt', language: 'sv' },
  { kind: 'lesson', id: 'energibalans', language: 'sv' },
  { kind: 'lesson', id: 'enhetsprefix', language: 'sv' },
  ...[
    'berakna-energi/en',
    'berakna-energi/sv',
    'effekt-ar-takt/en',
    'effekt-ar-takt/sv',
    'forklara-balans/sv',
    'kilo-betyder/sv',
    'kwh-eller-kw/en',
    'kwh-eller-kw/sv',
    'prefix-ordning/sv',
    'prefix-par/sv',
    'vagar-ut/sv',
  ].map((key) => {
    const [id = '', language = ''] = key.split('/');
    return { kind: 'question' as const, id, language };
  }),
  { kind: 'source', id: 'exempelkalla', language: 'sv' },
  { kind: 'subject', id: 'example-subject', language: 'en' },
  { kind: 'subject', id: 'example-subject', language: 'sv' },
];

const nothingChanged = (unchanged: number, subject = 'example-subject'): LoadResult => ({
  subject,
  stored: false,
  created: false,
  added: [],
  changed: [],
  retired: [],
  unchanged,
});

describe('loading a pack', () => {
  it('stores a new subject with every item, and says so', async () => {
    const { status, json } = await loadZip(example);

    expect(status).toBe(201);
    expect(json).toEqual({ subject: 'example-subject', stored: true, created: true, added: EXAMPLE_ITEMS, changed: [], retired: [], unchanged: 0 });
    expect(await here.db.query("SELECT kind, id, language, revision FROM catalogue.revision WHERE id = 'kwh-eller-kw' ORDER BY language")).toEqual([
      { kind: 'question', id: 'kwh-eller-kw', language: 'en', revision: 1 },
      { kind: 'question', id: 'kwh-eller-kw', language: 'sv', revision: 1 },
    ]);
  });

  it('places each item in the subject: areas in path order, lessons in their area, questions in their lesson', async () => {
    await loadZip(example);

    expect(
      await here.db.query("SELECT kind, id, parent_kind, parent_id, position FROM catalogue.item WHERE kind IN ('area', 'lesson') ORDER BY kind, position, id"),
    ).toEqual([
      { kind: 'area', id: 'grunder', parent_kind: 'subject', parent_id: 'example-subject', position: 0 },
      { kind: 'area', id: 'fordjupning', parent_kind: 'subject', parent_id: 'example-subject', position: 1 },
      { kind: 'lesson', id: 'energi-och-effekt', parent_kind: 'area', parent_id: 'grunder', position: 0 },
      { kind: 'lesson', id: 'energibalans', parent_kind: 'area', parent_id: 'fordjupning', position: 0 },
      { kind: 'lesson', id: 'enhetsprefix', parent_kind: 'area', parent_id: 'grunder', position: 1 },
    ]);
  });

  it('changes nothing when the same pack is sent again', async () => {
    await loadZip(example);

    const { status, json } = await loadZip(example);

    expect(status).toBe(200);
    expect(json).toEqual(nothingChanged(EXAMPLE_ITEMS.length));
    expect(await here.db.query('SELECT count(*)::int AS n FROM catalogue.revision')).toEqual([{ n: EXAMPLE_ITEMS.length - 1 }]);
  });

  it('gives a changed item a new revision and keeps the old one', async () => {
    await loadZip(example);

    const { json } = await loadZip(edited(QUESTIONS_1, 'prompt: Vilken enhet anger effekt?', 'prompt: Vilken av enheterna anger effekt?'));

    expect(json).toEqual({
      subject: 'example-subject',
      stored: true,
      created: false,
      added: [],
      changed: [{ kind: 'question', id: 'kwh-eller-kw', language: 'sv' }],
      retired: [],
      unchanged: EXAMPLE_ITEMS.length - 1,
    });
    expect(
      await here.db.query("SELECT revision, body->>'prompt' AS prompt FROM catalogue.revision WHERE id = 'kwh-eller-kw' AND language = 'sv' ORDER BY revision"),
    ).toEqual([
      { revision: 1, prompt: 'Vilken enhet anger effekt?' },
      { revision: 2, prompt: 'Vilken av enheterna anger effekt?' },
    ]);
    expect((await exported()).questions.find((q) => q.id === 'kwh-eller-kw' && q.language === 'sv')?.prompt).toBe('Vilken av enheterna anger effekt?');
  });

  it('retires what the pack no longer holds, keeping its history, and offers it no more', async () => {
    await loadZip(example);
    const withoutPrefixes = new Map([...example].filter(([path]) => !path.includes('/enhetsprefix/')));
    const smaller = new Map(withoutPrefixes).set(
      'areas/grunder/area.yaml',
      new TextEncoder().encode(new TextDecoder().decode(example.get('areas/grunder/area.yaml')).replace('  - enhetsprefix\n', '').replace('questions: 4', 'questions: 3')),
    );

    const { json } = await loadZip(smaller);

    expect(json).toEqual({
      subject: 'example-subject',
      stored: true,
      created: false,
      added: [],
      changed: [{ kind: 'area', id: 'grunder', language: 'sv' }],
      retired: [
        { kind: 'lesson', id: 'enhetsprefix', language: 'sv' },
        { kind: 'question', id: 'kilo-betyder', language: 'sv' },
        { kind: 'question', id: 'prefix-ordning', language: 'sv' },
        { kind: 'question', id: 'prefix-par', language: 'sv' },
      ],
      unchanged: EXAMPLE_ITEMS.length - 5,
    });
    const pack = await exported();
    expect(pack.lessons.map((l) => l.id)).not.toContain('enhetsprefix');
    expect(pack.questions.map((q) => q.id)).not.toContain('prefix-par');
    expect(await here.db.query("SELECT retired_at IS NOT NULL AS retired FROM catalogue.entry WHERE id = 'prefix-par'")).toEqual([{ retired: true }]);
    expect(await here.db.query("SELECT count(*)::int AS n FROM catalogue.revision WHERE id = 'prefix-par'")).toEqual([{ n: 1 }]);
  });

  it('on a dry run reports what would change and stores nothing', async () => {
    await loadZip(example);

    const { status, json } = await loadZip(edited(QUESTIONS_1, 'answer: b', 'answer: a'), here.app, '?dryRun=true');

    expect(status).toBe(200);
    expect(json).toMatchObject({ stored: false, changed: [{ kind: 'question', id: 'kwh-eller-kw', language: 'sv' }] });
    expect(await here.db.query("SELECT count(*)::int AS n FROM catalogue.revision WHERE id = 'kwh-eller-kw' AND language = 'sv'")).toEqual([{ n: 1 }]);
    expect((await exported()).questions.find((q) => q.id === 'kwh-eller-kw' && q.language === 'sv')).toMatchObject({ answer: 'b' });
  });

  it('on a dry run of a new subject stores nothing at all', async () => {
    const { status, json } = await loadZip(example, here.app, '?dryRun=true');

    expect(status).toBe(200);
    expect(json).toMatchObject({ stored: false, created: true, added: EXAMPLE_ITEMS });
    expect(await here.db.query('SELECT count(*)::int AS n FROM catalogue.subject')).toEqual([{ n: 0 }]);
  });

  it('accepts the same pack as JSON', async () => {
    await loadZip(example);
    const pack = await exported();

    const { status, json } = await post(here.app, JSON.stringify(pack), 'application/json');

    expect(status).toBe(200);
    expect(json).toEqual(nothingChanged(EXAMPLE_ITEMS.length));
  });
});

describe('a rejected pack', () => {
  it('is answered 422 with every fault, and nothing is stored', async () => {
    const { status, json } = await loadZip(edited(QUESTIONS_1, 'answer: b', 'answer: d'));

    expect(status).toBe(422);
    expect(json).toEqual({
      type: 'about:blank',
      title: 'The pack was not loaded',
      status: 422,
      detail: '1 fault; correct each and send the pack again.',
      faults: [
        { code: 'unknown-option', file: QUESTIONS_1, item: 'question kwh-eller-kw', field: 'answer', expected: 'one of the option ids ["a","b","c"]', found: '"d"' },
      ],
    });
    expect(await here.db.query('SELECT count(*)::int AS n FROM catalogue.subject')).toEqual([{ n: 0 }]);
  });

  it('as an archive with an entry outside the pack names the entry', async () => {
    const archive = writeZip(new Map([['subject.yaml', new Uint8Array(1)], ['../escape.yaml', new Uint8Array(1)]]), 'pack');

    const { status, json } = await post(here.app, archive, 'application/zip');

    expect(status).toBe(422);
    expect(json).toMatchObject({ faults: [{ code: 'unsafe-path', file: 'pack/../escape.yaml' }] });
  });

  it('that is not JSON is answered 400', async () => {
    const { status, json } = await post(here.app, '{"formatVersion": 1,', 'application/json');

    expect(status).toBe(400);
    expect(json).toMatchObject({ status: 400, title: 'The body is not JSON' });
  });

  it('in another format is answered 415', async () => {
    const { status, json } = await post(here.app, 'formatVersion: 1', 'text/yaml');

    expect(status).toBe(415);
    expect(json).toEqual({ type: 'about:blank', title: 'Send a pack as application/json or application/zip', status: 415, detail: 'Content-Type was "text/yaml"' });
  });

  it('with a dryRun that is not true or false is answered 400', async () => {
    const { status } = await loadZip(example, here.app, '?dryRun=yes');

    expect(status).toBe(400);
  });
});

describe('exporting a subject', () => {
  it('gives back what was loaded, and loading the export changes nothing', async () => {
    await loadZip(example);
    const pack = await exported();

    const again = await post(here.app, JSON.stringify(pack), 'application/json');
    const zip = await here.app.request('/api/v1/content/subjects/example-subject/pack?format=zip');
    const againAsZip = await post(here.app, new Uint8Array(await zip.arrayBuffer()), 'application/zip');

    expect(again.json).toEqual(nothingChanged(EXAMPLE_ITEMS.length));
    expect(zip.headers.get('content-disposition')).toBe('attachment; filename="example-subject.zip"');
    expect(againAsZip.json).toEqual(nothingChanged(EXAMPLE_ITEMS.length));
  });

  it('as a zip loads into an empty installation, which then exports the same pack', async () => {
    await loadZip(example);
    const zip = new Uint8Array(await (await here.app.request('/api/v1/content/subjects/example-subject/pack?format=zip')).arrayBuffer());
    const empty = await install();
    others.push(empty);

    const { status, json } = await post(empty.app, zip, 'application/zip');

    expect(status).toBe(201);
    expect(json).toMatchObject({ created: true, stored: true, added: EXAMPLE_ITEMS });
    expect(await exported(empty.app)).toEqual(await exported());
  });

  it('of an unknown subject is answered 404', async () => {
    const response = await here.app.request('/api/v1/content/subjects/no-such-subject/pack');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ type: 'about:blank', title: 'No such subject', status: 404, detail: 'No subject has the id "no-such-subject".' });
  });
});

describe('listing subjects', () => {
  it('shows each subject with its languages and its title in the default language', async () => {
    await loadZip(example);

    const response = await here.app.request('/api/v1/content/subjects');

    expect(await response.json()).toEqual([
      {
        id: 'example-subject',
        defaultLanguage: 'sv',
        languages: ['en', 'sv'],
        title: 'Exempelämne',
        summary: 'Energi och effekt, enhetsprefix och energibalans — tillräckligt för att visa formatet.',
      },
    ]);
  });

  it('is empty on a new installation', async () => {
    expect(await (await here.app.request('/api/v1/content/subjects')).json()).toEqual([]);
  });
});

/** The outline the API gives, parsed against the contract so a field it drops or misnames fails here. */
const outlineOf = async (query = ''): Promise<SubjectOutline> =>
  SubjectOutlineSchema.parse(await (await here.app.request(`/api/v1/content/subjects/example-subject${query}`)).json());

describe('a subject outline', () => {
  it('gives the path in the default language: areas in order, each with what it builds on and its lessons in order', async () => {
    await loadZip(example);

    const response = await here.app.request('/api/v1/content/subjects/example-subject');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'example-subject',
      defaultLanguage: 'sv',
      languages: ['en', 'sv'],
      language: 'sv',
      title: 'Exempelämne',
      summary: 'Energi och effekt, enhetsprefix och energibalans — tillräckligt för att visa formatet.',
      areas: [
        {
          id: 'grunder',
          language: 'sv',
          title: 'Grunder',
          summary: 'Storheterna och enheterna resten av ämnet bygger på.',
          requires: [],
          lessons: [
            { id: 'energi-och-effekt', language: 'sv', title: 'Energi och effekt', summary: 'Skillnaden mellan kWh och kW, och varför båda spelar roll.' },
            { id: 'enhetsprefix', language: 'sv', title: 'Enhetsprefix', summary: 'Kilo, mega och giga, och hur man räknar mellan dem.' },
          ],
        },
        {
          id: 'fordjupning',
          language: 'sv',
          title: 'Fördjupning',
          summary: 'Vart energin tar vägen i en byggnad.',
          requires: ['grunder'],
          lessons: [
            { id: 'energibalans', language: 'sv', title: 'Energibalans', summary: 'Energin som tillförs en byggnad lämnar den också, på olika vägar.' },
          ],
        },
      ],
    });
  });

  it('in another language shows each item translated where it is, and in the default language, marked as such, where it is not', async () => {
    await loadZip(example);

    const outline = await outlineOf('?language=en');

    expect(outline).toMatchObject({ language: 'en', title: 'Example subject' });
    expect(outline.areas.map((area) => [area.id, area.language, area.title])).toEqual([
      ['grunder', 'sv', 'Grunder'],
      ['fordjupning', 'sv', 'Fördjupning'],
    ]);
    expect(outline.areas[0]?.lessons.map((lesson) => [lesson.id, lesson.language, lesson.title])).toEqual([
      ['energi-och-effekt', 'en', 'Energy and power'],
      ['enhetsprefix', 'sv', 'Enhetsprefix'],
    ]);
  });

  it('shows a lesson in the default language once its translation is no longer held, not the retired translation', async () => {
    await loadZip(example);
    await loadZip(new Map([...example].filter(([path]) => !path.endsWith('/energi-och-effekt/lesson.en.md') && !path.endsWith('/energi-och-effekt/questions.en.yaml'))));

    const outline = await outlineOf('?language=en');

    expect(outline.areas[0]?.lessons[0]).toEqual({
      id: 'energi-och-effekt',
      language: 'sv',
      title: 'Energi och effekt',
      summary: 'Skillnaden mellan kWh och kW, och varför båda spelar roll.',
    });
  });

  it('of an unknown subject is answered 404', async () => {
    const response = await here.app.request('/api/v1/content/subjects/no-such-subject');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ status: 404, detail: 'No subject has the id "no-such-subject".' });
  });

  it('in a malformed language is answered 400', async () => {
    await loadZip(example);

    const response = await here.app.request('/api/v1/content/subjects/example-subject?language=english');

    expect(response.status).toBe(400);
  });
});
