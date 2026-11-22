import { join } from 'node:path';
import { DueSchema, LessonViewSchema, SubjectProgressSchema } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

/**
 * One subject read in two languages. What the learner did attaches to an
 * item's id, not to the language it was shown in, so switching language keeps
 * where they were and what they remember; and a translation that would grade
 * differently from its original is refused when the subject is loaded.
 */

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const SUBJECT = 'example-subject';
const LESSON = `/api/v1/lessons/subjects/${SUBJECT}/lessons/energi-och-effekt`;
const QUESTIONS_EN = 'areas/grunder/lessons/energi-och-effekt/questions.en.yaml';

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

let here: Installation;

beforeEach(async () => {
  here = await install();
});

afterEach(async () => {
  await here.drop();
});

const send = async (files: PackFiles) =>
  here.app.request('/api/v1/content/packs', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: new Uint8Array(writeZip(files, SUBJECT)).buffer });

async function load(files: PackFiles): Promise<void> {
  const response = await send(files);
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`pack refused: ${response.status} ${await response.text()}`);
  }
}

const json = async (path: string): Promise<unknown> => {
  const response = await here.app.request(path);
  expect(response.status).toBe(200);
  return response.json();
};

describe('switching the language a subject is read in', () => {
  it('opens a lesson left in English at the same step in Swedish', async () => {
    await load(example);
    const english = LessonViewSchema.parse(await json(`${LESSON}?language=en`));
    expect(english.lesson.language).toBe('en');

    const saved = await here.app.request(`${LESSON}/position`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 2, revision: english.lesson.revision, timeZone: 'Europe/Stockholm' }),
    });
    expect(saved.status).toBe(200);

    const swedish = LessonViewSchema.parse(await json(`${LESSON}?language=sv`));
    expect({ language: swedish.lesson.language, resumeAt: swedish.resumeAt, step: swedish.lesson.steps[swedish.resumeAt]?.type }).toEqual({ language: 'sv', resumeAt: 2, step: 'check' });
  });

  it('keeps what an answer given in English did to the schedule and the share remembered, read in Swedish', async () => {
    await load(example);

    const answered = await here.app.request(`/api/v1/assessment/subjects/${SUBJECT}/questions/berakna-energi/answers?language=en`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: { type: 'numeric', value: 6 }, durationMs: 4000, timeZone: 'Europe/Stockholm' }),
    });
    expect(answered.status).toBe(200);

    // The question is scheduled once, whichever language it was answered in.
    const due = DueSchema.parse(await json(`/api/v1/review/subjects/${SUBJECT}/due?timeZone=Europe/Stockholm`));
    expect(due.scheduled).toBe(1);
    const progress = SubjectProgressSchema.parse(await json(`/api/v1/progress/subjects/${SUBJECT}?timeZone=Europe/Stockholm`));
    expect(progress.areas[0]?.lessons[0]).toMatchObject({ lessonId: 'energi-och-effekt', met: 1 });
    // A check taken up again shows an answer only under the words it was given to: in English it is shown, in Swedish the question is asked afresh.
    const earlier = async (language: string) =>
      ((await json(`/api/v1/assessment/subjects/${SUBJECT}/answers?ids=berakna-energi&after=0&language=${language}`)) as { answers: { given: unknown }[] }).answers.map(({ given }) => given);
    expect(await earlier('en')).toEqual([{ type: 'numeric', value: 6 }]);
    expect(await earlier('sv')).toEqual([]);
  });
});

describe('a translation that would grade differently', () => {
  it('is refused with the field that differs, and the subject as it stood is kept', async () => {
    await load(example);
    const files = new Map(example).set(QUESTIONS_EN, encode(decode(example.get(QUESTIONS_EN)).replace('answer: b', 'answer: a')));

    const response = await send(files);

    expect(response.status).toBe(422);
    expect(((await response.json()) as { faults: unknown[] }).faults).toEqual([
      { code: 'translation-mismatch', file: QUESTIONS_EN, item: 'question kwh-eller-kw', field: 'answer', expected: 'the same as in the default language: "b"', found: '"a"' },
    ]);
    // The English question still grades as the Swedish one does.
    const graded = await here.app.request(`/api/v1/assessment/subjects/${SUBJECT}/questions/kwh-eller-kw/answers?language=en`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: { type: 'single-choice', option: 'b' }, durationMs: 4000, timeZone: 'Europe/Stockholm' }),
    });
    expect(((await graded.json()) as { correct: boolean }).correct).toBe(true);
  });
});
