import { join } from 'node:path';
import { DueCountsSchema, DueSchema, type GivenAnswer, type QuestionType } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { DefaultScheduler, Rating, type Grade } from 'ts-fsrs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLearningRecord, type RecordEvent } from '../../src/core/record/record.js';
import { rebuild } from '../../src/modules/review/memory.js';
import { createScheduler } from '../../src/modules/review/scheduler.js';
import { install, type Installation } from './installation.js';

/**
 * Scheduled review, read from the learning record. A history is written into
 * the record as it would have been written over days, and what the review
 * module makes of it is compared with the reference library driven by hand.
 */

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const SUBJECT = 'example-subject';
const REVIEW = '/api/v1/review';
const ZONE = 'Europe/Stockholm';
const QUESTIONS_FILES = ['areas/grunder/lessons/energi-och-effekt/questions.yaml', 'areas/grunder/lessons/energi-och-effekt/questions.en.yaml'];

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

/** What the record says of each question used here: its type, how many options a guess picks from, what it tests and rests on. */
const QUESTIONS: Readonly<Record<string, { type: QuestionType; options: number | undefined; concepts: string[]; right: GivenAnswer; wrong: GivenAnswer }>> = {
  'berakna-energi': { type: 'numeric', options: undefined, concepts: ['energi', 'effekt'], right: { type: 'numeric', value: 6 }, wrong: { type: 'numeric', value: 60 } },
  'effekt-ar-takt': { type: 'true-false', options: 2, concepts: ['effekt'], right: { type: 'true-false', value: true }, wrong: { type: 'true-false', value: false } },
  'kwh-eller-kw': { type: 'single-choice', options: 3, concepts: ['effekt'], right: { type: 'single-choice', option: 'b' }, wrong: { type: 'single-choice', option: 'a' } },
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
    body: new Uint8Array(writeZip(files, SUBJECT)).buffer,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`pack refused: ${response.status} ${await response.text()}`);
  }
}

type AnswerEvent = Extract<RecordEvent, { kind: 'answer' }>;

/** One answer as the record would have written it at `at`. */
function answerAt(questionId: string, at: string, correct: boolean, setting: 'lesson-check' | 'exam' | 'review' = 'lesson-check', timeZone = ZONE): AnswerEvent {
  const question = QUESTIONS[questionId];
  if (question === undefined) {
    throw new Error(`no such question in these tests: ${questionId}`);
  }
  return {
    kind: 'answer',
    at: new Date(at),
    timeZone,
    question: { subjectId: SUBJECT, id: questionId, language: 'sv', revision: 1 },
    setting,
    concepts: question.concepts,
    sources: ['exempelkalla'],
    questionType: question.type,
    options: question.options,
    given: correct ? question.right : question.wrong,
    correct,
    score: correct ? 1 : 0,
    durationMs: 3000,
    ...(setting === 'exam' ? { sittingId: '00000000-0000-4000-8000-000000000001' } : {}),
  };
}

const timed = (event: AnswerEvent, durationMs: number): AnswerEvent => ({ ...event, durationMs });

const write = async (events: readonly RecordEvent[]): Promise<void> => createLearningRecord(here.db).append(events);

async function due(query = `?timeZone=${ZONE}`) {
  const response = await here.app.request(`${REVIEW}/subjects/${SUBJECT}/due${query}`);
  expect(response.status).toBe(200);
  return DueSchema.parse(await response.json());
}

/** The memory table as it stands, in a fixed order. */
async function memory(): Promise<Record<string, unknown>[]> {
  const rows = await here.db.query(`SELECT subject_id, question_id, card, to_json(due_at) #>> '{}' AS due_at, to_json(counted_at) #>> '{}' AS counted_at FROM review.memory ORDER BY subject_id, question_id`);
  return rows.map((row) => ({ ...row }));
}

/** The reference library, configured by hand as the architecture pins it, and driven with the ratings a history should give. */
async function byHand(history: readonly { readonly at: string; readonly rating: Grade }[]) {
  const scheduler = await DefaultScheduler({ version: 'FSRS-6', desiredRetention: 0.9, enableShortTerm: false, enableFuzz: false });
  const first = history[0];
  if (first === undefined) {
    throw new Error('an empty history');
  }
  let card = scheduler.newCard({ now: new Date(first.at) });
  for (const { at, rating } of history) {
    card = scheduler.review({ card, grade: rating, now: new Date(at) }).card;
  }
  return card;
}

const DAY = 86_400_000;
const daysAgo = (days: number, hourUtc = 9): string => {
  const at = new Date(Date.now() - days * DAY);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return at.toISOString();
};

describe('the schedule of a scripted history', () => {
  it('matches the reference library driven by hand: wrong is again, right is good, a guessable right is hard, and only the first answer of a day counts', async () => {
    await load(example);
    await write([
      answerAt('berakna-energi', '2026-01-05T08:00:00Z', false),
      // Later the same day in Stockholm: the learning itself, not a measure of memory.
      answerAt('berakna-energi', '2026-01-05T08:05:00Z', true),
      answerAt('effekt-ar-takt', '2026-01-05T08:10:00Z', true),
      answerAt('kwh-eller-kw', '2026-01-05T08:20:00Z', true, 'exam'),
      answerAt('berakna-energi', '2026-01-06T09:00:00Z', true),
      answerAt('effekt-ar-takt', '2026-01-08T07:00:00Z', false, 'review'),
      answerAt('berakna-energi', '2026-01-09T07:30:00Z', true, 'review'),
      // 23:30 UTC on the 9th is already the 10th in Stockholm, so it counts.
      answerAt('effekt-ar-takt', '2026-01-09T23:30:00Z', true),
      answerAt('berakna-energi', '2026-01-21T12:00:00Z', true, 'exam'),
    ]);

    await due();

    const expected = {
      'berakna-energi': await byHand([
        { at: '2026-01-05T08:00:00Z', rating: Rating.Again },
        { at: '2026-01-06T09:00:00Z', rating: Rating.Good },
        { at: '2026-01-09T07:30:00Z', rating: Rating.Good },
        { at: '2026-01-21T12:00:00Z', rating: Rating.Good },
      ]),
      'effekt-ar-takt': await byHand([
        { at: '2026-01-05T08:10:00Z', rating: Rating.Hard },
        { at: '2026-01-08T07:00:00Z', rating: Rating.Again },
        { at: '2026-01-09T23:30:00Z', rating: Rating.Hard },
      ]),
      'kwh-eller-kw': await byHand([{ at: '2026-01-05T08:20:00Z', rating: Rating.Hard }]),
    };
    const stored = await memory();
    expect(stored.map((row) => row['question_id'])).toEqual(['berakna-energi', 'effekt-ar-takt', 'kwh-eller-kw']);
    for (const row of stored) {
      const card = expected[String(row['question_id']) as keyof typeof expected];
      const { cardId: _random, ...kept } = JSON.parse(JSON.stringify(card)) as Record<string, unknown>;
      expect(row['card']).toEqual(kept);
      expect(new Date(String(row['due_at'])).toISOString()).toBe(card.dueAt.toISOString());
    }
    // The figures themselves, so a change in the library's own arithmetic is seen too.
    expect(expected['berakna-energi'].reps).toBe(4);
    expect(expected['effekt-ar-takt'].lapses).toBe(1);
    // Wrong on a new question: back the next day.
    expect((await byHand([{ at: '2026-01-05T08:00:00Z', rating: Rating.Again }])).dueAt.toISOString()).toBe('2026-01-06T08:00:00.000Z');
  });

  it('counts the first answer of a day in the learner’s time zone, so a late answer in New York is another day than in Stockholm', async () => {
    await load(example);
    await write([
      answerAt('berakna-energi', '2026-01-05T20:00:00Z', false, 'lesson-check', 'America/New_York'),
      // 03:00 UTC on the 6th is still the 5th in New York: the same day there, so it does not count.
      answerAt('berakna-energi', '2026-01-06T03:00:00Z', true, 'lesson-check', 'America/New_York'),
    ]);

    await due();

    const [row] = await memory();
    expect(row?.['counted_at']).toBe('2026-01-05T20:00:00+00:00');
    expect(row?.['card']).toMatchObject({ reps: 1 });
  });
});

describe('the memory rebuilt from the record', () => {
  it('equals the memory built live, read by read, as the answers came', async () => {
    await load(example);
    const days = ['2026-02-02', '2026-02-03', '2026-02-05', '2026-02-09', '2026-02-20'];
    for (const [index, day] of days.entries()) {
      await write([
        answerAt('berakna-energi', `${day}T08:00:00Z`, index % 2 === 1),
        answerAt('effekt-ar-takt', `${day}T08:01:00Z`, index !== 2),
        answerAt('kwh-eller-kw', `${day}T08:02:00Z`, index > 0, index === 3 ? 'exam' : 'review'),
        answerAt('kwh-eller-kw', `${day}T08:03:00Z`, true),
      ]);
      // Each read folds only what is new since the last one.
      await due();
    }
    // And one answered the way the browser does, now.
    const posted = await here.app.request(`/api/v1/assessment/subjects/${SUBJECT}/questions/berakna-energi/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: { type: 'numeric', value: 6 }, durationMs: 2000, timeZone: ZONE, setting: 'review' }),
    });
    expect(posted.status).toBe(200);
    await due();
    const live = await memory();
    expect(live).toHaveLength(3);

    await rebuild(here.db, createLearningRecord(here.db), await createScheduler());

    expect(await memory()).toEqual(live);
  });

  it('is replayed from the first row when the scheduler that built it is not the one in use', async () => {
    await load(example);
    await write([answerAt('berakna-energi', '2026-03-02T08:00:00Z', false), answerAt('berakna-energi', '2026-03-04T08:00:00Z', true)]);
    await due();
    const live = await memory();
    // A memory built by some other scheduler, and wrong.
    await here.db.query(`UPDATE review.memory SET card = '{"reps": 99}'::jsonb, due_at = '2030-01-01T00:00:00Z'`);
    await here.db.query(`UPDATE review.replay SET scheduler = 'ts-fsrs@5.4.2 FSRS-6 retention=0.9 short-term=true fuzz=true'`);

    await due();

    expect(await memory()).toEqual(live);
  });
});

describe('what is due', () => {
  it('lists the questions whose day has come, the most overdue first, and counts every question met', async () => {
    await load(example);
    await write([
      answerAt('effekt-ar-takt', daysAgo(5), false),
      answerAt('berakna-energi', daysAgo(2), false),
      // Answered right today: not due for days.
      answerAt('kwh-eller-kw', new Date().toISOString(), true),
    ]);

    const listed = await due();
    expect(listed).toMatchObject({ subjectId: SUBJECT, questions: ['effekt-ar-takt', 'berakna-energi'], scheduled: 3 });
    // The one answered right today is the next to fall due, on a later day.
    expect(listed.next?.questions).toBe(1);
    expect(listed.next?.day.localeCompare(new Date().toISOString().slice(0, 10))).toBe(1);
  });

  it('says how long the learner typically takes over one question: the median of their answers outside exams', async () => {
    await load(example);
    await write([
      timed(answerAt('berakna-energi', daysAgo(5), false), 2000),
      timed(answerAt('effekt-ar-takt', daysAgo(5, 10), false), 9000),
      timed(answerAt('kwh-eller-kw', daysAgo(4), true, 'review'), 4000),
      // An exam question's time is spread over visits, so it says nothing of one answer.
      timed(answerAt('kwh-eller-kw', daysAgo(3), true, 'exam'), 600_000),
    ]);

    expect((await due()).typicalAnswerMs).toBe(4000);
  });

  it('names the next day more questions fall due, and how many', async () => {
    await load(example);
    const now = new Date().toISOString();
    // Wrong today: back tomorrow. Right today on a numeric question: back days later, which is not the next day.
    await write([
      answerAt('berakna-energi', now, true, 'lesson-check', 'UTC'),
      answerAt('effekt-ar-takt', now, false, 'lesson-check', 'UTC'),
      answerAt('kwh-eller-kw', now, false, 'lesson-check', 'UTC'),
    ]);

    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    expect((await due('?timeZone=UTC')).next).toEqual({ day: tomorrow, questions: 2 });
    const [later] = await here.db.query(`SELECT to_json(due_at) #>> '{}' AS due_at FROM review.memory WHERE question_id = 'berakna-energi'`);
    expect(String(later?.['due_at']).slice(0, 10) > tomorrow).toBe(true);
  });

  it('lists a question that falls due today, at any hour of it', async () => {
    await load(example);
    // Wrong yesterday at 23:00 UTC: due today at 23:00 UTC, which counts as today from the first hour of the day.
    await write([answerAt('berakna-energi', daysAgo(1, 23), false, 'lesson-check', 'UTC')]);

    expect((await due('?timeZone=UTC')).questions).toEqual(['berakna-energi']);
  });

  it('counts what is due in every subject that has a question scheduled', async () => {
    await load(example);
    await write([answerAt('effekt-ar-takt', daysAgo(5), false), answerAt('kwh-eller-kw', new Date().toISOString(), true)]);

    const response = await here.app.request(`${REVIEW}/due?timeZone=${ZONE}`);

    expect(response.status).toBe(200);
    expect(DueCountsSchema.parse(await response.json())).toEqual({ subjects: { [SUBJECT]: { due: 1, typicalAnswerMs: 3000 } } });
  });

  it('leaves out a question the subject no longer holds', async () => {
    await load(example);
    await write([answerAt('effekt-ar-takt', daysAgo(5), false), answerAt('berakna-energi', daysAgo(5, 10), false)]);
    const without = new Map(example);
    for (const file of QUESTIONS_FILES) {
      const text = decode(example.get(file));
      const at = text.indexOf('- id: effekt-ar-takt');
      expect(at).toBeGreaterThan(0);
      without.set(file, encode(text.slice(0, at)));
    }
    await load(without);

    expect(await due()).toMatchObject({ subjectId: SUBJECT, questions: ['berakna-energi'], scheduled: 1 });
  });

  it('is nothing in a subject where nothing has been answered', async () => {
    await load(example);

    expect(await due()).toEqual({ subjectId: SUBJECT, questions: [], scheduled: 0, next: null, typicalAnswerMs: null });
    expect(DueCountsSchema.parse(await (await here.app.request(`${REVIEW}/due`)).json())).toEqual({ subjects: {} });
  });

  it('refuses a time zone that is not one, and answers “no such subject” for one that does not exist', async () => {
    await load(example);

    expect((await here.app.request(`${REVIEW}/subjects/${SUBJECT}/due?timeZone=Mars/Olympus`)).status).toBe(400);
    expect((await here.app.request(`${REVIEW}/due?timeZone=Mars/Olympus`)).status).toBe(400);
    expect((await here.app.request(`${REVIEW}/subjects/no-such-subject/due`)).status).toBe(404);
  });
});

describe('the learning record’s order', () => {
  it('makes an append wait for one still open, so rows become visible in the order they are numbered', async () => {
    await load(example);
    const record = createLearningRecord(here.db);
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    const events: string[] = [];

    const first = here.db.transaction(async (tx) => {
      await record.append([answerAt('berakna-energi', '2026-04-01T08:00:00Z', true)], tx);
      events.push('first appended');
      await held;
      events.push('first committing');
    });
    await expect.poll(() => events).toEqual(['first appended']);
    const second = record.append([answerAt('kwh-eller-kw', '2026-04-01T08:01:00Z', true)]).then(() => events.push('second appended'));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(events).toEqual(['first appended']);
    release();
    await Promise.all([first, second]);

    expect(events).toEqual(['first appended', 'first committing', 'second appended']);
    const rows = await here.db.query(`SELECT item_id FROM record.event ORDER BY seq`);
    expect(rows.map((row) => row['item_id'])).toEqual(['berakna-energi', 'kwh-eller-kw']);
  });
});
