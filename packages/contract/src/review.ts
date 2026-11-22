import { z } from 'zod';
import { ItemIdSchema } from './content.js';

/**
 * Scheduled review. Which questions come back, and when, is decided by the
 * review module from the learning record; answering one goes through whoever
 * grades answers, with the setting "review".
 */

/** The questions of one subject due today in the learner's time zone, the most overdue first. */
export const DueSchema = z.object({
  subjectId: ItemIdSchema,
  questions: z.array(ItemIdSchema),
  /** Questions met so far in the subject, due or not. */
  scheduled: z.number().int().min(0),
  /** The first day after today on which questions fall due, as YYYY-MM-DD in the learner's time zone, and how many; null when none will. */
  next: z.object({ day: z.iso.date(), questions: z.number().int().min(1) }).nullable(),
  /** How long the learner typically takes over one question in the subject, from their own answers; null before they have answered one. */
  typicalAnswerMs: z.number().int().min(0).nullable(),
});
export type Due = z.infer<typeof DueSchema>;

/**
 * What is due today across every subject: how many in each, and how long one
 * typically takes there, for every subject with a question scheduled; and the
 * due questions themselves, the most overdue first whichever subject holds them.
 */
export const DueCountsSchema = z.object({
  subjects: z.record(ItemIdSchema, z.object({ due: z.number().int().min(0), typicalAnswerMs: z.number().int().min(0).nullable() })),
  questions: z.array(z.object({ subjectId: ItemIdSchema, questionId: ItemIdSchema })),
});
export type DueCounts = z.infer<typeof DueCountsSchema>;

/** How many other questions a question answered wrong waits behind before it is asked again in the same session. */
export const AGAIN_AFTER = 3;

/**
 * Where a question answered wrong goes back into a review session's queue:
 * behind the next three, or at the end when fewer are left. With nothing else
 * left it comes straight back — the learner has just read why, and the session
 * ends only when every question in it has been answered right once. Every front
 * end that runs a session uses this one rule.
 */
export function requeue<T>(rest: readonly T[], wrong: T): readonly T[] {
  const at = Math.min(AGAIN_AFTER, rest.length);
  return [...rest.slice(0, at), wrong, ...rest.slice(at)];
}

/** Whole minutes a review of `questions` takes at the learner's typical pace, at least one; undefined before there is a pace to go by. */
export function minutesFor(questions: number, typicalAnswerMs: number | null): number | undefined {
  if (typicalAnswerMs === null || questions === 0) {
    return undefined;
  }
  return Math.max(1, Math.round((questions * typicalAnswerMs) / 60_000));
}

/**
 * Whole minutes the questions due in several subjects take, each at the learner's
 * pace in its own subject, at least one; undefined when nothing is due, or when a
 * subject with questions due has no pace yet, since a sum leaving it out would be too low.
 */
export function minutesForAll(subjects: readonly { readonly due: number; readonly typicalAnswerMs: number | null }[]): number | undefined {
  const due = subjects.filter((subject) => subject.due > 0);
  if (due.length === 0 || due.some((subject) => subject.typicalAnswerMs === null)) {
    return undefined;
  }
  const ms = due.reduce((sum, subject) => sum + subject.due * (subject.typicalAnswerMs ?? 0), 0);
  return Math.max(1, Math.round(ms / 60_000));
}
