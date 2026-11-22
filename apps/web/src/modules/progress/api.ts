import { SubjectProgressSchema, type SubjectProgress } from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';
import { learnerTimeZone } from '../../shell/timeZone.js';

/** What the learner can recall in a subject, with the days counted in their own time zone. */
/** A subject's progress; with a language, its weak spots are named in it. */
export const fetchProgress = async (subjectId: string, language: string | undefined, signal: AbortSignal): Promise<Fetched<SubjectProgress>> =>
  getJson(
    `/progress/subjects/${encodeURIComponent(subjectId)}?timeZone=${encodeURIComponent(learnerTimeZone())}${language === undefined ? '' : `&language=${encodeURIComponent(language)}`}`,
    SubjectProgressSchema,
    signal,
  );

/**
 * A share as a whole percentage, to the nearest one — every question remembered
 * a moment ago reads 100 %, not 99 % — but never rounded up to the target from
 * below it: a lesson at 89.6 % is short of a 90 % target, and "90 %" beside it
 * would be the one number that lies.
 */
export function percent(share: number, language: 'sv' | 'en', target: number): string {
  const nearest = Math.round(share * 100);
  const whole = share < target && nearest >= target * 100 ? Math.ceil(target * 100) - 1 : nearest;
  return new Intl.NumberFormat(language === 'sv' ? 'sv-SE' : 'en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(whole / 100);
}

/** A concept as its id names it, words apart: the content format gives concepts no names of their own. */
