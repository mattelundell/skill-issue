import { join } from 'node:path';
import { SittingSchema, type GivenAnswer, type Sitting } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

/**
 * The learning record: one append-only row for every answer, every step gone
 * through, every lesson finished and every exam sat. These tests read the
 * table itself, since what it holds is the contract the review and progress
 * modules will be built on.
 */

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const ASSESSMENT = '/api/v1/assessment/subjects/example-subject';
const LESSON = '/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt';
const QUESTIONS_FILE = 'areas/grunder/lessons/energi-och-effekt/questions.yaml';
const ZONE = 'Europe/Stockholm';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

/** The right answer to every question in the example subject, with what the record should say of its type. */
const QUESTIONS: Readonly<Record<string, { right: GivenAnswer; type: string; options: number | null; concepts: string[] }>> = {
  'kwh-eller-kw': { right: { type: 'single-choice', option: 'b' }, type: 'single-choice', options: 3, concepts: ['effekt'] },
  'berakna-energi': { right: { type: 'numeric', value: 6 }, type: 'numeric', options: null, concepts: ['energi', 'effekt'] },
  'effekt-ar-takt': { right: { type: 'true-false', value: true }, type: 'true-false', options: 2, concepts: ['effekt'] },
  'prefix-ordning': { right: { type: 'ordering', items: ['kWh', 'MWh', 'GWh'] }, type: 'ordering', options: 3, concepts: ['si-prefix'] },
  'prefix-par': {
    right: { type: 'matching', pairs: [{ left: 'kilo', right: 'tusen' }, { left: 'mega', right: 'miljon' }, { left: 'giga', right: 'miljard' }] },
    type: 'matching',
    options: 3,
    concepts: ['si-prefix'],
  },
  'kilo-betyder': { right: { type: 'short-text', text: 'k' }, type: 'short-text', options: null, concepts: ['si-prefix'] },
  'vagar-ut': { right: { type: 'multiple-choice', options: ['a', 'b'] }, type: 'multiple-choice', options: 3, concepts: ['forluster'] },
  'forklara-balans': { right: { type: 'free-recall', knew: true }, type: 'free-recall', options: null, concepts: ['energibalans'] },
};

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
  return { status: response.status, json: await response.json() };
}

const answer = async (questionId: string, given: GivenAnswer, extra: Record<string, unknown> = {}, query = '') =>
  send('POST', `${ASSESSMENT}/questions/${questionId}/answers${query}`, { answer: given, durationMs: 4200, timeZone: ZONE, ...extra });

const move = async (step: number, revision = 1) => send('PUT', `${LESSON}/position`, { step, revision, timeZone: ZONE });

async function sit(kind: 'lesson' | 'area', id: string): Promise<Sitting> {
  const started = await send('POST', `${ASSESSMENT}/exams`, { scope: { kind, id } });
  expect(started.status).toBe(201);
  return SittingSchema.parse(started.json);
}

/** Every row of the record, oldest first, with its time as text so a test can read it to the millisecond. */
async function rows(): Promise<Record<string, unknown>[]> {
  const found = await here.db.query(
    `SELECT kind, to_json(at) #>> '{}' AS at, time_zone, subject_id, item_kind, item_id, revision, language, setting,
            concepts, sources, question_type, options, given, correct, score::float8 AS score, duration_ms::float8 AS duration_ms, step, sitting_id::text, result
       FROM record.event ORDER BY seq`,
  );
  return found.map((row) => ({ ...row }));
}

/** A row with every field the architecture lists for an answer, the rest of the table's columns empty. */
const answerRow = (fields: Record<string, unknown>) => ({
  kind: 'answer',
  time_zone: ZONE,
  subject_id: 'example-subject',
  item_kind: 'question',
  revision: 1,
  language: 'sv',
  setting: 'lesson-check',
  sources: ['exempelkalla'],
  duration_ms: 4200,
  step: null,
  sitting_id: null,
  result: null,
  ...fields,
});

describe('an answer to a check', () => {
  it('is recorded with the item, its revision and concepts, when and where, what was answered, the grade, how long it took, its type and options, and its setting', async () => {
    await load(example);
    const before = Date.now();

    await answer('kwh-eller-kw', { type: 'single-choice', option: 'a' });
    await answer('kwh-eller-kw', { type: 'single-choice', option: 'b' }, { durationMs: 900 });

    const recorded = await rows();
    const after = Date.now();
    expect(recorded.map(({ at: _at, ...row }) => row)).toEqual([
      answerRow({ item_id: 'kwh-eller-kw', concepts: ['effekt'], question_type: 'single-choice', options: 3, given: { type: 'single-choice', option: 'a' }, correct: false, score: 0 }),
      answerRow({ item_id: 'kwh-eller-kw', concepts: ['effekt'], question_type: 'single-choice', options: 3, given: { type: 'single-choice', option: 'b' }, correct: true, score: 1, duration_ms: 900 }),
    ]);
    for (const { at } of recorded) {
      const instant = new Date(String(at)).getTime();
      expect(instant).toBeGreaterThanOrEqual(before);
      expect(instant).toBeLessThanOrEqual(after);
      // Stored to the millisecond, not the database's microsecond: at most three digits of a second, which the database prints without trailing zeros.
      expect(String(at)).toMatch(/:\d{2}(\.\d{1,3})?(\+00:00|Z)$/);
    }
  });

  it.each(Object.keys(QUESTIONS))('records %s with its question type, its number of options and the concepts it tests', async (questionId) => {
    await load(example);
    const expected = QUESTIONS[questionId];
    if (expected === undefined) {
      throw new Error(`no expectation for ${questionId}`);
    }

    expect((await answer(questionId, expected.right)).status).toBe(200);

    const [row, ...others] = await rows();
    expect(others).toEqual([]);
    expect(row).toMatchObject({ item_id: questionId, question_type: expected.type, options: expected.options, concepts: expected.concepts, given: expected.right, correct: true, score: 1 });
  });

  it('records the language the question was shown in, and the revision of that language', async () => {
    await load(example);
    const english = decode(example.get('areas/grunder/lessons/energi-och-effekt/questions.en.yaml'));
    await load(new Map(example).set('areas/grunder/lessons/energi-och-effekt/questions.en.yaml', encode(english.replace('Which unit states power?', 'Which unit gives power?'))));

    await answer('kwh-eller-kw', { type: 'single-choice', option: 'b' }, {}, '?language=en');
    await answer('kwh-eller-kw', { type: 'single-choice', option: 'b' });

    expect((await rows()).map((row) => [row['language'], row['revision']])).toEqual([
      ['en', 2],
      ['sv', 1],
    ]);
  });

  it('records the revision answered, so an answer keeps meaning what it meant after the question is changed', async () => {
    await load(example);
    await answer('kwh-eller-kw', { type: 'single-choice', option: 'b' });
    const changed = decode(example.get(QUESTIONS_FILE)).replace('Vilken enhet anger effekt?', 'Vilken enhet mäter effekt?');
    await load(new Map(example).set(QUESTIONS_FILE, encode(changed)));

    await answer('kwh-eller-kw', { type: 'single-choice', option: 'b' });

    expect((await rows()).map((row) => row['revision'])).toEqual([1, 2]);
  });

  it('records nothing for an answer refused: of another type, without a time zone, with one that is not a zone, or without its time', async () => {
    await load(example);

    const refused = [
      await answer('kwh-eller-kw', { type: 'true-false', value: true }),
      await send('POST', `${ASSESSMENT}/questions/kwh-eller-kw/answers`, { answer: { type: 'single-choice', option: 'b' }, durationMs: 10 }),
      await answer('kwh-eller-kw', { type: 'single-choice', option: 'b' }, { timeZone: 'Mars/Olympus_Mons' }),
      await send('POST', `${ASSESSMENT}/questions/kwh-eller-kw/answers`, { answer: { type: 'single-choice', option: 'b' }, timeZone: ZONE }),
      await answer('finns-inte', { type: 'true-false', value: true }),
    ];

    expect(refused.map(({ status }) => status)).toEqual([400, 400, 400, 400, 404]);
    expect(await rows()).toEqual([]);
  });
});

describe('an exam', () => {
  it('records nothing when it is started, and when handed in records every question drawn with its time on screen, an unanswered one as answered with nothing, and then the sitting', async () => {
    await load(example);
    const sitting = await sit('area', 'grunder');
    expect(await rows()).toEqual([]);
    const [first, ...rest] = sitting.questions;
    if (first === undefined) {
      throw new Error('the sitting asked nothing');
    }
    const startedAt = Date.parse(sitting.startedAt);

    const handedIn = await send('POST', `${ASSESSMENT}/exams/${sitting.id}`, { answers: [{ questionId: first.id, answer: QUESTIONS[first.id]?.right, durationMs: 7300 }], timeZone: ZONE });
    expect(handedIn.status).toBe(200);

    const recorded = await rows();
    const answers = recorded.filter((row) => row['kind'] === 'answer');
    expect(answers.map(({ at: _at, ...row }) => row)).toEqual(
      sitting.questions.map((question, index) => {
        const known = QUESTIONS[question.id];
        return answerRow({
          item_id: question.id,
          setting: 'exam',
          sitting_id: sitting.id,
          duration_ms: index === 0 ? 7300 : null,
          concepts: known?.concepts,
          question_type: known?.type,
          options: known?.options,
          given: index === 0 ? known?.right : null,
          correct: index === 0,
          score: index === 0 ? 1 : 0,
        });
      }),
    );
    const exams = recorded.filter((row) => row['kind'] !== 'answer');
    expect(exams).toHaveLength(1);
    const [exam] = exams;
    expect(exam).toMatchObject({
      kind: 'exam',
      time_zone: ZONE,
      subject_id: 'example-subject',
      item_kind: 'area',
      item_id: 'grunder',
      revision: 1,
      language: 'sv',
      setting: null,
      given: null,
      correct: null,
      sitting_id: sitting.id,
      result: { correct: 1, total: rest.length + 1, passMark: sitting.passMark, passed: false },
    });
    // The sitting's whole time, from started to handed in.
    expect(exam?.['duration_ms']).toBe(Date.parse(String(exam?.['at'])) - startedAt);
  });

  it('records a sitting handed in weeks after it was started', async () => {
    await load(example);
    const sitting = await sit('lesson', 'energi-och-effekt');
    await here.db.query(`UPDATE assessment.sitting SET started_at = now() - interval '40 days' WHERE id = $1`, [sitting.id]);
    const answers = sitting.questions.map((question) => ({ questionId: question.id, answer: QUESTIONS[question.id]?.right, durationMs: 1500 }));

    expect((await send('POST', `${ASSESSMENT}/exams/${sitting.id}`, { answers, timeZone: ZONE })).status).toBe(200);

    const [exam] = (await rows()).filter((row) => row['kind'] === 'exam');
    expect(Number(exam?.['duration_ms'])).toBeGreaterThan(40 * 86_400_000 - 60_000);
  });

  it('records nothing more when a sitting is handed in again', async () => {
    await load(example);
    const sitting = await sit('lesson', 'energi-och-effekt');
    const answers = sitting.questions.map((question) => ({ questionId: question.id, answer: QUESTIONS[question.id]?.right, durationMs: 1500 }));
    await send('POST', `${ASSESSMENT}/exams/${sitting.id}`, { answers, timeZone: ZONE });
    const once = await rows();

    const again = await send('POST', `${ASSESSMENT}/exams/${sitting.id}`, { answers, timeZone: ZONE });

    expect(again.status).toBe(409);
    expect(await rows()).toEqual(once);
  });

  it('refuses a hand-in without a time zone, and leaves the sitting open and the record empty', async () => {
    await load(example);
    const sitting = await sit('lesson', 'energi-och-effekt');
    const answers = sitting.questions.map((question) => ({ questionId: question.id, answer: QUESTIONS[question.id]?.right, durationMs: 1500 }));

    expect((await send('POST', `${ASSESSMENT}/exams/${sitting.id}`, { answers })).status).toBe(400);

    expect(await rows()).toEqual([]);
    expect((await send('POST', `${ASSESSMENT}/exams/${sitting.id}`, { answers, timeZone: ZONE })).status).toBe(200);
  });
});

/** A lesson row as the record should hold it, in the columns a lesson row fills or leaves empty. */
const lessonRow = (kind: string, step: number | null) => ({
  kind,
  time_zone: ZONE,
  subject_id: 'example-subject',
  item_kind: 'lesson',
  item_id: 'energi-och-effekt',
  revision: 1,
  language: 'sv',
  setting: null,
  given: null,
  correct: null,
  step,
});

describe('a lesson', () => {
  it('records each step gone through as the learner moves on, and the lesson finished at its end; moving back records nothing', async () => {
    await load(example);

    for (const step of [0, 1, 2, 1, 2, 3]) {
      expect((await move(step)).status).toBe(200);
    }

    expect((await rows()).map((row) => ({ kind: row['kind'], time_zone: row['time_zone'], subject_id: row['subject_id'], item_kind: row['item_kind'], item_id: row['item_id'], revision: row['revision'], language: row['language'], setting: row['setting'], given: row['given'], correct: row['correct'], step: row['step'] }))).toEqual([
      lessonRow('step', 0),
      lessonRow('step', 1),
      lessonRow('step', 1),
      lessonRow('step', 2),
      lessonRow('lesson-finished', null),
    ]);
  });

  it('records a lesson finished again when it is gone through again, but not when its end is only saved again, and nothing for a move refused', async () => {
    await load(example);
    for (const step of [0, 1, 2, 3, 3]) {
      await move(step);
    }

    expect((await move(1, 2)).status).toBe(409);
    expect((await move(9)).status).toBe(400);
    for (const step of [0, 1, 2, 3]) {
      await move(step);
    }

    expect((await rows()).map((row) => [row['kind'], row['step']])).toEqual([
      ['step', 0],
      ['step', 1],
      ['step', 2],
      ['lesson-finished', null],
      ['step', 0],
      ['step', 1],
      ['step', 2],
      ['lesson-finished', null],
    ]);
  });
});

describe('an answer in a scheduled review', () => {
  it('is recorded like a check answer, with the setting "review"', async () => {
    await load(example);

    await answer('kwh-eller-kw', { type: 'single-choice', option: 'b' }, { setting: 'review' });

    expect((await rows()).map(({ at: _at, ...row }) => row)).toEqual([
      answerRow({ item_id: 'kwh-eller-kw', concepts: ['effekt'], question_type: 'single-choice', options: 3, given: { type: 'single-choice', option: 'b' }, correct: true, score: 1, setting: 'review' }),
    ]);
  });

  it('is refused, and nothing recorded, for a setting a single answer is never given in', async () => {
    await load(example);

    const refused = await Promise.all(['exam', 'practice', 'anywhere'].map(async (setting) => answer('kwh-eller-kw', { type: 'single-choice', option: 'b' }, { setting })));

    expect(refused.map(({ status }) => status)).toEqual([400, 400, 400]);
    expect(await rows()).toEqual([]);
  });
});

describe('the table', () => {
  it('keeps the shape of every kind of row after the scheduler column is gone: an exam answer still needs its sitting', async () => {
    await load(example);
    await answer('kwh-eller-kw', { type: 'single-choice', option: 'a' });

    await expect(
      here.db.query(
        `INSERT INTO record.event (kind, at, time_zone, subject_id, item_kind, item_id, language, revision, setting, concepts, sources, question_type, given, correct, score)
              SELECT kind, at, time_zone, subject_id, item_kind, item_id, language, revision, 'exam', concepts, sources, question_type, given, correct, score FROM record.event`,
      ),
    ).rejects.toThrow(/event_shape/);
    expect(await here.db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'record' AND column_name = 'scheduler'`)).toEqual([]);
  });

  it('refuses to have a row changed or removed', async () => {
    await load(example);
    await answer('kwh-eller-kw', { type: 'single-choice', option: 'a' });

    await expect(here.db.query('UPDATE record.event SET correct = true')).rejects.toThrow(/append-only/);
    await expect(here.db.query('DELETE FROM record.event')).rejects.toThrow(/append-only/);

    expect((await rows()).map((row) => row['correct'])).toEqual([false]);
  });
});

describe('an exam sitting drawn before the record kept revisions', () => {
  it('is given, by migration, the revisions its questions and its scope had when it was drawn, and is then recorded with them', async () => {
    const { db, drop } = await (await import('./database.js')).createScratchDatabase();
    try {
      const { coreMigrations } = await import('../../src/core/migrations.js');
      const { migrate } = await import('../../src/core/migrate.js');
      const { createRegistry } = await import('../../src/core/registry.js');
      const { modules } = await import('../../src/modules/index.js');
      const { buildApp } = await import('../../src/core/app.js');
      const registry = createRegistry(modules);
      if (!registry.ok) {
        throw new Error('modules do not register');
      }
      const all = [...coreMigrations, ...registry.value.migrations];
      const before = all.filter((migration) => !(migration.owner === 'assessment' && migration.name === '0002_revisions'));
      expect(before).toHaveLength(all.length - 1);
      expect((await migrate(db, before)).ok).toBe(true);
      const app = buildApp({ db, registry: registry.value, version: 'test' });
      const loaded = await app.request('/api/v1/content/packs', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: new Uint8Array(writeZip(example, 'example-subject')).buffer });
      expect(loaded.status).toBe(201);
      // A sitting as the earlier code stored it: drawn questions without a revision. Then the question is changed, so revision 1 is not the current one.
      const [question] = await db.query(
        `SELECT r.body FROM catalogue.revision r WHERE r.subject_id = 'example-subject' AND r.kind = 'question' AND r.id = 'kwh-eller-kw' AND r.language = 'sv'`,
      );
      const drawn = [{ question: { ...(question?.['body'] as object), language: 'sv' }, sources: [{ id: 'exempelkalla', title: 'Exempelkälla om energi och effekt', publisher: 'Exempelförlaget' }] }];
      const asked = [{ id: 'kwh-eller-kw', language: 'sv', prompt: 'Vilken enhet anger effekt?', type: 'single-choice', options: [{ id: 'a', text: 'kWh' }, { id: 'b', text: 'kW' }, { id: 'c', text: 'kWh/m²' }] }];
      const [sitting] = await db.query(
        `INSERT INTO assessment.sitting (subject_id, scope_kind, scope_id, title, pass_mark, drawn, asked)
              VALUES ('example-subject', 'lesson', 'energi-och-effekt', 'Energi och effekt', 0.5, $1::jsonb, $2::jsonb) RETURNING id::text`,
        [JSON.stringify(drawn), JSON.stringify(asked)],
      );
      const changed = decode(example.get(QUESTIONS_FILE)).replace('Vilken enhet anger effekt?', 'Vilken enhet mäter effekt?');
      expect((await app.request('/api/v1/content/packs', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: new Uint8Array(writeZip(new Map(example).set(QUESTIONS_FILE, encode(changed)), 'example-subject')).buffer })).status).toBe(200);

      expect((await migrate(db, all)).ok).toBe(true);

      const [migrated] = await db.query(`SELECT scope_language, scope_revision, drawn #> '{0,revision}' AS revision FROM assessment.sitting`);
      expect(migrated).toEqual({ scope_language: 'sv', scope_revision: 1, revision: 1 });
      const handedIn = await app.request(`/api/v1/assessment/subjects/example-subject/exams/${String(sitting?.['id'])}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: 'kwh-eller-kw', answer: { type: 'single-choice', option: 'b' }, durationMs: 2000 }], timeZone: ZONE }),
      });
      expect(handedIn.status).toBe(200);
      const recorded = await db.query(`SELECT kind, item_id, revision FROM record.event ORDER BY seq`);
      expect(recorded.map((row) => ({ ...row }))).toEqual([
        { kind: 'answer', item_id: 'kwh-eller-kw', revision: 1 },
        { kind: 'exam', item_id: 'energi-och-effekt', revision: 1 },
      ]);
    } finally {
      await drop();
    }
  });
});
