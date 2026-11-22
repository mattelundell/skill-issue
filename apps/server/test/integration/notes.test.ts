import { join } from 'node:path';
import { NotebookSchema, NotebookSectionSchema, NotebookSummaryListSchema, NoteImageSchema, NOTE_IMAGE_MAX_BYTES, NOTE_MAX_LENGTH, type NotebookSection } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { unzipSync } from 'fflate';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/core/migrate.js';
import { noteMigrations } from '../../src/modules/notes/store.js';
import { createScratchDatabase } from './database.js';
import { install, type Installation } from './installation.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const NOTES = '/api/v1/notes/subjects/example-subject';

/** A one-pixel PNG, the smallest real image there is to add. */
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

async function send(method: string, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await here.app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, json: response.status === 204 ? undefined : await response.json() };
}

const write = (kind: 'areas' | 'lessons', itemId: string, body: unknown, subject = NOTES) => send('PUT', `${subject}/notebook/${kind}/${itemId}`, body);

async function written(kind: 'areas' | 'lessons', itemId: string, body: string): Promise<NotebookSection> {
  const { status, json } = await write(kind, itemId, { body });
  expect(status).toBe(200);
  return NotebookSectionSchema.parse(json);
}

async function notebook(query = ''): Promise<readonly NotebookSection[]> {
  const response = await here.app.request(`${NOTES}/notebook${query}`);
  const json: unknown = await response.json();
  if (response.status !== 200) {
    throw new Error(`notebook answered ${response.status}: ${JSON.stringify(json)}`);
  }
  const parsed = NotebookSchema.parse(json);
  expect(parsed.subjectId).toBe('example-subject');
  return parsed.sections;
}

/** What each section belongs to and what it says, in the order given: enough to tell one from another. */
const filed = (sections: readonly NotebookSection[]) => sections.map(({ kind, itemId, body }) => [kind, itemId, body]);

describe('writing in a notebook', () => {
  it('files a section under the lesson or the area it was written for', async () => {
    await load(example);

    const lesson = await written('lessons', 'energi-och-effekt', 'Effekt × tid = energi.');
    const area = await written('areas', 'grunder', 'Området i en mening.');

    expect([lesson.kind, lesson.itemId, lesson.body]).toEqual(['lesson', 'energi-och-effekt', 'Effekt × tid = energi.']);
    expect([area.kind, area.itemId, area.body]).toEqual(['area', 'grunder', 'Området i en mening.']);
    expect(filed(await notebook())).toEqual([
      ['area', 'grunder', 'Området i en mening.'],
      ['lesson', 'energi-och-effekt', 'Effekt × tid = energi.'],
    ]);
  });

  it('keeps one section per lesson: writing again replaces the text and keeps when it was begun', async () => {
    await load(example);
    const first = await written('lessons', 'energi-och-effekt', 'Första.');

    const second = await written('lessons', 'energi-och-effekt', 'Första.\nOch en rad till.');

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt > first.updatedAt).toBe(true);
    expect(filed(await notebook())).toEqual([['lesson', 'energi-och-effekt', 'Första.\nOch en rad till.']]);
  });

  it('keeps an area’s section and a lesson’s apart, even when they share an id', async () => {
    await load(example);
    await written('areas', 'grunder', 'Om området.');

    await write('lessons', 'grunder', { body: 'Ingen sådan lektion.' });

    expect(filed(await notebook())).toEqual([['area', 'grunder', 'Om området.']]);
  });

  it('removes the section when its text is emptied, and leaves the others', async () => {
    await load(example);
    await written('lessons', 'energi-och-effekt', 'Går bort.');
    await written('lessons', 'enhetsprefix', 'Står kvar.');

    const { status } = await write('lessons', 'energi-och-effekt', { body: '  \n ' });

    expect(status).toBe(204);
    expect(filed(await notebook())).toEqual([['lesson', 'enhetsprefix', 'Står kvar.']]);
  });

  it('refuses an area or lesson the subject does not have, and an unknown subject', async () => {
    await load(example);

    const area = await write('areas', 'finns-inte', { body: 'x' });
    const lesson = await write('lessons', 'finns-inte', { body: 'x' });
    const subject = await write('lessons', 'energi-och-effekt', { body: 'x' }, '/api/v1/notes/subjects/finns-inte');

    expect([area.status, (area.json as { title: string }).title]).toEqual([404, 'No such area']);
    expect([lesson.status, (lesson.json as { title: string }).title]).toEqual([404, 'No such lesson']);
    expect([subject.status, (subject.json as { title: string }).title]).toEqual([404, 'No such subject']);
    expect(await notebook()).toEqual([]);
  });

  it('refuses a body that is not a section, and one too long to keep', async () => {
    await load(example);

    const wrong = await write('lessons', 'energi-och-effekt', { text: 'x' });
    const tooLong = await write('lessons', 'energi-och-effekt', { body: 'x'.repeat(NOTE_MAX_LENGTH + 1) });
    const longest = await write('lessons', 'energi-och-effekt', { body: 'x'.repeat(NOTE_MAX_LENGTH) });

    expect([wrong.status, tooLong.status, longest.status]).toEqual([400, 400, 200]);
    expect((await notebook()).map((section) => section.body.length)).toEqual([NOTE_MAX_LENGTH]);
  });
});

describe('browsing and searching a notebook', () => {
  it('keeps a section whose lesson the subject no longer holds', async () => {
    await load(example);
    await written('lessons', 'energibalans', 'Om energibalans.');
    const without = new Map(example);
    for (const path of without.keys()) {
      if (path.startsWith('areas/fordjupning/')) {
        without.delete(path);
      }
    }
    for (const path of ['subject.yaml', 'subject.en.yaml']) {
      const before = new TextDecoder().decode(without.get(path));
      if (!before.includes('  - fordjupning\n')) {
        throw new Error(`${path} no longer lists fordjupning as this test expects`);
      }
      without.set(path, new TextEncoder().encode(before.replace('  - fordjupning\n', '')));
    }
    await load(without);

    expect(filed(await notebook())).toEqual([['lesson', 'energibalans', 'Om energibalans.']]);
  });

  it('finds a section by a word in it, from the start of a word, ignoring case and needing every word', async () => {
    await load(example);
    await written('lessons', 'energi-och-effekt', 'Effekt mäts i kilowatt.');
    await written('lessons', 'enhetsprefix', 'Mega betyder miljon. Återbetalningstid är något annat.');
    await written('areas', 'fordjupning', 'Värmeförluster genom klimatskalet.');

    expect(filed(await notebook('?q=KILO'))).toEqual([['lesson', 'energi-och-effekt', 'Effekt mäts i kilowatt.']]);
    expect(filed(await notebook('?q=watt'))).toEqual([]);
    expect(filed(await notebook('?q=mega%20miljon'))).toEqual([['lesson', 'enhetsprefix', 'Mega betyder miljon. Återbetalningstid är något annat.']]);
    expect(filed(await notebook('?q=mega%20kilowatt'))).toEqual([]);
    expect(filed(await notebook('?q=v%C3%A4rme%26%7C!'))).toEqual([['area', 'fordjupning', 'Värmeförluster genom klimatskalet.']]);
  });

  it('answers an unknown subject with 404', async () => {
    await load(example);

    expect((await here.app.request('/api/v1/notes/subjects/finns-inte/notebook')).status).toBe(404);
  });

  it('lists every subject’s notebook: how many sections hold something, in which areas, and which was written last', async () => {
    await load(example);
    await written('lessons', 'enhetsprefix', 'Först.');
    await written('areas', 'fordjupning', 'Sist.');

    const response = await here.app.request('/api/v1/notes/notebooks');
    const { notebooks } = NotebookSummaryListSchema.parse(await response.json());

    expect(notebooks).toEqual([{ subjectId: 'example-subject', written: 2, areasWritten: ['grunder', 'fordjupning'], last: { kind: 'area', itemId: 'fordjupning', updatedAt: expect.any(String) as string } }]);
  });
});

describe('images in a notebook', () => {
  it('keeps an added image under a name of its own, the next free one, and serves it as it came', async () => {
    await load(example);

    const first = await send('POST', `${NOTES}/notebook/images`, { mediaType: 'image/png', data: PIXEL_PNG });
    const second = await send('POST', `${NOTES}/notebook/images`, { mediaType: 'image/png', data: PIXEL_PNG });
    const served = await here.app.request(`${NOTES}/notebook/images/bild-1.png`);

    expect([first.status, NoteImageSchema.parse(first.json)]).toEqual([201, { name: 'bild-1.png', mediaType: 'image/png' }]);
    expect(NoteImageSchema.parse(second.json).name).toBe('bild-2.png');
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(await served.arrayBuffer()).toString('base64')).toBe(PIXEL_PNG);
  });

  it('refuses data that is not the image it claims to be, a type it does not keep, and an image too large', async () => {
    await load(example);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');

    const claimsPng = await send('POST', `${NOTES}/notebook/images`, { mediaType: 'image/png', data: svg });
    const asSvg = await send('POST', `${NOTES}/notebook/images`, { mediaType: 'image/svg+xml', data: svg });
    const huge = Buffer.concat([Buffer.from(PIXEL_PNG, 'base64'), Buffer.alloc(NOTE_IMAGE_MAX_BYTES)]).toString('base64');
    const tooLarge = await send('POST', `${NOTES}/notebook/images`, { mediaType: 'image/png', data: huge });

    expect([claimsPng.status, (claimsPng.json as { title: string }).title]).toEqual([400, 'Not the image it claims to be']);
    expect(asSvg.status).toBe(400);
    expect(tooLarge.status).toBe(413);
    expect((await here.app.request(`${NOTES}/notebook/images/bild-1.png`)).status).toBe(404);
  });

  it('refuses an image sent as anything but JSON, like every write', async () => {
    await load(example);

    const response = await here.app.request(`${NOTES}/notebook/images`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: Buffer.from(PIXEL_PNG, 'base64') });

    expect(response.status).toBe(415);
    expect((await here.app.request(`${NOTES}/notebook/images/bild-1.png`)).status).toBe(404);
  });

  it('answers a name that is not one of the notebook’s images with 404', async () => {
    await load(example);

    for (const name of ['bild-1.png', '..%2Fsubject.yaml', 'bild-1.svg']) {
      expect((await here.app.request(`${NOTES}/notebook/images/${name}`)).status).toBe(404);
    }
  });
});

describe('exporting a notebook', () => {
  it('gives a zip of Markdown files per area, with the images the sections link to in bilder/ and none they do not', async () => {
    await load(example);
    await send('POST', `${NOTES}/notebook/images`, { mediaType: 'image/png', data: PIXEL_PNG });
    await send('POST', `${NOTES}/notebook/images`, { mediaType: 'image/png', data: PIXEL_PNG });
    await written('lessons', 'energi-och-effekt', '# Min rubrik\n\n![skärm](bilder/bild-2.png)');

    const response = await here.app.request(`${NOTES}/notebook.zip`);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));

    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(Object.keys(files).toSorted()).toEqual(['example-subject/01-grunder.md', 'example-subject/README.md', 'example-subject/bilder/bild-2.png']);
    expect(new TextDecoder().decode(files['example-subject/01-grunder.md'])).toBe('# Grunder\n\n## Energi och effekt\n\n### Min rubrik\n\n![skärm](bilder/bild-2.png)\n');
    expect(Buffer.from(files['example-subject/bilder/bild-2.png'] ?? []).toString('base64')).toBe(PIXEL_PNG);
  });

  it('answers an unknown subject with 404 and an interface language it does not have with 400', async () => {
    await load(example);

    expect((await here.app.request('/api/v1/notes/subjects/finns-inte/notebook.zip')).status).toBe(404);
    expect((await here.app.request(`${NOTES}/notebook.zip?interface=de`)).status).toBe(400);
  });
});

describe('the notebook migration', () => {
  it('makes a lesson’s notes, step by step, one section in step order, keeping when it was begun and last written, and drops the old table', async () => {
    const { db, drop } = await createScratchDatabase();
    try {
      const [first, second] = noteMigrations.map((migration) => ({ owner: 'notes', ...migration }));
      if (first === undefined || second === undefined) {
        throw new Error('the notes module no longer has the two migrations this test expects');
      }
      await migrate(db, [first]);
      await db.query(
        `INSERT INTO notes.note (subject_id, lesson_id, step, body, created_at, updated_at) VALUES
           ('s', 'a', 2, ' Tredje steget. ', '2026-01-03', '2026-01-03'),
           ('s', 'a', 0, 'Första steget.',   '2026-01-01', '2026-01-05'),
           ('s', 'b', 1, 'Bara en.',         '2026-01-02', '2026-01-02'),
           ('t', 'a', 0, 'Annat ämne.',      '2026-01-04', '2026-01-04')`,
      );

      await migrate(db, [first, second]);

      const rows = await db.query(`SELECT subject_id, kind, item_id, body, created_at::date::text AS begun, updated_at::date::text AS last FROM notes.section ORDER BY subject_id, item_id`);
      expect(rows).toEqual([
        { subject_id: 's', kind: 'lesson', item_id: 'a', body: 'Första steget.\n\nTredje steget.', begun: '2026-01-01', last: '2026-01-05' },
        { subject_id: 's', kind: 'lesson', item_id: 'b', body: 'Bara en.', begun: '2026-01-02', last: '2026-01-02' },
        { subject_id: 't', kind: 'lesson', item_id: 'a', body: 'Annat ämne.', begun: '2026-01-04', last: '2026-01-04' },
      ]);
      expect(await db.query(`SELECT to_regclass('notes.note') AS found`)).toEqual([{ found: null }]);
    } finally {
      await drop();
    }
  });
});
