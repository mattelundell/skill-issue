import type { OutlineArea, OutlineLesson, SubjectOutline } from '@skill-issue/contract';

/** The key that opens and closes the note pane in a lesson. */
export const NOTE_KEY = 'n';
/** The key that quotes the text selected in the step into the note. */
export const QUOTE_KEY = 'q';

/** Where a lesson sits in the subject as it now stands; undefined when the subject no longer holds it. */
export function placeOf(subject: SubjectOutline, lessonId: string): { readonly area: OutlineArea; readonly lesson: OutlineLesson } | undefined {
  for (const area of subject.areas) {
    const lesson = area.lessons.find(({ id }) => id === lessonId);
    if (lesson !== undefined) {
      return { area, lesson };
    }
  }
  return undefined;
}

/** Whether a key went to something that takes typing or acts on keys itself, so a page-wide key must leave it alone. */
export function typedIntoField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable="true"]') !== null;
}

/** Text as a Markdown quote, a `>` before every line. */
export const asQuote = (text: string): string =>
  text
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line.trim()}`))
    .join('\n');
