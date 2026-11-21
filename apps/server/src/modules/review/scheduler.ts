import type { QuestionType } from '@skill-issue/contract';
import { DefaultScheduler, Rating, type Grade } from 'ts-fsrs';
import type { RecordedAnswer } from '../../core/record/record.js';

/**
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
