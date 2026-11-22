import { ModuleIdSchema, type OutlineArea, type SubjectOutline, type SubjectSummary } from '@skill-issue/contract';
import type { ComponentType, ReactNode } from 'react';
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

/** What a module's page outside any subject is given: where within the page the learner is. */
export interface AppPageProps {
  readonly language: Language;
  /** The path segments below the page, decoded: `/review/a` gives `['a']`, the page itself `[]`. */
  readonly path: readonly string[];
  /** The address of a place within this page, for a link to it. */
  readonly pathTo: (path: readonly string[]) => string;
}

/** The first path segment that is the shell's own, so no module may take it as its id. */
export const RESERVED_IDS: ReadonlySet<string> = new Set(['subjects']);

export interface WebModule {
  /** Unique, the same as the module's id on the server; also the path segment of its page. */
  readonly id: string;
  /**
   * A page within a subject, at `/subjects/<subject>/<id>`. Everything below that
   * address is the page's own, such as one source or one lesson. With a label it
   * has a tab beside the overview and is drawn under the subject's heading and
   * tabs; without one it is reached from links, as a lesson is from the path,
   * and is drawn alone, bringing its own way back to the subject.
   */
  readonly page?: {
    readonly label?: Readonly<Record<Language, string>>;
    readonly Page: ComponentType<PageProps>;
  };
  /**
   * A page that belongs to no one subject, at `/<id>`, such as a review of what
   * is due in every subject. Everything below that address is the page's own.
   * It has no tab: it is reached from links, and drawn under the app's own header.
   */
  readonly appPage?: { readonly Page: ComponentType<AppPageProps> };
  /**
   * Blocks on the subject home: `lead` above the path, such as what is due today;
   * `side` in the column beside it, such as a count of notes. Drawn in module order.
   */
  readonly homeBlocks?: readonly { readonly placement: 'lead' | 'side'; readonly Block: ComponentType<SubjectProps> }[];
  /** Figures on a subject's row on the start screen, such as reviews due or mastery. */
  readonly StartFigures?: ComponentType<{ readonly subject: SubjectSummary; readonly language: Language }>;
  /**
   * A panel above the start screen's rows, such as where the learner left off.
   * It draws nothing when there is nothing to say, and reports which subject it
   * shows: while it shows one, the other rows go compact under their own heading
   * and leave that subject out.
   */
  readonly ResumePanel?: ComponentType<{
    readonly subjects: readonly SubjectSummary[];
    readonly language: Language;
    readonly onShows: (subjectId: string | undefined) => void;
  }>;
  /**
   * A line across every subject, under the resume panels and above the rows,
   * such as how much is due in all of them. Drawn whether or not a panel shows;
   * it draws nothing when there is nothing to say.
   */
  readonly StartLine?: ComponentType<{ readonly subjects: readonly SubjectSummary[]; readonly language: Language }>;
  /**
   * The subjects in which the learner has begun something, so each row's action
   * reads "continue" or "begin". With no module saying, it reads "open".
   */
  readonly startedSubjects?: (signal: AbortSignal) => Promise<ReadonlySet<string>>;
  /** The address of one source, for every module that names a source to link it. One module shows sources. */
  readonly sourceLink?: (subjectId: string, sourceId: string) => string;
  /**
   * The address of one lesson, for every module that names a lesson to link it;
   * given a step, counted from 0, the lesson opens at that step. One module draws lessons.
   */
  readonly lessonLink?: (subjectId: string, lessonId: string, step?: number) => string;
  /** How a step type is drawn inside a lesson, by the module that owns it: a check, by the module that grades answers. */
  readonly steps?: { readonly check?: ComponentType<CheckStepProps> };
  /**
   * Something beside a lesson as it is taken, such as the note pane. It is
   * closed until the learner opens it, with its button under the step or its
   * key, so a lesson keeps its full width for whoever does not want it.
   */
  readonly lessonSide?: LessonSide;
  /** Something at a lesson's end, such as the offer to sit its exam. */
  readonly LessonEnd?: ComponentType<LessonEndProps>;
  /** Something at the foot of each area on the subject's path, such as the area's exam. Nothing is locked: it is offered whatever the learner has taken. */
  readonly AreaFooter?: ComponentType<AreaFooterProps>;
  /** Each lesson's state on the path, by lesson id. A lesson it does not name, it says nothing about. */
  readonly lessonMarks?: (subjectId: string, signal: AbortSignal, language: Language) => Promise<ReadonlyMap<string, LessonMark>>;
  /**
   * Words to mark in a lesson's text steps, such as the subject's glossary terms,
   * each with the card it opens. Read in the language the subject is shown in.
   */
  readonly textMarks?: (subject: SubjectOutline, signal: AbortSignal) => Promise<readonly TextMark[]>;
}

/**
 * A word or phrase marked in a lesson's text. It is found by any of its forms,
 * from the start of a word and with a Swedish ending allowed after it, the
 * first time the step names it; pointing at it, focusing it or clicking it
 * opens its card beside the words.
 */
export interface TextMark {
  readonly id: string;
  readonly forms: readonly string[];
  /** What the mark opens, such as a definition and where it comes from. */
  readonly card: ReactNode;
}

/**
 * What draws a check step is given: the questions it asks, and a way to say when
 * the learner may go on. A scheduled review draws its questions the same way,
 * one at a time, outside any lesson.
 */
export interface CheckStepProps {
  readonly subject: SubjectOutline;
  readonly language: Language;
  /** The lesson the check belongs to; none for a question asked in a review. */
  readonly lessonId?: string;
  readonly questions: readonly string[];
  /** Where the questions are asked; a lesson's check when not given. */
  readonly setting?: 'lesson-check' | 'review';
  /**
   * For a step of a lesson taken up again: the learning record's row after which
   * the pass under way began. A question answered since is shown with that answer
   * rather than asked afresh. Not given, every question is asked afresh.
   */
  readonly answeredAfter?: number;
  /** Called with true once every question is answered, so the lesson lets the learner on. */
  readonly onSettled: (settled: boolean) => void;
  /** Called as each question is graded, so the lesson can ask a wrong one again before it ends. */
  readonly onAnswered: (questionId: string, correct: boolean) => void;
}

/** What a contribution at a lesson's end is given: the lesson just gone through. */
export interface LessonEndProps {
  readonly subject: SubjectOutline;
  readonly language: Language;
  readonly lessonId: string;
}

/** What a contribution at the foot of an area on the path is given. */
export interface AreaFooterProps {
  readonly subject: SubjectOutline;
  readonly language: Language;
  readonly area: OutlineArea;
}

/** A contribution beside a lesson, and how the learner opens and closes it. */
export interface LessonSide {
  /** The button's text when closed and when open, and the word after its key in the lesson's key hints. */
  readonly label: Readonly<Record<Language, { readonly open: string; readonly close: string; readonly hint: string }>>;
  /** One lower-case letter that opens and closes it, pressed outside a text field. */
  readonly key: string;
  readonly Side: ComponentType<LessonSideProps>;
}

/** What a contribution beside a lesson is given: the lesson and the step on screen, the text selected in that step, and a way to close itself. */
export interface LessonSideProps {
  readonly subject: SubjectOutline;
  readonly language: Language;
  readonly lessonId: string;
  /** The step on screen, counted from 0. */
  readonly step: number;
  /** The text the learner has selected inside the step on screen, trimmed; undefined when nothing there is selected. */
  readonly selection: () => string | undefined;
  /** Closes it, as its button would. */
  readonly close: () => void;
}

export type ModulesError =
  | { readonly kind: 'invalid-id'; readonly id: string }
  | { readonly kind: 'duplicate-id'; readonly id: string }
  | { readonly kind: 'reserved-id'; readonly id: string };

/** Checks a list of modules the way the server's registry does — well-formed ids, none twice — and that none takes an address the shell uses. */
export function checkModules(modules: readonly WebModule[]): ModulesError | undefined {
  const seen = new Set<string>();
  for (const { id } of modules) {
    if (!ModuleIdSchema.safeParse(id).success) {
      return { kind: 'invalid-id', id };
    }
    if (RESERVED_IDS.has(id)) {
      return { kind: 'reserved-id', id };
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
