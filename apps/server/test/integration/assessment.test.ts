import { join } from 'node:path';
import { AskedQuestionsSchema, ExamResultSchema, GradedSchema, PassedSchema, SittingSchema, type GivenAnswer, type Sitting } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const BASE = '/api/v1/assessment/subjects/example-subject';

/** The right answer to every question in the example subject. */
const RIGHT: Readonly<Record<string, GivenAnswer>> = {
  'kwh-eller-kw': { type: 'single-choice', option: 'b' },
  'berakna-energi': { type: 'numeric', value: 6 },
  'effekt-ar-takt': { type: 'true-false', value: true },
  'prefix-ordning': { type: 'ordering', items: ['kWh', 'MWh', 'GWh'] },
  'prefix-par': { type: 'matching', pairs: [{ left: 'kilo', right: 'tusen' }, { left: 'mega', right: 'miljon' }, { left: 'giga', right: 'miljard' }] },
  'kilo-betyder': { type: 'short-text', text: 'k' },
  'vagar-ut': { type: 'multiple-choice', options: ['a', 'b'] },
  'forklara-balans': { type: 'free-recall', knew: true },
};

/** A wrong answer to every question, of the right type. */
const WRONG: Readonly<Record<string, GivenAnswer>> = {
  'kwh-eller-kw': { type: 'single-choice', option: 'a' },
  'berakna-energi': { type: 'numeric', value: 5 },
  'effekt-ar-takt': { type: 'true-false', value: false },
  'prefix-ordning': { type: 'ordering', items: ['MWh', 'kWh', 'GWh'] },
  'prefix-par': { type: 'matching', pairs: [{ left: 'kilo', right: 'miljon' }, { left: 'mega', right: 'tusen' }, { left: 'giga', right: 'miljard' }] },
  'kilo-betyder': { type: 'short-text', text: 'M' },
  'vagar-ut': { type: 'multiple-choice', options: ['a', 'c'] },
  'forklara-balans': { type: 'free-recall', knew: false },
};

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
    body: new Uint8Array(writeZip(files, 'example-subject')).buffer,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`pack refused: ${response.status} ${await response.text()}`);
  }
}

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await here.app.request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json() };
}

const answer = async (questionId: string, given: GivenAnswer) => post(`/questions/${questionId}/answers`, { answer: given, durationMs: 1000, timeZone: 'Europe/Stockholm' });

async function sit(kind: 'lesson' | 'area', id: string): Promise<Sitting> {
  const started = await post('/exams', { scope: { kind, id } });
  expect(started.status).toBe(201);
  return SittingSchema.parse(started.json);
}

const handIn = async (sitting: Sitting, answers: Readonly<Record<string, GivenAnswer>>) =>
  post(`/exams/${sitting.id}`, { answers: sitting.questions.map((question) => ({ questionId: question.id, answer: answers[question.id], durationMs: 1000 })), timeZone: 'Europe/Stockholm' });

/** Options by id, so a comparison does not depend on the order they were asked in. */
const byId = (options: readonly { id: string; text: string }[]) => options.toSorted((a, b) => a.id.localeCompare(b.id));

describe('asking', () => {
  it('gives a check’s questions in order, without their answers', async () => {
    await load(example);

    const response = await here.app.request(`${BASE}/questions?ids=kwh-eller-kw,berakna-energi,finns-inte`);
    const { questions } = AskedQuestionsSchema.parse(await response.json());

    const [choice, numeric] = questions;
    expect(choice?.type === 'single-choice' ? { ...choice, options: byId(choice.options) } : choice).toEqual({
      id: 'kwh-eller-kw',
      language: 'sv',
      prompt: 'Vilken enhet anger effekt?',
      type: 'single-choice',
      options: [{ id: 'a', text: 'kWh' }, { id: 'b', text: 'kW' }, { id: 'c', text: 'kWh/m²' }],
    });
    expect(numeric).toEqual({ id: 'berakna-energi', language: 'sv', prompt: 'En motor på 2 kW går i 3 timmar. Hur mycket energi använder den?', type: 'numeric', unit: 'kWh' });
    expect(questions).toHaveLength(2);
  });

  it('asks a choice question’s options in a new order, so the written order does not give the answer away', async () => {
    await load(example);

    const orders = new Set<string>();
    for (let ask = 0; ask < 20; ask += 1) {
      const response = await here.app.request(`${BASE}/questions?ids=kwh-eller-kw`);
      const [question] = AskedQuestionsSchema.parse(await response.json()).questions;
      orders.add(question?.type === 'single-choice' ? question.options.map((option) => option.id).join('') : 'not a choice');
    }

    // Three options give six orders; twenty asks all landing on one of them by chance is 6⁻¹⁹.
    expect(orders.has('not a choice')).toBe(false);
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('grading one answer', () => {
  it.each(Object.keys(RIGHT))('grades %s right and wrong, with the right answer, why, and its source', async (questionId) => {
    await load(example);

    const right = await answer(questionId, RIGHT[questionId] as GivenAnswer);
    const wrong = await answer(questionId, WRONG[questionId] as GivenAnswer);

    expect([right.status, wrong.status]).toEqual([200, 200]);
    const [rightGraded, wrongGraded] = [GradedSchema.parse(right.json), GradedSchema.parse(wrong.json)];
    expect([rightGraded.correct, wrongGraded.correct]).toEqual([true, false]);
    expect(wrongGraded.expected.type).toBe((RIGHT[questionId] as GivenAnswer).type);
    expect(wrongGraded.explanation.length).toBeGreaterThan(0);
    expect(wrongGraded.sources).toEqual([{ id: 'exempelkalla', title: 'Exempelkälla om energi och effekt', publisher: 'Exempelförlaget' }]);
  });

  it('shows the right answer of a wrong one', async () => {
    await load(example);

    expect(GradedSchema.parse((await answer('berakna-energi', { type: 'numeric', value: 5 })).json)).toMatchObject({
      correct: false,
      expected: { type: 'numeric', value: 6, unit: 'kWh', tolerance: 0 },
      explanation: 'Energi = effekt × tid = 2 kW × 3 h = 6 kWh.',
    });
  });

  it('refuses an answer of another type, a body that is not an answer, and a question the subject does not hold', async () => {
    await load(example);

    expect(await answer('kwh-eller-kw', { type: 'true-false', value: true })).toMatchObject({ status: 400, json: { title: 'The answer is of another type' } });
    expect(await post('/questions/kwh-eller-kw/answers', { answer: 'b' })).toMatchObject({ status: 400, json: { title: 'The body is not an answer' } });
    expect(await answer('finns-inte', { type: 'true-false', value: true })).toMatchObject({ status: 404, json: { title: 'No such question' } });
  });
});

describe('exams', () => {
  it('draws a lesson exam from that lesson’s bank, as many as its blueprint says, without answers', async () => {
    await load(example);

    const sitting = await sit('lesson', 'energi-och-effekt');

    expect(sitting).toMatchObject({ subjectId: 'example-subject', scope: { kind: 'lesson', id: 'energi-och-effekt' }, title: 'Energi och effekt', passMark: 0.5 });
    expect(sitting.questions).toHaveLength(2);
    expect(sitting.questions.every((question) => ['kwh-eller-kw', 'berakna-energi', 'effekt-ar-takt'].includes(question.id))).toBe(true);
    expect(JSON.stringify(sitting)).not.toMatch(/"answer"|"accepted"/);
  });

  it('draws an area exam across the banks of the area’s lessons, and each sitting afresh', async () => {
    await load(example);

    const draws = new Set<string>();
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const sitting = await sit('area', 'grunder');
      expect(sitting.questions).toHaveLength(4);
      draws.add(sitting.questions.map((question) => question.id).toSorted().join(','));
      for (const question of sitting.questions) {
        seen.add(question.id);
      }
    }

    // Four of six, ten times: the same four every time would mean the draw is not a draw (odds about one in 10¹¹).
    expect(draws.size).toBeGreaterThan(1);
    expect([...seen].toSorted()).toEqual(['berakna-energi', 'effekt-ar-takt', 'kilo-betyder', 'kwh-eller-kw', 'prefix-ordning', 'prefix-par']);
  });

  it('passes a sitting answered right, reviews every answer, and counts the lesson as passed', async () => {
    await load(example);
    const sitting = await sit('lesson', 'energi-och-effekt');

    const handed = await handIn(sitting, RIGHT);
    const result = ExamResultSchema.parse(handed.json);

    expect(handed.status).toBe(200);
    expect(result).toMatchObject({ sittingId: sitting.id, correct: 2, total: 2, passMark: 0.5, passed: true });
    expect(result.review.map((entry) => [entry.questionId, entry.correct, entry.given])).toEqual(sitting.questions.map((question) => [question.id, true, RIGHT[question.id]]));
    expect(PassedSchema.parse(await (await here.app.request(`${BASE}/passed`)).json())).toEqual({ subjectId: 'example-subject', lessons: ['energi-och-effekt'], areas: [] });
  });

  it('fails a sitting below the pass mark, counting an unanswered question as wrong, and passes nothing', async () => {
    await load(example);
    const sitting = await sit('area', 'grunder');
    const [first, second] = sitting.questions;
    const answers = { [first?.id ?? '']: RIGHT[first?.id ?? ''] as GivenAnswer, [second?.id ?? '']: RIGHT[second?.id ?? ''] as GivenAnswer };

    const result = ExamResultSchema.parse((await post(`/exams/${sitting.id}`, { answers: Object.entries(answers).map(([questionId, given]) => ({ questionId, answer: given, durationMs: 1000 })), timeZone: 'Europe/Stockholm' })).json);

    expect(result).toMatchObject({ correct: 2, total: 4, passMark: 0.75, passed: false });
    expect(result.review.filter((entry) => entry.given === null).map((entry) => entry.correct)).toEqual([false, false]);
    expect(PassedSchema.parse(await (await here.app.request(`${BASE}/passed`)).json())).toEqual({ subjectId: 'example-subject', lessons: [], areas: [] });
  });

  it('passes at exactly the pass mark', async () => {
    await load(example);
    const sitting = await sit('lesson', 'energi-och-effekt');
    const [first, second] = sitting.questions;

    const result = ExamResultSchema.parse((await handIn(sitting, { [first?.id ?? '']: RIGHT[first?.id ?? ''] as GivenAnswer, [second?.id ?? '']: WRONG[second?.id ?? ''] as GivenAnswer })).json);

    expect(result).toMatchObject({ correct: 1, total: 2, passed: true });
  });

  it('takes a sitting in once, and refuses an answer to a question it did not ask', async () => {
    await load(example);
    const sitting = await sit('lesson', 'energi-och-effekt');
    const notAsked = ['kwh-eller-kw', 'berakna-energi', 'effekt-ar-takt'].find((id) => !sitting.questions.some((question) => question.id === id)) ?? '';

    expect(await post(`/exams/${sitting.id}`, { answers: [{ questionId: notAsked, answer: RIGHT[notAsked], durationMs: 1000 }], timeZone: 'Europe/Stockholm' })).toMatchObject({ status: 400, json: { title: 'An answer to a question not asked' } });
    expect((await handIn(sitting, RIGHT)).status).toBe(200);
    expect(await handIn(sitting, RIGHT)).toMatchObject({ status: 409, json: { title: 'The sitting has been handed in' } });
  });

  it('grades a sitting against its questions as drawn, even when the subject is reloaded changed before it is handed in', async () => {
    await load(example);
    // The question whose answer changes must be among the two drawn of three.
    let sitting = await sit('lesson', 'enhetsprefix');
    for (let attempt = 0; attempt < 40 && !sitting.questions.some((question) => question.id === 'kilo-betyder'); attempt += 1) {
      sitting = await sit('lesson', 'enhetsprefix');
    }
    expect(sitting.questions.map((question) => question.id)).toContain('kilo-betyder');
    const questions = 'areas/grunder/lessons/enhetsprefix/questions.yaml';
    await load(new Map(example).set(questions, encode(decode(example.get(questions)).replace('accepted: [k]', 'accepted: [K-prefixet]'))));

    const result = ExamResultSchema.parse((await handIn(sitting, RIGHT)).json);

    expect(result).toMatchObject({ correct: 2, passed: true });
  });

  it('answers an exam on a lesson or area that does not exist with 404', async () => {
    await load(example);

    expect(await post('/exams', { scope: { kind: 'lesson', id: 'finns-inte' } })).toMatchObject({ status: 404, json: { title: 'No such lesson' } });
    expect(await post('/exams', { scope: { kind: 'area', id: 'finns-inte' } })).toMatchObject({ status: 404, json: { title: 'No such area' } });
  });
});
