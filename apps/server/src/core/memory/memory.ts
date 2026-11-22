import type { QuestionType } from '@skill-issue/contract';
import { DefaultScheduler, Rating, type Grade } from 'ts-fsrs';
import type { RecordedAnswer } from '../record/record.js';

/**
 * What the learner is expected to remember, from the learning record: the
 * scheduling model, which answers count, and the chance of recall a memory
 * gives at a moment. It is the core's so that every module that reads it —
 * review scheduling questions, progress showing mastery — reads one model, and
 * a lesson is never called mastered while its questions are due.
 *
 * FSRS through its reference library, with everything that changes a due date
 * pinned. FSRS-6 is the model current Anki schedules with. Fuzz is off so that
 * replaying the record gives exactly the state that was built live, and the
 * short-term learning steps are off because scheduling is in whole days: a
 * question answered wrong in a session comes back in that session by the
 * session's own queue, not by the scheduler.
 */
export const SCHEDULER = {
  library: 'ts-fsrs',
  /** The installed library's version, which a test holds equal to the dependency's exact pin. */
  version: '6.0.0',
  model: 'FSRS-6',
  desiredRetention: 0.9,
  enableShortTerm: false,
  enableFuzz: false,
} as const;

/** Names the scheduler a memory state was built by. A state built by any other is replayed from the record. */
export const SCHEDULER_ID = `${SCHEDULER.library}@${SCHEDULER.version} ${SCHEDULER.model} retention=${String(SCHEDULER.desiredRetention)} short-term=${String(SCHEDULER.enableShortTerm)} fuzz=${String(SCHEDULER.enableFuzz)}`;

export const createScheduler = async () =>
  DefaultScheduler({
    version: SCHEDULER.model,
    desiredRetention: SCHEDULER.desiredRetention,
    enableShortTerm: SCHEDULER.enableShortTerm,
    enableFuzz: SCHEDULER.enableFuzz,
  });

export type Scheduler = Awaited<ReturnType<typeof createScheduler>>;
export type Card = ReturnType<Scheduler['newCard']>;

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

/**
 * The chance that a learner who knows nothing gets the question right by
 * picking at random: one option in n, a combination of options in a multiple
 * choice, one order of n items, one way of pairing n. Zero for a typed answer
 * or one graded by the learner, which cannot be hit by guessing.
 */
export function guessChance(type: QuestionType, options: number | undefined): number {
  const n = options ?? 0;
  switch (type) {
    case 'single-choice':
      return n >= 2 ? 1 / n : 0;
    case 'true-false':
      return 1 / 2;
    case 'multiple-choice':
      // Any non-empty selection is an answer.
      return n >= 1 ? 1 / (2 ** n - 1) : 0;
    case 'ordering':
    case 'matching':
      return n >= 2 ? 1 / factorial(n) : 0;
    case 'numeric':
    case 'short-text':
    case 'free-recall':
      return 0;
    default: {
      const unknown: never = type;
      return unknown;
    }
  }
}

/**
 * At or above this chance of a lucky guess, a right answer is weak evidence
 * of recall: true or false, and a single choice among three.
 */
export const GUESSABLE = 1 / 3;

/**
 * The rating an answer gives the scheduler. Wrong is "again". Right is "good",
 * except where a guess would be right often enough to make the answer weak
 * evidence, where it is "hard": the memory still grows, but more slowly, so a
 * lucky guess does not send a question away for weeks.
 */
export function ratingOf(answer: Pick<RecordedAnswer, 'correct' | 'questionType' | 'options'>): Grade {
  if (!answer.correct) {
    return Rating.Again;
  }
  return guessChance(answer.questionType, answer.options) >= GUESSABLE ? Rating.Hard : Rating.Good;
}

/** The calendar day an instant falls on in a time zone, as YYYY-MM-DD. */
export function dayIn(at: Date, timeZone: string): string {
  // en-CA writes a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** A question's memory as of the last answer that counted. */
export interface Remembered {
  readonly card: Card;
  /** The last answer that counted: only the first answer of a day, in the learner's time zone, does. */
  readonly countedAt: Date;
}

/**
 * Whether an answer moves the memory. The first answer to a question on a day,
 * in the learner's own time zone, is the honest measure of what they remember;
 * a second the same day, such as the round a lesson asks again or a wrong answer
 * coming back in a review session, is the learning itself and leaves the
 * memory alone. An answer older than the last one counted — answers written
 * together share their time — counts no more than one the same day.
 */
export function counts(answer: Pick<RecordedAnswer, 'at' | 'timeZone'>, last: Remembered | undefined): boolean {
  if (last === undefined) {
    return true;
  }
  return answer.at.getTime() > last.countedAt.getTime() && dayIn(answer.at, answer.timeZone) !== dayIn(last.countedAt, answer.timeZone);
}

/** The memory after an answer, or undefined when the answer does not count and the memory stays as it was. */
export function remember(scheduler: Scheduler, answer: Pick<RecordedAnswer, 'at' | 'timeZone' | 'correct' | 'questionType' | 'options'>, last: Remembered | undefined): Remembered | undefined {
  if (!counts(answer, last)) {
    return undefined;
  }
  const card = last?.card ?? scheduler.newCard({ now: answer.at });
  return { card: scheduler.review({ card, grade: ratingOf(answer), now: answer.at }).card, countedAt: answer.at };
}

const DAY_MS = 86_400_000;

/**
 * The chance of recalling a question at a moment, from its memory: the model's
 * forgetting curve at the time elapsed since it was last answered, in days and
 * fractions of a day. It is the target, 90 %, at the moment the question falls
 * due, and 0 for a question never answered.
 */
export function recallAt(scheduler: Scheduler, remembered: Remembered | undefined, at: Date): number {
  const last = remembered?.card.lastReviewAt;
  if (remembered === undefined || last === null || last === undefined) {
    return 0;
  }
  const elapsedDays = Math.max(0, (at.getTime() - last.getTime()) / DAY_MS);
  return scheduler.model.forgettingCurve(remembered.card, elapsedDays);
}
