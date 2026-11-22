import { DueCountsSchema, DueSchema, type Due, type DueCounts } from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';
import { learnerTimeZone } from '../../shell/timeZone.js';

/** What is due today in one subject, "today" being the learner's own day. */
export const fetchDue = async (subjectId: string, signal: AbortSignal): Promise<Fetched<Due>> =>
  getJson(`/review/subjects/${encodeURIComponent(subjectId)}/due?timeZone=${encodeURIComponent(learnerTimeZone())}`, DueSchema, signal);

/** What is due today in every subject: how many in each, and the questions themselves, the most overdue first. */
export const fetchDueEverywhere = async (signal: AbortSignal): Promise<Fetched<DueCounts>> =>
  getJson(`/review/due?timeZone=${encodeURIComponent(learnerTimeZone())}`, DueCountsSchema, signal);
