import type { AreaProgress, DayProgress, LessonProgress, SubjectProgress, WeakSpot } from '@skill-issue/contract';
import type { LessonBank } from '../../core/catalogue/catalogue.js';
import { dayIn, recallAt, remember, SCHEDULER, type Remembered, type Scheduler } from '../../core/memory/memory.js';
import type { RecordedAnswer } from '../../core/record/record.js';

/** How many days "over time" covers, today included. */
export const DAYS = 30;
/** How many weak spots are named. */
export const WEAK_SPOTS = 5;

const DAY_MS = 86_400_000;

/** The day before or after a calendar day, as YYYY-MM-DD. */
function dayPlus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The instant a calendar day ends in a time zone: the first moment the zone's
 * clock shows the next day. Every zone's next midnight falls between 14 hours
 * before and 12 hours after midnight UTC, and the day an instant falls on only
 * grows with the instant, so halving that span finds it — including where a
 * clock change moves midnight, or skips it so the day ends at one o'clock.
 */
export function endOfDay(day: string, timeZone: string): Date {
  const midnightUtc = Date.parse(`${dayPlus(day, 1)}T00:00:00Z`);
  // `low` is still on the day or before it; `high` is past it.
  let low = midnightUtc - 15 * 3_600_000;
  let high = midnightUtc + 13 * 3_600_000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (dayIn(new Date(middle), timeZone) > day) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return new Date(high);
}

const mean = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

/**
 * The questions' memories as they stood at each of a series of moments: the
 * answers are folded in the order written, each moment taking those given up
 * to it, so the memory at a moment is exactly what review would have built then.
 */
function memoriesAt(scheduler: Scheduler, answers: readonly RecordedAnswer[], moments: readonly Date[], visit: (moment: Date, memories: ReadonlyMap<string, Remembered>) => void): void {
  const memories = new Map<string, Remembered>();
  let next = 0;
  for (const moment of moments) {
    for (; next < answers.length; next += 1) {
      const answer = answers[next];
      if (answer === undefined || answer.at.getTime() > moment.getTime()) {
        break;
      }
      const remembered = remember(scheduler, answer, memories.get(answer.question.id));
      if (remembered !== undefined) {
        memories.set(answer.question.id, remembered);
      }
    }
    visit(moment, memories);
  }
}

export interface ProgressInput {
  readonly subjectId: string;
  readonly banks: readonly LessonBank[];
  /** The name the subject gives each concept, in the language asked for. */
  readonly conceptNames: ReadonlyMap<string, string>;
  /** Every answer in the subject, in the order written. */
  readonly answers: readonly RecordedAnswer[];
  readonly passed: ReadonlySet<string>;
  readonly now: Date;
  readonly timeZone: string;
}

/** A subject's progress, computed from its answers and what it holds now. */
export function progressOf(scheduler: Scheduler, { subjectId, banks, conceptNames, answers, passed, now, timeZone }: ProgressInput): SubjectProgress {
  const target = SCHEDULER.desiredRetention;
  const held = banks.flatMap((bank) => bank.questions);

  const today = dayIn(now, timeZone);
  const days = Array.from({ length: DAYS }, (_, index) => dayPlus(today, index - (DAYS - 1)));
  const moments = days.map((day) => (day === today ? now : endOfDay(day, timeZone)));
  const recallByDay: number[] = [];
  let current: ReadonlyMap<string, Remembered> = new Map();
  memoriesAt(scheduler, answers, moments, (moment, memories) => {
    recallByDay.push(mean(held.map((id) => recallAt(scheduler, memories.get(id), moment))) ?? 0);
    current = new Map(memories);
  });

  const recallOf = (questions: readonly string[]) => ({
    recall: mean(questions.map((id) => recallAt(scheduler, current.get(id), now))),
    questions: questions.length,
    met: questions.filter((id) => current.has(id)).length,
  });

  const areas: AreaProgress[] = [];
  for (const [areaId, lessons] of Map.groupBy(banks, (bank) => bank.areaId)) {
    const lessonProgress = lessons.map((bank): LessonProgress => {
      const figures = recallOf(bank.questions);
      const wasPassed = passed.has(bank.lessonId);
      return { lessonId: bank.lessonId, ...figures, passed: wasPassed, mastered: wasPassed && figures.recall !== null && figures.recall >= target };
    });
    areas.push({ areaId, ...recallOf(lessons.flatMap((bank) => bank.questions)), lessons: lessonProgress });
  }

  const byDay = Map.groupBy(answers, (answer) => dayIn(answer.at, timeZone));
  const dayProgress = days.map((day, index): DayProgress => {
    const given = byDay.get(day) ?? [];
    return { day, answers: given.length, correct: given.filter((answer) => answer.correct).length, recall: recallByDay[index] ?? 0 };
  });

  const teaching = new Map<string, string>();
  for (const bank of banks) {
    for (const concept of bank.concepts) {
      if (!teaching.has(concept)) {
        teaching.set(concept, bank.lessonId);
      }
    }
  }
  const tally = new Map<string, { wrong: number; answers: number }>();
  for (const answer of answers) {
    for (const concept of new Set(answer.concepts)) {
      const counted = tally.get(concept) ?? { wrong: 0, answers: 0 };
      tally.set(concept, { wrong: counted.wrong + (answer.correct ? 0 : 1), answers: counted.answers + 1 });
    }
  }
  const weakSpots = [...tally].flatMap(([concept, counted]): WeakSpot[] => {
    const lessonId = teaching.get(concept);
    // A concept the subject gives no name is called by its id, its hyphens read as spaces.
    return lessonId === undefined || counted.wrong === 0 ? [] : [{ concept, name: conceptNames.get(concept) ?? concept.replaceAll('-', ' '), ...counted, lessonId }];
  });
  weakSpots.sort((a, b) => {
    if (a.wrong !== b.wrong) {
      return b.wrong - a.wrong;
    }
    const share = b.wrong / b.answers - a.wrong / a.answers;
    return share !== 0 ? share : a.concept < b.concept ? -1 : 1;
  });

  return { subjectId, target, ...recallOf(held), areas, days: dayProgress, weakSpots: weakSpots.slice(0, WEAK_SPOTS) };
}
