import { join } from 'node:path';
import { NoteListSchema, NoteSchema, NOTE_MAX_LENGTH, type Note } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const NOTES = '/api/v1/notes/subjects/example-subject';

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

async function write(lessonId: string, step: number, body: unknown, subject = NOTES): Promise<{ status: number; json: unknown }> {
  const response = await here.app.request(`${subject}/lessons/${lessonId}/steps/${step}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: response.status === 204 ? undefined : await response.json() };
}

async function written(lessonId: string, step: number, body: string): Promise<Note> {
  const { status, json } = await write(lessonId, step, { body });
  expect(status).toBe(200);
  return NoteSchema.parse(json);
}

async function list(query = ''): Promise<readonly Note[]> {
  const response = await here.app.request(`${NOTES}/notes${query}`);
  const json: unknown = await response.json();
  if (response.status !== 200) {
    throw new Error(`notes answered ${response.status}: ${JSON.stringify(json)}`);
  }
  const parsed = NoteListSchema.parse(json);
  expect(parsed.subjectId).toBe('example-subject');
  return parsed.notes;
}

/** Where each note sits and what it says, in the order given: enough to tell one note from another. */
const filed = (notes: readonly Note[]) => notes.map(({ lessonId, step, body }) => [lessonId, step, body]);

describe('writing a note', () => {
  it('files it under the lesson and the step it was written at', async () => {
    await load(example);

    const note = await written('energi-och-effekt', 1, 'Effekt × tid = energi.');

    expect(note).toMatchObject({ subjectId: 'example-subject', lessonId: 'energi-och-effekt', step: 1, body: 'Effekt × tid = energi.' });
    expect(note.createdAt).toBe(note.updatedAt);
    expect(filed(await list())).toEqual([['energi-och-effekt', 1, 'Effekt × tid = energi.']]);
  });

  it('keeps one note per step: writing again replaces the text and keeps when it was begun', async () => {
    await load(example);
    const first = await written('energi-och-effekt', 0, 'Första tanken.');

    const second = await written('energi-och-effekt', 0, 'Första tanken, omskriven.');

    expect(second.createdAt).toBe(first.createdAt);
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
    expect(filed(await list())).toEqual([['energi-och-effekt', 0, 'Första tanken, omskriven.']]);
  });

  it('keeps the text exactly as written, Markdown and line breaks included', async () => {
    await load(example);
    const body = '> 2 kW × 3 h = 6 kWh\n\n**Tumregel:** effekt gånger tid.\n';

    await written('energi-och-effekt', 1, body);

    expect(filed(await list())).toEqual([['energi-och-effekt', 1, body]]);
  });

  it('removes the note when its text is emptied, and leaves the others', async () => {
    await load(example);
    await written('energi-och-effekt', 0, 'Ska bort.');
    await written('energi-och-effekt', 1, 'Ska stå kvar.');

    const { status } = await write('energi-och-effekt', 0, { body: '  \n ' });

    expect(status).toBe(204);
    expect(filed(await list())).toEqual([['energi-och-effekt', 1, 'Ska stå kvar.']]);
  });

  it('answers an emptied note that was never written as removed, storing nothing', async () => {
    await load(example);

    expect((await write('energi-och-effekt', 0, { body: '' })).status).toBe(204);
    expect(await list()).toEqual([]);
  });

  it('refuses a step beyond the lesson, naming how many it has', async () => {
    await load(example);

    const { status, json } = await write('energi-och-effekt', 3, { body: 'Efter sista steget.' });

    expect(status).toBe(400);
    expect(json).toMatchObject({ title: 'No such step', detail: 'The lesson has 3 steps, numbered from 0 to 2.' });
    expect(await list()).toEqual([]);
  });

  it('refuses an unknown lesson and an unknown subject', async () => {
    await load(example);

    const lesson = await write('finns-inte', 0, { body: 'x' });
    const subject = await write('energi-och-effekt', 0, { body: 'x' }, '/api/v1/notes/subjects/finns-inte');

    expect([lesson.status, lesson.json]).toEqual([404, expect.objectContaining({ title: 'No such lesson' })]);
    expect([subject.status, subject.json]).toEqual([404, expect.objectContaining({ title: 'No such subject' })]);
    expect(await list()).toEqual([]);
  });

  it('refuses a body that is not a note, and one too long to keep', async () => {
    await load(example);

    const notText = await write('energi-och-effekt', 0, { body: 12 });
    const extra = await write('energi-och-effekt', 0, { body: 'x', title: 'y' });
    const tooLong = await write('energi-och-effekt', 0, { body: 'x'.repeat(NOTE_MAX_LENGTH + 1) });

    expect([notText.status, extra.status, tooLong.status]).toEqual([400, 400, 400]);
    expect(tooLong.json).toMatchObject({ title: 'The body is not a note' });
    expect(await list()).toEqual([]);
  });

  it('refuses a step that is not a whole number from 0', async () => {
    await load(example);

    const response = await here.app.request(`${NOTES}/lessons/energi-och-effekt/steps/-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    });

    expect(response.status).toBe(400);
    expect(await list()).toEqual([]);
  });
});

describe('browsing notes', () => {
  it('lists the most recently written first, across lessons', async () => {
    await load(example);
    await written('energi-och-effekt', 0, 'Äldst.');
    await written('enhetsprefix', 1, 'Mitten.');
    await written('energibalans', 0, 'Nyast.');

    expect(filed(await list())).toEqual([
      ['energibalans', 0, 'Nyast.'],
      ['enhetsprefix', 1, 'Mitten.'],
      ['energi-och-effekt', 0, 'Äldst.'],
    ]);
  });

  it('lists one lesson’s notes when asked for that lesson', async () => {
    await load(example);
    // Written in an order that differs from step order both ways round, so neither newest nor oldest first passes for it.
    await written('energi-och-effekt', 1, 'Mitten.');
    await written('energi-och-effekt', 2, 'Kontrollen.');
    await written('enhetsprefix', 0, 'Annan lektion.');
    await written('energi-och-effekt', 0, 'Början.');

    expect(filed(await list('?lesson=energi-och-effekt'))).toEqual([
      ['energi-och-effekt', 0, 'Början.'],
      ['energi-och-effekt', 1, 'Mitten.'],
      ['energi-och-effekt', 2, 'Kontrollen.'],
    ]);
  });

  it('keeps a note whose lesson the subject no longer holds', async () => {
    await load(example);
    await written('energibalans', 0, 'Om energibalans.');
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

    expect(filed(await list())).toEqual([['energibalans', 0, 'Om energibalans.']]);
  });

  it('answers an unknown subject with 404', async () => {
    await load(example);

    const response = await here.app.request('/api/v1/notes/subjects/finns-inte/notes');

    expect(response.status).toBe(404);
  });
});

/** Three notes in three lessons, for searching. */
async function three(): Promise<void> {
  await load(example);
  await written('energi-och-effekt', 0, 'Effekt mäts i kilowatt.');
  await written('enhetsprefix', 0, 'Mega betyder miljon. Återbetalningstid är något annat.');
  await written('energibalans', 1, 'Värmeförluster genom klimatskalet.');
}

describe('searching notes', () => {
  it('finds a note by a word in it, from the start of the word', async () => {
    await three();

    expect(filed(await list('?q=kilo'))).toEqual([['energi-och-effekt', 0, 'Effekt mäts i kilowatt.']]);
    expect(filed(await list('?q=v%C3%A4rme'))).toEqual([['energibalans', 1, 'Värmeförluster genom klimatskalet.']]);
  });

  it('does not match inside a word', async () => {
    await three();

    // "betal" lies inside "Återbetalningstid", not at the start of a word.
    expect(await list('?q=betal')).toEqual([]);
  });

  it('ignores case, and needs every word given', async () => {
    await three();

    expect(filed(await list('?q=MEGA%20miljon'))).toEqual([['enhetsprefix', 0, 'Mega betyder miljon. Återbetalningstid är något annat.']]);
    expect(await list('?q=mega%20kilowatt')).toEqual([]);
  });

  it('takes punctuation in the query as a space, never as search syntax', async () => {
    await three();

    expect(filed(await list('?q=effekt%26%7C!%3A*'))).toEqual([['energi-och-effekt', 0, 'Effekt mäts i kilowatt.']]);
    expect(filed(await list("?q='%22()"))).toHaveLength(3);
  });

  it('searches one lesson when given both', async () => {
    await three();

    expect(await list('?q=effekt&lesson=enhetsprefix')).toEqual([]);
    expect(filed(await list('?q=mega&lesson=enhetsprefix'))).toEqual([['enhetsprefix', 0, 'Mega betyder miljon. Återbetalningstid är något annat.']]);
  });
});
