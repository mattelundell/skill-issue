import { ModuleIdSchema, type SubjectOutline, type SubjectSummary } from '@skill-issue/contract';
import type { ComponentType } from 'react';
import type { Language } from '../i18n/index.js';

/**
 * The browser side of the module contract. The shell draws the start screen and
 * the subject home and names no module: everything a module shows there, it
 * contributes through this manifest, and removing the module removes all of it.
 */

/** A lesson's place on the path. Each is a step up from the one before; nothing is locked. */
export const LESSON_STATES = ['not-started', 'in-progress', 'passed', 'mastered'] as const;
export type LessonState = (typeof LESSON_STATES)[number];

export interface LessonMark {
  readonly state: LessonState;
  /** A short addition to the state, in the interface language, such as "step 4 of 9". */
  readonly detail?: string;
  /** Whether this is where the learner last stopped. */
  readonly here?: boolean;
}

/** What a module's contribution to a subject's screens is given. */
export interface SubjectProps {
  readonly subject: SubjectOutline;
  readonly language: Language;
}

/** What a module's page is given besides its subject: where within the page the learner is. */
export interface PageProps extends SubjectProps {
  /** The path segments below the page, decoded: `/subjects/s/reader/a` gives `['a']`, the page itself `[]`. */
  readonly path: readonly string[];
  /** The address of a place within this page, for a link to it. */
  readonly pathTo: (path: readonly string[]) => string;
}

export interface WebModule {
  /** Unique, the same as the module's id on the server; also the path segment of its page. */
  readonly id: string;
  /**
   * A page within a subject, at `/subjects/<subject>/<id>`, with a tab beside the
   * overview. Everything below that address is the page's own, such as one source.
   */
  readonly page?: {
    readonly label: Readonly<Record<Language, string>>;
    readonly Page: ComponentType<PageProps>;
  };
  /**
   * Blocks on the subject home: `lead` above the path, such as what is due today;
   * `side` in the column beside it, such as a count of notes. Drawn in module order.
   */
  readonly homeBlocks?: readonly { readonly placement: 'lead' | 'side'; readonly Block: ComponentType<SubjectProps> }[];
  /** Figures on a subject's row on the start screen, such as reviews due or mastery. */
  readonly StartFigures?: ComponentType<{ readonly subject: SubjectSummary; readonly language: Language }>;
  /**
   * A panel above the start screen's rows, such as where the learner left off.
   * It draws nothing when there is nothing to say.
   */
  readonly ResumePanel?: ComponentType<{ readonly subjects: readonly SubjectSummary[]; readonly language: Language }>;
  /** Each lesson's state on the path, by lesson id. A lesson it does not name, it says nothing about. */
  readonly lessonMarks?: (subjectId: string, signal: AbortSignal) => Promise<ReadonlyMap<string, LessonMark>>;
}

export type ModulesError =
  | { readonly kind: 'invalid-id'; readonly id: string }
  | { readonly kind: 'duplicate-id'; readonly id: string };

/** Checks a list of modules the way the server's registry does: well-formed ids, none twice. */
export function checkModules(modules: readonly WebModule[]): ModulesError | undefined {
  const seen = new Set<string>();
  for (const { id } of modules) {
    if (!ModuleIdSchema.safeParse(id).success) {
      return { kind: 'invalid-id', id };
    }
    if (seen.has(id)) {
      return { kind: 'duplicate-id', id };
    }
    seen.add(id);
  }
  return undefined;
}

/**
 * Several modules may mark the same lesson — one knows it was started, another
 * that its exam was passed. The furthest state wins, with the detail of the
 * module that gave it; a lesson is where the learner stopped if any module says so.
 */
export function mergeLessonMarks(marks: readonly ReadonlyMap<string, LessonMark>[]): ReadonlyMap<string, LessonMark> {
  const merged = new Map<string, LessonMark>();
  for (const byLesson of marks) {
    for (const [lesson, mark] of byLesson) {
      const current = merged.get(lesson);
      const further = current === undefined || LESSON_STATES.indexOf(mark.state) > LESSON_STATES.indexOf(current.state) ? mark : current;
      const here = current?.here === true || mark.here === true;
      const { here: _dropped, ...rest } = further;
      merged.set(lesson, here ? { ...rest, here } : rest);
    }
  }
  return merged;
}
