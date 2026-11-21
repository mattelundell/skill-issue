import { DueCountsSchema, DueSchema, type Due, type DueCounts } from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';
import { learnerTimeZone } from '../../shell/timeZone.js';

/** What is due today in one subject, "today" being the learner's own day. */
export const fetchDue = async (subjectId: string, signal: AbortSignal): Promise<Fetched<Due>> =>
  getJson(`/review/subjects/${encodeURIComponent(subjectId)}/due?timeZone=${encodeURIComponent(learnerTimeZone())}`, DueSchema, signal);

/** Whole minutes a review of `questions` takes at the learner's typical pace, at least one; undefined before there is a pace to go by. */
export function minutesFor(questions: number, typicalAnswerMs: number | null): number | undefined {
  if (typicalAnswerMs === null || questions === 0) {
    return undefined;
  }
  return Math.max(1, Math.round((questions * typicalAnswerMs) / 60_000));
}

/** What is due today in every subject: how many in each, and the questions themselves, the most overdue first. */
export const fetchDueEverywhere = async (signal: AbortSignal): Promise<Fetched<DueCounts>> =>
  getJson(`/review/due?timeZone=${encodeURIComponent(learnerTimeZone())}`, DueCountsSchema, signal);

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
