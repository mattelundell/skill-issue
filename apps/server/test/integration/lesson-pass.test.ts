import { join } from 'node:path';
import { EarlierAnswersSchema, LessonViewSchema, type GivenAnswer } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

/**
 * A pass through a lesson, read back from the learning record: the checks
 * already answered in it, and the questions it must ask again before it ends.
 * Leaving the lesson and coming back loses neither, because neither lives in
 * the page.
 */

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const SUBJECT = 'example-subject';
const LESSON = `/api/v1/lessons/subjects/${SUBJECT}/lessons/energi-och-effekt`;
const ASSESSMENT = `/api/v1/assessment/subjects/${SUBJECT}`;
const QUESTIONS_FILE = 'areas/grunder/lessons/energi-och-effekt/questions.yaml';
const ZONE = 'Europe/Stockholm';
/** The lesson's one check step asks these two, in this order. */
const CHECK = ['kwh-eller-kw', 'berakna-energi'] as const;
const STEPS = 3;

const RIGHT_KWH: GivenAnswer = { type: 'single-choice', option: 'b' };
const WRONG_KWH: GivenAnswer = { type: 'single-choice', option: 'a' };
const RIGHT_ENERGY: GivenAnswer = { type: 'numeric', value: 6 };

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

async function send(method: string, path: string, body: unknown): Promise<number> {
  const response = await here.app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return response.status;
}

const answer = async (questionId: string, given: GivenAnswer, setting?: 'lesson-check' | 'review') =>
  expect(await send('POST', `${ASSESSMENT}/questions/${questionId}/answers`, { answer: given, durationMs: 3000, timeZone: ZONE, ...(setting === undefined ? {} : { setting }) })).toBe(200);

const move = async (step: number, revision = 1) => expect(await send('PUT', `${LESSON}/position`, { step, revision, timeZone: ZONE })).toBe(200);

const checks = async () => {
  const response = await here.app.request(LESSON);
  expect(response.status).toBe(200);
  return LessonViewSchema.parse(await response.json()).checks;
};

const earlier = async (after: number, ids: readonly string[] = CHECK) => {
  const response = await here.app.request(`${ASSESSMENT}/answers?ids=${ids.join(',')}&after=${String(after)}`);
  expect(response.status).toBe(200);
  return EarlierAnswersSchema.parse(await response.json()).answers;
};

describe('the pass through a lesson', () => {
  it('starts with nothing answered and nothing to ask again', async () => {
    await load(example);

    expect(await checks()).toEqual({ answeredAfter: 0, again: [] });
    expect(await earlier(0)).toEqual([]);
  });

  it('asks again a check answered wrong, after the lesson is left and opened afresh', async () => {
    await load(example);
    await move(2);
    await answer('kwh-eller-kw', WRONG_KWH);
    await answer('berakna-energi', RIGHT_ENERGY);

    // Nothing of the page survives a reload; the view is read from the server alone.
    expect(await checks()).toEqual({ answeredAfter: 0, again: ['kwh-eller-kw'] });
  });

  it('stops asking again a question once it is answered right later in the pass', async () => {
    await load(example);
    await answer('kwh-eller-kw', WRONG_KWH);
    await answer('kwh-eller-kw', RIGHT_KWH);

    expect((await checks()).again).toEqual([]);
  });

  it('asks again in the order the lesson asks, each question once', async () => {
    await load(example);
    await answer('berakna-energi', { type: 'numeric', value: 60 });
    await answer('kwh-eller-kw', WRONG_KWH);
    await answer('kwh-eller-kw', WRONG_KWH);

    expect((await checks()).again).toEqual(['kwh-eller-kw', 'berakna-energi']);
  });

  it('begins a new pass after the lesson is gone through to its end, leaving the last pass behind', async () => {
    await load(example);
    await answer('kwh-eller-kw', WRONG_KWH);
    await move(STEPS);

    const pass = await checks();
    const [finished] = await here.db.query(`SELECT seq FROM record.event WHERE kind = 'lesson-finished'`);
    expect(pass).toEqual({ answeredAfter: Number(finished?.['seq']), again: [] });
    expect(pass.answeredAfter).toBeGreaterThan(0);
    expect(await earlier(pass.answeredAfter)).toEqual([]);
  });

  it('does not count a review answer as one given in the lesson', async () => {
    await load(example);
    await answer('kwh-eller-kw', WRONG_KWH, 'review');

    expect((await checks()).again).toEqual([]);
    expect(await earlier(0)).toEqual([]);
  });
});

describe('a check step taken up again', () => {
  it('shows each question’s latest answer in the pass, graded as it was, in the order asked for', async () => {
    await load(example);
    await answer('berakna-energi', RIGHT_ENERGY);
    await answer('kwh-eller-kw', RIGHT_KWH);
    await answer('kwh-eller-kw', WRONG_KWH);

    const answers = await earlier(0);

    expect(answers.map(({ given, graded }) => ({ id: graded.questionId, given, correct: graded.correct, expected: graded.expected }))).toEqual([
      { id: 'kwh-eller-kw', given: WRONG_KWH, correct: false, expected: RIGHT_KWH },
      { id: 'berakna-energi', given: RIGHT_ENERGY, correct: true, expected: { type: 'numeric', value: 6, unit: 'kWh', tolerance: 0 } },
    ]);
    expect(answers[0]?.graded.explanation.length).toBeGreaterThan(0);
  });

  it('leaves out a question not answered since the pass began', async () => {
    await load(example);
    await answer('kwh-eller-kw', WRONG_KWH);
    await move(STEPS);
    await answer('berakna-energi', RIGHT_ENERGY);

    const answers = await earlier((await checks()).answeredAfter);

    expect(answers.map(({ graded }) => graded.questionId)).toEqual(['berakna-energi']);
  });

  it('asks afresh a question changed since it was answered', async () => {
    await load(example);
    await answer('kwh-eller-kw', WRONG_KWH);
    await answer('berakna-energi', RIGHT_ENERGY);
    const changed = decode(example.get(QUESTIONS_FILE)).replace('Vilken enhet anger effekt?', 'Vilken enhet mäter effekt?');
    expect(changed).not.toBe(decode(example.get(QUESTIONS_FILE)));
    await load(new Map(example).set(QUESTIONS_FILE, encode(changed)));

    expect((await earlier(0)).map(({ graded }) => graded.questionId)).toEqual(['berakna-energi']);
    // Wrong is still wrong: the lesson asks it again in its new wording.
    expect((await checks()).again).toEqual(['kwh-eller-kw']);
  });

  it('refuses an `after` that is not a row number', async () => {
    await load(example);

    expect((await here.app.request(`${ASSESSMENT}/answers?ids=kwh-eller-kw&after=yesterday`)).status).toBe(400);
  });
});
