import type { LessonPosition, OutlineLesson, SubjectOutline } from '@skill-issue/contract';
import type { Language } from '../../i18n/index.js';
import type { LessonMark } from '../../shell/contract.js';
import { catalogues } from './messages.js';

/**
 * What lessons can say about a lesson's state. Lessons know only whether one has
 * been begun: "passed" and "mastered" belong to the modules that grade and
 * schedule. A lesson gone through to its end stays "in progress", said as "all
 * steps gone through", because passing is defined by the lesson's exam.
 */
export function marksFrom(positions: Readonly<Record<string, LessonPosition>>, language: Language): ReadonlyMap<string, LessonMark> {
  const words = catalogues[language];
  const latest = Object.entries(positions).toSorted(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt))[0]?.[0];
  return new Map(
    Object.entries(positions).map(([lessonId, position]) => {
      const detail =
        position.finishedAt !== null && (position.step === 0 || position.step >= position.steps)
          ? words['mark.done']
          : words['mark.step'].replace('{step}', String(Math.min(position.step, position.steps - 1) + 1)).replace('{steps}', String(position.steps));
      const mark: LessonMark = lessonId === latest ? { state: 'in-progress', detail, here: true } : { state: 'in-progress', detail };
      return [lessonId, mark];
    }),
  );
}

/** What the subject home suggests: carry on with a lesson left midway, else take up the first one not gone through. */
export type Suggestion =
  | { readonly kind: 'continue'; readonly lesson: OutlineLesson; readonly area: string; readonly step: number; readonly steps: number }
  | { readonly kind: 'begin' | 'next'; readonly lesson: OutlineLesson; readonly area: string };

export function suggestionFor(outline: SubjectOutline, positions: Readonly<Record<string, LessonPosition>>): Suggestion | undefined {
  const path = outline.areas.flatMap((area) => area.lessons.map((lesson) => ({ lesson, area: area.title })));
  const midway = Object.entries(positions)
    .filter(([, position]) => position.step < position.steps && !(position.finishedAt !== null && position.step === 0))
    .toSorted(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt));
  for (const [lessonId, position] of midway) {
    const onPath = path.find(({ lesson }) => lesson.id === lessonId);
    if (onPath !== undefined) {
      return { kind: 'continue', ...onPath, step: position.step + 1, steps: position.steps };
    }
  }
  const untaken = path.find(({ lesson }) => (positions[lesson.id]?.finishedAt ?? null) === null);
  if (untaken === undefined) {
    return undefined;
  }
  return { kind: Object.keys(positions).length === 0 ? 'begin' : 'next', ...untaken };
}
