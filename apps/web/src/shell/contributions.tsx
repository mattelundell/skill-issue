import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { mergeLessonMarks, type CheckStepProps, type LessonEndProps, type LessonMark, type LessonSideProps, type WebModule } from './contract.js';
import type { ComponentType } from 'react';
import { useI18n } from './i18n.js';

/**
 * What modules contribute to each other's screens, gathered once by the shell.
 * A module asks here — for a way to link a lesson, for its marks, for whoever
 * draws a check — and never names the module that answers.
 */
interface Contributions {
  readonly lessonLink: ((subjectId: string, lessonId: string) => string) | undefined;
  readonly sourceLink: ((subjectId: string, sourceId: string) => string) | undefined;
  readonly markers: readonly NonNullable<WebModule['lessonMarks']>[];
  readonly CheckStep: ComponentType<CheckStepProps> | undefined;
  readonly lessonSides: readonly { readonly module: string; readonly Side: ComponentType<LessonSideProps> }[];
  readonly lessonEnds: readonly { readonly module: string; readonly End: ComponentType<LessonEndProps> }[];
}

const NONE: Contributions = { lessonLink: undefined, sourceLink: undefined, markers: [], CheckStep: undefined, lessonSides: [], lessonEnds: [] };

const ContributionsContext = createContext<Contributions>(NONE);

export function ContributionsProvider({ modules, children }: { readonly modules: readonly WebModule[]; readonly children: ReactNode }) {
  const value = useMemo<Contributions>(
    () => ({
      // The first module that draws lessons owns their address; there is one in practice.
      lessonLink: modules.find(({ lessonLink }) => lessonLink !== undefined)?.lessonLink,
      sourceLink: modules.find(({ sourceLink }) => sourceLink !== undefined)?.sourceLink,
      markers: modules.flatMap(({ lessonMarks }) => (lessonMarks === undefined ? [] : [lessonMarks])),
      CheckStep: modules.find(({ steps }) => steps?.check !== undefined)?.steps?.check,
      lessonSides: modules.flatMap(({ id, LessonSide }) => (LessonSide === undefined ? [] : [{ module: id, Side: LessonSide }])),
      lessonEnds: modules.flatMap(({ id, LessonEnd }) => (LessonEnd === undefined ? [] : [{ module: id, End: LessonEnd }])),
    }),
    [modules],
  );
  return <ContributionsContext.Provider value={value}>{children}</ContributionsContext.Provider>;
}

/** The address of a lesson, or undefined when no module draws lessons, so a caller names the lesson without linking it. */
export function useLessonLink(): ((subjectId: string, lessonId: string) => string) | undefined {
  return useContext(ContributionsContext).lessonLink;
}

/** The address of a source, or undefined when no module shows sources, so a caller names the source without linking it. */
export function useSourceLink(): ((subjectId: string, sourceId: string) => string) | undefined {
  return useContext(ContributionsContext).sourceLink;
}

/** Who draws a check step, if any module does. */
export function useCheckStep(): ComponentType<CheckStepProps> | undefined {
  return useContext(ContributionsContext).CheckStep;
}

/** What modules put beside a lesson, such as the note pane. */
export function useLessonSides(): readonly { readonly module: string; readonly Side: ComponentType<LessonSideProps> }[] {
  return useContext(ContributionsContext).lessonSides;
}

/** What modules put at a lesson's end, such as the offer to sit its exam. */
export function useLessonEnds(): readonly { readonly module: string; readonly End: ComponentType<LessonEndProps> }[] {
  return useContext(ContributionsContext).lessonEnds;
}

/**
 * Each lesson's state, merged from every module that marks lessons; undefined
 * when no module does, so a list is drawn without states rather than as all
 * "not started". A module whose marks cannot be read is left out, not fatal.
 */
export function useLessonMarks(subjectId: string): ReadonlyMap<string, LessonMark> | undefined {
  const { markers } = useContext(ContributionsContext);
  const { language } = useI18n();
  const [marks, setMarks] = useState<{ readonly subjectId: string; readonly marks: ReadonlyMap<string, LessonMark> }>();

  useEffect(() => {
    if (markers.length === 0) {
      return undefined;
    }
    const controller = new AbortController();
    const settle = async (): Promise<void> => {
      const settled = await Promise.allSettled(markers.map(async (marker) => marker(subjectId, controller.signal, language)));
      if (!controller.signal.aborted) {
        const read = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
        setMarks({ subjectId, marks: mergeLessonMarks(read) });
      }
    };
    void settle();
    return () => controller.abort();
  }, [subjectId, markers, language]);

  if (markers.length === 0) {
    return undefined;
  }
  return marks?.subjectId === subjectId ? marks.marks : new Map();
}
