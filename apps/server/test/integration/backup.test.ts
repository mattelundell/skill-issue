import { join } from 'node:path';
import { BackupSchema, RestoreResultSchema, SittingSchema, type Backup, type GivenAnswer } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCatalogue } from '../../src/core/catalogue/catalogue.js';
import { introduce } from '../../src/core/introduction.js';
import { install, type Installation } from './installation.js';

/**
 * A backup holds the whole installation — every revision of every subject, the
 * learning record and what each module keeps about the learner — and restores
 * only into an empty installation, where it reproduces the learner's state.
 */

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const INTRODUCTION = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'introduction');
const SUBJECT = 'example-subject';
const QUESTIONS_FILE = 'areas/grunder/lessons/energi-och-effekt/questions.yaml';
const ZONE = 'Europe/Stockholm';

/** Every table a backup holds, as the installation keeps it. */
const BACKED_UP = ['catalogue.subject', 'catalogue.item', 'catalogue.entry', 'catalogue.revision', 'catalogue.asset', 'record.event', 'lessons.position', 'assessment.sitting', 'notes.note'] as const;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

let example: PackFiles;

beforeAll(async () => {
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(read.error)}`);
  }
  example = read.value;
});

let source: Installation;
let target: Installation;

beforeEach(async () => {
  [source, target] = await Promise.all([install(), install()]);
});

afterEach(async () => {
  await Promise.all([source.drop(), target.drop()]);
});

async function call(on: Installation, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: unknown }> {
  const response = await on.app.request(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text === '' ? undefined : JSON.parse(text) };
}

async function load(on: Installation, files: PackFiles): Promise<void> {
  const response = await on.app.request('/api/v1/content/packs', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: new Uint8Array(writeZip(files, SUBJECT)).buffer,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`pack refused: ${response.status} ${await response.text()}`);
  }
}

/** The example with one question reworded, so that question gains a second revision. */
function reworded(files: PackFiles): PackFiles {
  const text = decode(files.get(QUESTIONS_FILE));
  const prompt = 'prompt: Vilken enhet anger effekt?';
  if (!text.includes(prompt)) {
    throw new Error(`${QUESTIONS_FILE} no longer holds the prompt these tests reword`);
  }
  return new Map(files).set(QUESTIONS_FILE, encode(text.replace(prompt, 'prompt: Vilken av enheterna anger effekt?')));
}

const answer = (on: Installation, questionId: string, given: GivenAnswer, setting: 'lesson-check' | 'review' = 'lesson-check') =>
  call(on, `/assessment/subjects/${SUBJECT}/questions/${questionId}/answers`, { method: 'POST', body: { answer: given, durationMs: 2500, timeZone: ZONE, setting } });

/**
 * An installation that has been studied in: a question answered, then the
 * subject reloaded so the answer names a revision the pack no longer carries;
 * a lesson gone into, a note written, one exam handed in and one left open.
 */
async function studied(on: Installation): Promise<void> {
  await load(on, example);
  expect((await answer(on, 'kwh-eller-kw', { type: 'single-choice', option: 'a' })).status).toBe(200);
  await load(on, reworded(example));
  expect((await answer(on, 'kwh-eller-kw', { type: 'single-choice', option: 'b' }, 'review')).status).toBe(200);
  expect((await call(on, `/lessons/subjects/${SUBJECT}/lessons/energi-och-effekt/position`, { method: 'PUT', body: { step: 1, revision: 1, timeZone: ZONE } })).status).toBe(200);
  expect((await call(on, `/notes/subjects/${SUBJECT}/lessons/energi-och-effekt/steps/1`, { method: 'PUT', body: { body: 'Effekt × tid = energi.' } })).status).toBe(200);
  const handedIn = SittingSchema.parse((await call(on, `/assessment/subjects/${SUBJECT}/exams`, { method: 'POST', body: { scope: { kind: 'lesson', id: 'energi-och-effekt' } } })).json);
  // A question left unanswered is allowed in a hand-in; the true-or-false ones are answered, so the sitting has answers of both kinds.
  const answers = handedIn.questions.filter((question) => question.type === 'true-false').map((question) => ({ questionId: question.id, answer: { type: 'true-false', value: true }, durationMs: 1000 }));
  const handIn = await call(on, `/assessment/subjects/${SUBJECT}/exams/${handedIn.id}`, { method: 'POST', body: { answers, timeZone: ZONE } });
  expect(handIn.status).toBe(200);
  expect((await call(on, `/assessment/subjects/${SUBJECT}/exams`, { method: 'POST', body: { scope: { kind: 'area', id: 'grunder' } } })).status).toBe(201);
}

async function backupOf(on: Installation): Promise<Backup> {
  const response = await on.app.request('/api/v1/backup');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="skill-issue-backup-\d{4}-\d{2}-\d{2}\.json"$/);
  return BackupSchema.parse(await response.json());
}

const restore = (on: Installation, backup: unknown, query = '') => call(on, `/backup${query}`, { method: 'POST', body: backup });

/** Every row of a table as PostgreSQL writes it as JSON, in a fixed order, so two installations can be compared row for row. */
async function rowsOf(on: Installation, table: (typeof BACKED_UP)[number]): Promise<readonly unknown[]> {
  const rows = await on.db.query(`SELECT to_jsonb(t) AS row FROM ${table} t`);
  return rows.map((r) => JSON.stringify(r['row'])).toSorted();
}

/** What the learner is shown of their state, read through the API as the browser reads it. */
async function seen(on: Installation): Promise<unknown> {
  const paths = [
    `/content/subjects/${SUBJECT}`,
    `/lessons/subjects/${SUBJECT}/positions`,
    '/lessons/resume',
    `/notes/subjects/${SUBJECT}/notes`,
    `/assessment/subjects/${SUBJECT}/passed`,
    `/review/subjects/${SUBJECT}/due?timeZone=${ZONE}`,
    `/progress/subjects/${SUBJECT}?timeZone=${ZONE}`,
  ];
  const answers = await Promise.all(
    paths.map(async (path) => {
      const answered = await call(on, path);
      if (answered.status !== 200) {
        throw new Error(`${path} answered ${answered.status}: ${JSON.stringify(answered.json)}`);
      }
      return [path, answered.json] as const;
    }),
  );
  // Expected recall falls with every millisecond, so two reads a moment apart differ in the seventh decimal; four are compared.
  const rounded: unknown = JSON.parse(JSON.stringify(Object.fromEntries(answers), (_key, value: unknown) => (typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(4)) : value)));
  return rounded;
}

describe('backing up', () => {
  it('holds every revision the record names, though the subject now offers only the latest', async () => {
    await studied(source);

    const backup = await backupOf(source);

    const revisions = backup.tables.find((t) => t.table === 'catalogue.revision')?.rows ?? [];
    const asked = revisions.filter((row) => row['kind'] === 'question' && row['id'] === 'kwh-eller-kw' && row['language'] === 'sv');
    expect(asked.map((row) => Number(row['revision'])).toSorted((a, b) => a - b)).toEqual([1, 2]);
    const events = backup.tables.find((t) => t.table === 'record.event')?.rows ?? [];
    expect(events.filter((row) => row['item_id'] === 'kwh-eller-kw' && row['setting'] !== 'exam').map((row) => [row['setting'], row['revision']])).toEqual([
      ['lesson-check', 1],
      ['review', 2],
    ]);
  });

  it('names the tables in the order they restore, by owner, and leaves out what review rebuilds', async () => {
    await studied(source);

    const backup = await backupOf(source);

    expect(backup.tables.map(({ owner, table }) => `${owner}:${table}`)).toEqual([
      'core:catalogue.subject',
      'core:catalogue.item',
      'core:catalogue.entry',
      'core:catalogue.revision',
      'core:catalogue.asset',
      'core:record.event',
      'lessons:lessons.position',
      'assessment:assessment.sitting',
      'notes:notes.note',
    ]);
    expect(Object.keys(backup.migrations)).toEqual(expect.arrayContaining(['core', 'notes', 'lessons', 'assessment', 'review']));
    expect(backup.migrations['notes']).toEqual(['0001_note']);
  });
});

describe('restoring', () => {
  it('reproduces every table the backup holds and everything the learner is shown', async () => {
    await studied(source);
    const backup = await backupOf(source);

    const restored = await restore(target, backup);

    expect(restored.status).toBe(200);
    expect(RestoreResultSchema.parse(restored.json)).toEqual({
      dryRun: false,
      tables: backup.tables.map(({ owner, table, rows }) => ({ owner, table, rows: rows.length })),
    });
    for (const table of BACKED_UP) {
      expect({ table, rows: await rowsOf(target, table) }).toEqual({ table, rows: await rowsOf(source, table) });
    }
    expect(await seen(target)).toEqual(await seen(source));
  });

  it('numbers the next row of the record after the restored ones', async () => {
    await studied(source);
    const backup = await backupOf(source);
    await restore(target, backup);
    const last = Math.max(...(backup.tables.find((t) => t.table === 'record.event')?.rows ?? []).map((row) => Number(row['seq'])));

    expect((await answer(target, 'effekt-ar-takt', { type: 'true-false', value: true })).status).toBe(200);

    const rows = await target.db.query("SELECT seq FROM record.event WHERE item_id = 'effekt-ar-takt' AND setting = 'lesson-check'");
    expect(rows.map((row) => Number(row['seq']))).toEqual([last + 1]);
  });

  it('with a dry run says what it would write and writes nothing', async () => {
    await studied(source);
    const backup = await backupOf(source);

    const tried = await restore(target, backup, '?dryRun=true');

    expect(tried.status).toBe(200);
    expect(RestoreResultSchema.parse(tried.json)).toMatchObject({ dryRun: true });
    expect(RestoreResultSchema.parse(tried.json).tables).toEqual(backup.tables.map(({ owner, table, rows }) => ({ owner, table, rows: rows.length })));
    expect(backup.tables.find((t) => t.table === 'notes.note')?.rows).toHaveLength(1);
    for (const table of BACKED_UP) {
      expect({ table, rows: await rowsOf(target, table) }).toEqual({ table, rows: [] });
    }
  });

  it('refuses an installation that already holds a subject, and changes nothing in it', async () => {
    await studied(source);
    const backup = await backupOf(source);
    await load(target, example);
    const before = await rowsOf(target, 'catalogue.revision');

    const refused = await restore(target, backup);

    expect(refused).toMatchObject({ status: 409, json: { title: 'The installation is not empty' } });
    expect(await rowsOf(target, 'catalogue.revision')).toEqual(before);
    expect(await rowsOf(target, 'record.event')).toEqual([]);
  });

  it('takes an installation holding only an introduction nobody has begun as empty: the introduction makes way for the backup', async () => {
    await studied(source);
    const backup = await backupOf(source);
    expect(await introduce(target.db, createCatalogue(target.db), INTRODUCTION)).toBe('loaded');

    // A dry run writes nothing, and leaves the introduction where it was.
    expect((await restore(target, backup, '?dryRun=true')).status).toBe(200);
    expect((await call(target, '/content/subjects')).json).toMatchObject([{ id: 'kom-igang' }]);

    expect((await restore(target, backup)).status).toBe(200);
    for (const table of BACKED_UP) {
      expect({ table, rows: await rowsOf(target, table) }).toEqual({ table, rows: await rowsOf(source, table) });
    }
  });

  it('refuses an installation whose introduction has been begun, since the learner has a history with it', async () => {
    await studied(source);
    const backup = await backupOf(source);
    await introduce(target.db, createCatalogue(target.db), INTRODUCTION);
    expect((await call(target, '/lessons/subjects/kom-igang/lessons/sa-laser-du/position', { method: 'PUT', body: { step: 1, revision: 1, timeZone: ZONE } })).status).toBe(200);

    expect(await restore(target, backup)).toMatchObject({ status: 409, json: { title: 'The installation is not empty' } });
    expect((await call(target, '/content/subjects')).json).toMatchObject([{ id: 'kom-igang' }]);
  });

  it('refuses a backup written under other migrations than this installation has, naming the owner', async () => {
    await studied(source);
    const backup = await backupOf(source);

    const refused = await restore(target, { ...backup, migrations: { ...backup.migrations, notes: ['0001_note', '0002_tags'] } });

    expect(refused).toMatchObject({ status: 409, json: { title: 'The backup was written by another version' } });
    expect((refused.json as { detail: string }).detail).toContain('notes');
    expect(await rowsOf(target, 'catalogue.subject')).toEqual([]);
  });

  it('refuses a table that its owner does not name as its own, so a backup cannot write into any table it likes', async () => {
    await studied(source);
    const backup = await backupOf(source);
    const notes = backup.tables.find((t) => t.table === 'notes.note');
    if (notes === undefined) {
      throw new Error('no notes in the backup');
    }

    const intoReview = await restore(target, { ...backup, tables: [...backup.tables, { owner: 'notes', table: 'review.memory', rows: [] }] });
    const unknownModule = await restore(target, { ...backup, tables: [...backup.tables, { owner: 'flashcards', table: 'flashcards.card', rows: [{}] }] });

    expect(intoReview).toMatchObject({ status: 422, json: { title: 'The backup holds a table no one here owns' } });
    expect((intoReview.json as { detail: string }).detail).toContain('review.memory');
    expect(unknownModule).toMatchObject({ status: 422, json: { title: 'The backup holds a table no one here owns' } });
    expect((unknownModule.json as { detail: string }).detail).toContain('flashcards.card');
  });

  it('rolls everything back when one row does not fit, and says which table it was in', async () => {
    await studied(source);
    const backup = await backupOf(source);
    const tables = backup.tables.map((t) => (t.table === 'record.event' ? { ...t, rows: t.rows.map((row, i) => (i === 0 ? { ...row, revision: 99 } : row)) } : t));

    const refused = await restore(target, { ...backup, tables });

    expect(refused).toMatchObject({ status: 422, json: { title: 'The backup does not restore' } });
    expect((refused.json as { detail: string }).detail).toContain('record.event');
    for (const table of BACKED_UP) {
      expect({ table, rows: await rowsOf(target, table) }).toEqual({ table, rows: [] });
    }
  });

  it('refuses a body that is not a backup, saying where', async () => {
    const refused = await restore(target, { format: 'skill-issue-backup', formatVersion: 2 });

    expect(refused).toMatchObject({ status: 400, json: { title: 'The body is not a backup' } });
    expect((refused.json as { detail: string }).detail).toContain('formatVersion');
  });

  it('refuses a body not sent as JSON, so a page on another site cannot restore one through the learner\'s browser without asking first', async () => {
    await studied(source);
    const backup = await backupOf(source);

    // text/plain is a type a page on any site may send without the browser asking the application first.
    const response = await target.app.request('/api/v1/backup', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(backup) });

    expect({ status: response.status, title: ((await response.json()) as { title: string }).title }).toEqual({ status: 415, title: 'Send the request as application/json' });
    expect(await rowsOf(target, 'catalogue.subject')).toEqual([]);
  });
});
