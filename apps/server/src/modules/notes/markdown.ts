import type { Note, ShownStep, SubjectOutline } from '@skill-issue/contract';

export const EXPORT_LANGUAGES = ['sv', 'en'] as const;
export type ExportLanguage = (typeof EXPORT_LANGUAGES)[number];

/** The export's own words, per interface language; the subject's material comes in its content language. */
const MESSAGES: Readonly<Record<ExportLanguage, Readonly<Record<'title' | 'step' | 'gone' | 'goneLesson' | 'none', string>>>> = {
  sv: { title: '{subject} — anteckningar', step: 'Steg {step}', gone: 'Inte längre i ämnet', goneLesson: 'Lektionen {id}', none: 'Inga anteckningar än.' },
  en: { title: '{subject} — notes', step: 'Step {step}', gone: 'No longer in the subject', goneLesson: 'Lesson {id}', none: 'No notes yet.' },
};

export const isExportLanguage = (language: string): language is ExportLanguage => Object.hasOwn(MESSAGES, language);

const fill = (template: string, values: Readonly<Record<string, string>>): string => template.replaceAll(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

/** A step's own title: the level-two heading a text or example step opens with, if it has one. */
export function stepTitle(step: ShownStep | undefined): string | undefined {
  if (step === undefined || step.type === 'check') {
    return undefined;
  }
  const match = /^##[ \t]+(.+?)[ \t#]*$/m.exec(step.body.trimStart().split('\n', 1)[0] ?? '');
  return match?.[1];
}

/** The lessons a note can be filed under: their titles and steps as the subject now holds them. */
export interface FiledLesson {
  readonly title: string;
  readonly steps: readonly ShownStep[];
}

/**
 * A subject's notes as one Markdown file: each under its area and lesson in
 * the order of the path, and under its step, counted from 1 as the lesson shows
 * it. A note on a lesson the subject no longer holds comes after the path,
 * under a heading of its own, since the learner wrote it.
 */
export function notesAsMarkdown(subject: SubjectOutline, lessons: ReadonlyMap<string, FiledLesson>, notes: readonly Note[], language: ExportLanguage): string {
  const words = MESSAGES[language];
  const byLesson = Map.groupBy(notes, (note) => note.lessonId);
  const lines: string[] = [`# ${fill(words.title, { subject: subject.title })}`, ''];

  const lesson = (heading: string, lessonId: string, steps: readonly ShownStep[]): void => {
    lines.push(`### ${heading}`, '');
    for (const note of (byLesson.get(lessonId) ?? []).toSorted((a, b) => a.step - b.step)) {
      const title = stepTitle(steps[note.step]);
      const step = fill(words.step, { step: String(note.step + 1) });
      lines.push(`#### ${title === undefined ? step : `${step} · ${title}`}`, '', note.body.trim(), '');
    }
  };

  for (const area of subject.areas) {
    const written = area.lessons.filter((l) => byLesson.has(l.id));
    if (written.length > 0) {
      lines.push(`## ${area.title}`, '');
      for (const { id, title } of written) {
        lesson(title, id, lessons.get(id)?.steps ?? []);
      }
    }
  }

  const held = new Set(subject.areas.flatMap((area) => area.lessons.map((l) => l.id)));
  const gone = [...byLesson.keys()].filter((lessonId) => !held.has(lessonId)).toSorted();
  if (gone.length > 0) {
    lines.push(`## ${words.gone}`, '');
    for (const lessonId of gone) {
      lesson(fill(words.goneLesson, { id: lessonId }), lessonId, []);
    }
  }

  if (notes.length === 0) {
    lines.push(words.none, '');
  }
  return lines.join('\n');
}
