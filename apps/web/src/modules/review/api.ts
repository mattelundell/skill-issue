import { DueSchema, type Due } from '@skill-issue/contract';
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
