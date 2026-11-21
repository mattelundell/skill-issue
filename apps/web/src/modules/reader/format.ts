import type { Language } from '../../i18n/index.js';

const DAY_MS = 86_400_000;

/** The first comparison that is not a tie, for sorting on several keys in turn. */
export const firstDifference = (...comparisons: readonly number[]): number => comparisons.find((comparison) => comparison !== 0) ?? 0;

/** A calendar day from the catalogue, `2026-11-20`, in the interface language. The day is read as UTC so no time zone moves it. */
export const formatDay = (day: string, language: Language): string =>
  new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));

/** How long ago a day was, in whole days, months or years: "i går", "för 3 månader sedan". */
export function formatAge(day: string, language: Language, now: Date): string {
  const then = Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((today - then) / DAY_MS);
  const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (Math.abs(days) < 31) {
    return relative.format(-days, 'day');
  }
  if (Math.abs(days) < 365) {
    return relative.format(-Math.round(days / 30.44), 'month');
  }
  return relative.format(-Math.round(days / 365.25), 'year');
}
