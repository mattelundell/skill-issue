import type { QuestionType } from '@skill-issue/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LessonBank } from '../../core/catalogue/catalogue.js';
import { createScheduler, type Scheduler } from '../../core/memory/memory.js';
import type { RecordedAnswer } from '../../core/record/record.js';
import { DAYS, endOfDay, progressOf } from './progress.js';

/**
 * Progress on a scripted history, against figures worked by hand from FSRS-6's
 * published default weights rather than from the library: a first answer
 * leaves a memory as stable as the weight for its rating — w0 = 0.212 days for
 * "again", w1 = 1.2931 for "hard", w2 = 2.3065 for "good" — and the chance of
 * recall t days later is (1 + F·t/S)^(−C), with C = w20 = 0.1542 and
 * F = 0.9^(−1/C) − 1, so that it is 0.9 when t = S. The library rounds a
 * chance to eight decimals, so figures are compared to seven.
 */

const AGAIN = 0.212;
const HARD = 1.2931;
const GOOD = 2.3065;
const DECAY = 0.1542;
const FACTOR = 0.9 ** (-1 / DECAY) - 1;
const recall = (days: number, stability: number): number => (1 + (FACTOR * days) / stability) ** -DECAY;

const DAY = 86_400_000;
const NOW = new Date('2026-11-22T12:00:00Z');
const ago = (days: number): Date => new Date(NOW.getTime() - days * DAY);

const BANKS: readonly LessonBank[] = [
  { areaId: 'grunder', lessonId: 'energi-och-effekt', concepts: ['energi', 'effekt'], questions: ['kwh-eller-kw', 'berakna-energi', 'effekt-ar-takt'] },
  { areaId: 'grunder', lessonId: 'enhetsprefix', concepts: ['si-prefix'], questions: ['prefix-ordning', 'prefix-par', 'kilo-betyder'] },
  { areaId: 'fordjupning', lessonId: 'energibalans', concepts: ['energibalans', 'forluster'], questions: ['vagar-ut', 'forklara-balans'] },
];

/** Each question used here: its type, how many options a guess picks from, and what it tests. */
const QUESTIONS: Readonly<Record<string, { type: QuestionType; options: number | undefined; concepts: string[] }>> = {
  // A single choice among three: a right answer is a guess one time in three, so it rates "hard".
  'kwh-eller-kw': { type: 'single-choice', options: 3, concepts: ['effekt'] },
  'berakna-energi': { type: 'numeric', options: undefined, concepts: ['energi', 'effekt'] },
  'effekt-ar-takt': { type: 'true-false', options: 2, concepts: ['effekt'] },
  'prefix-ordning': { type: 'ordering', options: 3, concepts: ['si-prefix'] },
};

let seq = 0;
function answer(questionId: string, at: Date, correct: boolean, timeZone = 'UTC'): RecordedAnswer {
  const question = QUESTIONS[questionId];
  if (question === undefined) {
    throw new Error(`no such question in these tests: ${questionId}`);
  }
  seq += 1;
  return {
    seq,
    at,
    timeZone,
    question: { subjectId: 'example-subject', id: questionId, language: 'sv', revision: 1 },
    setting: 'lesson-check',
    concepts: question.concepts,
    questionType: question.type,
    options: question.options,
    given: undefined,
    correct,
  };
}

let scheduler: Scheduler;
beforeAll(async () => {
  scheduler = await createScheduler();
});

/** The names the example subject gives its concepts, in Swedish. */
const NAMES: ReadonlyMap<string, string> = new Map([
  ['energi', 'Energi'],
  ['effekt', 'Effekt'],
  ['si-prefix', 'SI-prefix'],
  ['energibalans', 'Energibalans'],
  ['forluster', 'Förluster'],
]);

const progress = (answers: readonly RecordedAnswer[], passed: readonly string[] = [], timeZone = 'UTC') =>
  progressOf(scheduler, { subjectId: 'example-subject', banks: BANKS, conceptNames: NAMES, answers, passed: new Set(passed), now: NOW, timeZone });

/** The lesson's three questions all answered right, `days` ago. */
const allRightAgo = (days: number) => [answer('kwh-eller-kw', ago(days), true), answer('berakna-energi', ago(days), true), answer('effekt-ar-takt', ago(days), true)];
/** By hand: the lesson's mean expected recall `days` after all three were answered right — two rated "hard", one "good". */
const lessonAt = (days: number) => (recall(days, HARD) + recall(days, GOOD) + recall(days, HARD)) / 3;

/** Three days ago wrong, then right the same day; right two days ago; right a day ago. */
const HISTORY = (): RecordedAnswer[] => [
  answer('kwh-eller-kw', ago(3), false),
  answer('kwh-eller-kw', new Date(ago(3).getTime() + 60_000), true),
  answer('berakna-energi', ago(2), true),
  answer('effekt-ar-takt', ago(1), true),
];

describe('mastery per lesson and area', () => {
  it('is the mean expected recall of the questions, one never answered counting as 0, and only the first answer of a day counting', () => {
    const shown = progress(HISTORY(), ['energi-och-effekt']);

    // The right answer a minute after the wrong one is the same day, so the memory is the wrong one's.
    const kwh = recall(3, AGAIN);
    const berakna = recall(2, GOOD);
    const takt = recall(1, HARD);
    const [grunder, fordjupning] = shown.areas;
    const [energi, prefix] = grunder?.lessons ?? [];

    expect(energi).toMatchObject({ lessonId: 'energi-och-effekt', questions: 3, met: 3, passed: true, mastered: false });
    expect(energi?.recall).toBeCloseTo((kwh + berakna + takt) / 3, 7);
    expect(prefix).toEqual({ lessonId: 'enhetsprefix', recall: 0, questions: 3, met: 0, passed: false, mastered: false });
    expect(grunder).toMatchObject({ areaId: 'grunder', questions: 6, met: 3 });
    expect(grunder?.recall).toBeCloseTo((kwh + berakna + takt) / 6, 7);
    expect(fordjupning).toMatchObject({ areaId: 'fordjupning', recall: 0, questions: 2, met: 0 });
    expect(shown).toMatchObject({ subjectId: 'example-subject', target: 0.9, questions: 8, met: 3 });
    expect(shown.recall).toBeCloseTo((kwh + berakna + takt) / 8, 7);
  });

  it('calls a passed lesson mastered while its questions’ expected recall is at or above 90 %, and passed again once it falls below', () => {
    // By hand: half a day after three right answers the lesson is above the target; two days after, below it.
    expect(lessonAt(0.5)).toBeGreaterThan(0.9);
    expect(lessonAt(2)).toBeLessThan(0.9);

    const fresh = progress(allRightAgo(0.5), ['energi-och-effekt']).areas[0]?.lessons[0];
    expect(fresh?.recall).toBeCloseTo(lessonAt(0.5), 7);
    expect(fresh).toMatchObject({ passed: true, mastered: true });

    const faded = progress(allRightAgo(2), ['energi-och-effekt']).areas[0]?.lessons[0];
    expect(faded?.recall).toBeCloseTo(lessonAt(2), 7);
    expect(faded).toMatchObject({ passed: true, mastered: false });

    // Remembered as well, but with no exam passed, it is not mastered.
    expect(progress(allRightAgo(0.5)).areas[0]?.lessons[0]).toMatchObject({ passed: false, mastered: false });
  });

  it('gives a lesson with no questions no recall, and never calls it mastered', () => {
    const shown = progressOf(scheduler, {
      subjectId: 'example-subject',
      banks: [{ areaId: 'grunder', lessonId: 'utan-fragor', concepts: ['energi'], questions: [] }],
      conceptNames: NAMES,
      answers: [],
      passed: new Set(['utan-fragor']),
      now: NOW,
      timeZone: 'UTC',
    });
    expect(shown.areas[0]?.lessons[0]).toEqual({ lessonId: 'utan-fragor', recall: null, questions: 0, met: 0, passed: true, mastered: false });
    expect(shown.recall).toBeNull();
  });
});

describe('learning over time', () => {
  it('gives the last thirty days ending today, each with its answers, how many were right, and the subject’s expected recall at its end', () => {
    const { days } = progress(HISTORY());

    expect(days).toHaveLength(DAYS);
    expect(days[0]?.day).toBe('2026-10-24');
    expect(days.at(-1)?.day).toBe('2026-11-22');
    expect(days.slice(-4).map(({ day, answers, correct }) => ({ day, answers, correct }))).toEqual([
      { day: '2026-11-19', answers: 2, correct: 1 },
      { day: '2026-11-20', answers: 1, correct: 1 },
      { day: '2026-11-21', answers: 1, correct: 1 },
      { day: '2026-11-22', answers: 0, correct: 0 },
    ]);

    // At midnight ending 19 November, half a day after the wrong answer at noon; nothing else answered yet.
    expect(days.at(-4)?.recall).toBeCloseTo(recall(0.5, AGAIN) / 8, 7);
    // At midnight ending 20 November: the wrong answer a day and a half old, the right one half a day.
    expect(days.at(-3)?.recall).toBeCloseTo((recall(1.5, AGAIN) + recall(0.5, GOOD)) / 8, 7);
    expect(days.at(-2)?.recall).toBeCloseTo((recall(2.5, AGAIN) + recall(1.5, GOOD) + recall(0.5, HARD)) / 8, 7);
    // Today is measured now, not at midnight.
    expect(days.at(-1)?.recall).toBeCloseTo((recall(3, AGAIN) + recall(2, GOOD) + recall(1, HARD)) / 8, 7);
    // Before the first answer the subject's recall is nothing.
    expect(days.slice(0, -4).every((day) => day.answers === 0 && day.recall === 0)).toBe(true);
  });

  it('counts the days in the learner’s time zone, so an answer late in the evening in Stockholm is that day there', () => {
    // 23:30 UTC on 21 November is 00:30 on 22 November in Stockholm.
    const late = [answer('berakna-energi', new Date('2026-11-21T23:30:00Z'), true, 'Europe/Stockholm')];

    expect(progress(late, [], 'UTC').days.slice(-2).map((day) => day.answers)).toEqual([1, 0]);
    expect(progress(late, [], 'Europe/Stockholm').days.slice(-2).map((day) => day.answers)).toEqual([0, 1]);
  });

  it('ends a day at its own midnight across a change of clocks', () => {
    // Stockholm leaves summer time on 25 October 2026: that day is 25 hours long.
    expect(endOfDay('2026-10-24', 'Europe/Stockholm').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(endOfDay('2026-10-25', 'Europe/Stockholm').toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(endOfDay('2026-03-28', 'Europe/Stockholm').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(endOfDay('2026-03-29', 'Europe/Stockholm').toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(endOfDay('2026-11-22', 'UTC').toISOString()).toBe('2026-11-23T00:00:00.000Z');
    // Santiago puts its clocks back at midnight, so 4 April ends at the second of two midnights.
    expect(endOfDay('2026-04-04', 'America/Santiago').toISOString()).toBe('2026-04-05T04:00:00.000Z');
    // Havana puts its clocks forward at midnight: 8 March has no midnight, and begins at one o'clock.
    expect(endOfDay('2026-03-07', 'America/Havana').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    // Cairo also moves its clocks at midnight.
    expect(endOfDay('2026-04-23', 'Africa/Cairo').toISOString()).toBe('2026-04-23T22:00:00.000Z');
  });
});

describe('weak spots', () => {
  it('names the concepts with the most wrong answers, most first, each with the first lesson on the path that teaches it, and none that was never wrong', () => {
    const answers = [
      ...HISTORY(),
      answer('prefix-ordning', ago(1), false),
      answer('prefix-ordning', ago(0.5), false),
      answer('berakna-energi', ago(0.25), false),
    ];

    expect(progress(answers).weakSpots).toEqual([
      // Two wrong of two.
      { concept: 'si-prefix', name: 'SI-prefix', wrong: 2, answers: 2, lessonId: 'enhetsprefix' },
      // Two wrong of five: kwh-eller-kw once, berakna-energi once; right three times.
      { concept: 'effekt', name: 'Effekt', wrong: 2, answers: 5, lessonId: 'energi-och-effekt' },
      { concept: 'energi', name: 'Energi', wrong: 1, answers: 2, lessonId: 'energi-och-effekt' },
    ]);
  });

  it('leaves out a concept no lesson in the subject teaches any longer', () => {
    const banks = BANKS.map((bank) => (bank.lessonId === 'enhetsprefix' ? { ...bank, concepts: ['enheter'] } : bank));
    const shown = progressOf(scheduler, { subjectId: 'example-subject', banks, conceptNames: NAMES, answers: [answer('prefix-ordning', ago(1), false)], passed: new Set(), now: NOW, timeZone: 'UTC' });
    expect(shown.weakSpots).toEqual([]);
  });

  it('names five at most', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'];
    const banks: LessonBank[] = [{ areaId: 'grunder', lessonId: 'energi-och-effekt', concepts: many, questions: ['berakna-energi'] }];
    const answers = many.map((concept) => ({ ...answer('berakna-energi', ago(1), false), concepts: [concept] }));
    const shown = progressOf(scheduler, { subjectId: 'example-subject', banks, conceptNames: NAMES, answers, passed: new Set(), now: NOW, timeZone: 'UTC' });
    expect(shown.weakSpots.map((spot) => spot.concept)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('calls a concept the subject gives no name by its id with spaces for hyphens', () => {
    const banks: LessonBank[] = [{ areaId: 'grunder', lessonId: 'energi-och-effekt', concepts: ['namnlost-begrepp'], questions: ['berakna-energi'] }];
    const answers = [{ ...answer('berakna-energi', ago(1), false), concepts: ['namnlost-begrepp'] }];
    const shown = progressOf(scheduler, { subjectId: 'example-subject', banks, conceptNames: NAMES, answers, passed: new Set(), now: NOW, timeZone: 'UTC' });
    expect(shown.weakSpots.map((spot) => spot.name)).toEqual(['namnlost begrepp']);
  });
});
