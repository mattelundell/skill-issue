import { join } from 'node:path';
import { DueSchema, SubjectProgressSchema, type GivenAnswer, type QuestionType, type SubjectProgress } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLearningRecord, type RecordEvent } from '../../src/core/record/record.js';
import { install, type Installation } from './installation.js';

/**
 * Progress through the running application: a history written into the
 * learning record, the subject as the catalogue holds it, and the figures the
 * progress endpoint gives, against figures worked by hand from FSRS-6's
 * published default weights (see the module's own tests for the working).
 */

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const SUBJECT = 'example-subject';
const ZONE = 'Europe/Stockholm';

const HARD = 1.2931;
const GOOD = 2.3065;
const AGAIN = 0.212;
const DECAY = 0.1542;
const FACTOR = 0.9 ** (-1 / DECAY) - 1;
const recall = (days: number, stability: number): number => (1 + (FACTOR * days) / stability) ** -DECAY;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

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

const DAY = 86_400_000;
const ago = (days: number): Date => new Date(Date.now() - days * DAY);

function answer(questionId: string, at: Date, correct: boolean): RecordEvent {
  const question = QUESTIONS[questionId];
  if (question === undefined) {
    throw new Error(`no such question in these tests: ${questionId}`);
  }
  return {
    kind: 'answer',
    at,
    timeZone: ZONE,
    question: { subjectId: SUBJECT, id: questionId, language: 'sv', revision: 1 },
    setting: 'lesson-check',
    concepts: question.concepts,
    sources: ['exempelkalla'],
    questionType: question.type,
    options: question.options,
    given: correct ? question.right : question.wrong,
    correct,
    score: correct ? 1 : 0,
    durationMs: 3000,
  };
}

function exam(lessonId: string, at: Date, passed: boolean): RecordEvent {
  return {
    kind: 'exam',
    at,
    timeZone: ZONE,
    scope: 'lesson',
    item: { subjectId: SUBJECT, id: lessonId, language: 'sv', revision: 1 },
    sittingId: passed ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002',
    durationMs: 60_000,
    result: { correct: passed ? 2 : 0, total: 2, passMark: 0.5, passed },
  };
}

const write = async (events: readonly RecordEvent[]): Promise<void> => createLearningRecord(here.db).append(events);

async function progress(query = `?timeZone=${ZONE}`): Promise<SubjectProgress> {
  const response = await here.app.request(`/api/v1/progress/subjects/${SUBJECT}${query}`);
  expect(response.status).toBe(200);
  return SubjectProgressSchema.parse(await response.json());
}

describe("a subject's progress", () => {
  it('gives each lesson and area the mean expected recall of its questions from the record, and which lessons are passed and mastered', async () => {
    await load(example);
    await write([
      exam('enhetsprefix', ago(4), false),
      answer('kwh-eller-kw', ago(3), false),
      answer('berakna-energi', ago(2), true),
      answer('effekt-ar-takt', ago(1), true),
      exam('energi-och-effekt', ago(1), true),
    ]);

    const shown = await progress();

    // The request comes a moment after the history was written, so the figures are a hair lower than at exactly 1, 2 and 3 days.
    const lesson = (recall(3, AGAIN) + recall(2, GOOD) + recall(1, HARD)) / 3;
    expect(shown.areas.map(({ areaId, questions, met, lessons }) => ({ areaId, questions, met, lessons: lessons.map(({ lessonId, questions: q, met: m, passed, mastered }) => ({ lessonId, q, m, passed, mastered })) }))).toEqual([
      {
        areaId: 'grunder',
        questions: 6,
        met: 3,
        lessons: [
          { lessonId: 'energi-och-effekt', q: 3, m: 3, passed: true, mastered: false },
          // An exam sat and failed passes nothing.
          { lessonId: 'enhetsprefix', q: 3, m: 0, passed: false, mastered: false },
        ],
      },
      { areaId: 'fordjupning', questions: 2, met: 0, lessons: [{ lessonId: 'energibalans', q: 2, m: 0, passed: false, mastered: false }] },
    ]);
    expect(shown.areas[0]?.lessons[0]?.recall).toBeCloseTo(lesson, 4);
    expect(shown.areas[0]?.recall).toBeCloseTo(lesson / 2, 4);
    expect(shown.recall).toBeCloseTo((lesson * 3) / 8, 4);
    expect(shown.days.slice(-4).map(({ answers, correct }) => ({ answers, correct }))).toEqual([
      { answers: 1, correct: 0 },
      { answers: 1, correct: 1 },
      { answers: 1, correct: 1 },
      { answers: 0, correct: 0 },
    ]);
    expect(shown.weakSpots).toEqual([{ concept: 'effekt', wrong: 1, answers: 3, lessonId: 'energi-och-effekt' }]);
  });

  it('calls a lesson mastered just after its questions are answered right and its exam passed', async () => {
    await load(example);
    await write([
      answer('kwh-eller-kw', ago(0.1), true),
      answer('berakna-energi', ago(0.1), true),
      answer('effekt-ar-takt', ago(0.1), true),
      exam('energi-och-effekt', ago(0.1), true),
    ]);

    expect((await progress()).areas[0]?.lessons[0]).toMatchObject({ lessonId: 'energi-och-effekt', passed: true, mastered: true });
  });

  it('reads the memory review schedules from: of two questions answered right two days ago, the one review calls due is below the target and the other at or above it', async () => {
    await load(example);
    // Answered right two days ago: a "good" memory lasts 2.3 days, so it is not yet due; a "hard" one lasts 1.3, so it is.
    await write([answer('berakna-energi', ago(2), true), answer('effekt-ar-takt', ago(2), true)]);

    const dueResponse = await here.app.request(`/api/v1/review/subjects/${SUBJECT}/due?timeZone=UTC`);
    const due = DueSchema.parse(await dueResponse.json());
    expect(due.questions).toEqual(['effekt-ar-takt']);
    // Each lesson question alone, from the lesson's mean over three with one never answered.
    const lesson = (await progress('?timeZone=UTC')).areas[0]?.lessons[0]?.recall ?? 0;
    expect(lesson * 3).toBeCloseTo(recall(2, GOOD) + recall(2, HARD), 4);
    expect(recall(2, GOOD)).toBeGreaterThanOrEqual(0.9);
    expect(recall(2, HARD)).toBeLessThan(0.9);
  });

  it('leaves out of the figures a lesson the subject no longer holds', async () => {
    await load(example);
    await write([answer('berakna-energi', ago(1), true)]);
    const subject = decode(example.get('areas/fordjupning/area.yaml'));
    expect(subject).toContain('lessons:\n  - energibalans\n');

    // The second area loses its only lesson, and with it the area itself is dropped from the subject.
    const without = new Map(example);
    without.set('subject.yaml', encode(decode(example.get('subject.yaml')).replace('  - fordjupning\n', '')));
    without.set('subject.en.yaml', encode(decode(example.get('subject.en.yaml')).replace('  - fordjupning\n', '')));
    for (const file of [...without.keys()].filter((name) => name.startsWith('areas/fordjupning/'))) {
      without.delete(file);
    }
    await load(without);

    const shown = await progress();
    expect(shown.areas.map((area) => area.areaId)).toEqual(['grunder']);
    expect(shown.questions).toBe(6);
  });

  it('answers 404 for a subject that does not exist, and 400 for a time zone that is not one', async () => {
    await load(example);

    expect((await here.app.request('/api/v1/progress/subjects/no-such-subject')).status).toBe(404);
    expect((await here.app.request('/api/v1/progress/subjects/Not%20an%20id')).status).toBe(404);
    const bad = await here.app.request(`/api/v1/progress/subjects/${SUBJECT}?timeZone=Mars/Olympus`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ status: 400, title: 'timeZone must be a time zone name such as Europe/Stockholm' });
  });
});
