import type { LessonView, ShownStep, SubjectOutline } from '@skill-issue/contract';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Language } from '../../i18n/index.js';
import { languageName } from '../../i18n/index.js';
import type { CheckStepProps, PageProps } from '../../shell/contract.js';
import { useCheckStep, useLessonEnds, useLessonSides, useSourceLink } from '../../shell/contributions.js';
import { Markdown } from '../../shell/markdown.js';
import { Link, subjectPath } from '../../shell/router.js';
import { WithCode } from '../../shell/text.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchLesson, savePosition } from './api.js';
import { useMessages } from './messages.js';

/** A step in a lesson's address, counted from 1 as the learner sees it. */
const STEP_SEGMENT = /^[1-9][0-9]{0,5}$/;

/**
 * One lesson at `/subjects/<subject>/lessons/<lesson>`, taken up where the
 * learner left it; `/<step>` below that, counted from 1, opens it at that step,
 * as a note links back to where it was written.
 */
export function LessonPage({ subject, language, path }: PageProps) {
  const [lessonId, stepSegment, ...beyond] = path;
  if (lessonId === undefined || beyond.length > 0 || (stepSegment !== undefined && !STEP_SEGMENT.test(stepSegment))) {
    return <Missing subject={subject} lessonId={path.join('/')} />;
  }
  const openAt = stepSegment === undefined ? undefined : Number(stepSegment) - 1;
  return (
    <Lesson
      key={`${lessonId}:${subject.language}:${stepSegment ?? ''}`}
      subject={subject}
      language={language}
      lessonId={lessonId}
      {...(openAt === undefined ? {} : { openAt })}
    />
  );
}

function Lesson({
  subject,
  language,
  lessonId,
  openAt,
}: {
  readonly subject: SubjectOutline;
  readonly language: Language;
  readonly lessonId: string;
  /** The step the address asks for, counted from 0; undefined to take the lesson up where the learner left it. */
  readonly openAt?: number;
}) {
  const { t } = useMessages();
  // Content is read in the language the subject is shown in, which is not the interface's: choosing it is its own setting.
  const load = useMemo(() => async (signal: AbortSignal) => fetchLesson(subject.id, lessonId, subject.language, signal), [subject.id, lessonId, subject.language]);
  const { fetched, retry } = useFetched(`${subject.id}/${lessonId}/${subject.language}`, load);
  // A save refused because the lesson changed fetches it again once per revision; a server that keeps refusing must not make a loop.
  const refetchedFor = useRef(new Set<number>());
  const refetchFor = useCallback(
    (revision: number): boolean => {
      if (refetchedFor.current.has(revision)) {
        return false;
      }
      refetchedFor.current.add(revision);
      retry();
      return true;
    },
    [retry],
  );

  const title = fetched?.kind === 'ok' ? fetched.value.lesson.title : undefined;
  useEffect(() => {
    if (title !== undefined) {
      document.title = `${title} · ${subject.title}`;
    }
  }, [title, subject.title]);

  if (fetched === undefined) {
    return (
      <div className="sheet step" aria-busy="true">
        <span className="sr">{t('loading')}</span>
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }
  if (fetched.kind === 'not-found') {
    return <Missing subject={subject} lessonId={lessonId} />;
  }
  if (fetched.kind === 'failed') {
    return (
      <div className="sheet state error" role="alert">
        <h2>{t('failed.title')}</h2>
        <p>{t('failed.body')}</p>
        <button type="button" className="btn quiet small" onClick={retry}>
          {t('retry')}
        </button>
      </div>
    );
  }
  return (
    <Taking
      key={`${fetched.value.lesson.revision}`}
      subject={subject}
      language={language}
      view={fetched.value}
      refetchFor={refetchFor}
      {...(openAt === undefined ? {} : { openAt })}
    />
  );
}

/** Whether to say where the learner is taken up, and why. Said once, on opening. */
type Welcome = 'resumed' | 'changed' | 'shortened' | undefined;

function Taking({
  subject,
  language,
  view,
  refetchFor,
  openAt,
}: {
  readonly subject: SubjectOutline;
  readonly language: Language;
  readonly view: LessonView;
  /** Fetches the lesson again after a save was refused as stale; false when that was already done for this revision. */
  readonly refetchFor: (revision: number) => boolean;
  /** The step the address asks for, counted from 0. */
  readonly openAt?: number;
}) {
  const { t } = useMessages();
  const { lesson } = view;
  const total = lesson.steps.length;
  // A step asked for by address that a reload has removed opens the last step, and says so.
  const opensAt = openAt === undefined ? view.resumeAt : Math.min(openAt, total - 1);
  const [step, setStep] = useState(opensAt);
  const [welcome, setWelcome] = useState<Welcome>(
    openAt !== undefined ? (openAt >= total ? 'shortened' : undefined) : view.changedSince ? 'changed' : view.position !== null && view.resumeAt > 0 ? 'resumed' : undefined,
  );
  const [saveFailed, setSaveFailed] = useState(false);
  // A check drawn by another module holds the learner until its questions are answered, per step.
  const [settled, setSettled] = useState<ReadonlySet<number>>(new Set());
  // Questions answered wrong and not since answered right; asked once more after the last step, before the end.
  // Read back from the record, so a lesson left midway still asks them.
  const [wrong, setWrong] = useState<ReadonlySet<string>>(() => new Set(view.checks.again));
  const [again, setAgain] = useState<{ readonly questions: readonly string[]; readonly settled: boolean }>();
  const onAnswered = useCallback((questionId: string, correct: boolean) => {
    setWrong((before) => {
      if (correct === !before.has(questionId)) {
        return before;
      }
      const after = new Set(before);
      if (correct) {
        after.delete(questionId);
      } else {
        after.add(questionId);
      }
      return after;
    });
  }, []);
  const CheckStep = useCheckStep();
  const lessonEnds = useLessonEnds();
  const sides = useLessonSides();
  const home = subjectPath(subject.id);
  // What is beside the lesson is closed until the learner opens it.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggleSide = useCallback((module: string) => {
    setOpened((before) => {
      const after = new Set(before);
      if (!after.delete(module)) {
        after.add(module);
      }
      return after;
    });
  }, []);
  const closeSide = useCallback((module: string) => {
    setOpened((before) => (before.has(module) ? new Set([...before].filter((each) => each !== module)) : before));
  }, []);
  const stepHolder = useRef<HTMLDivElement>(null);
  const selection = useCallback((): string | undefined => {
    const selected = window.getSelection();
    const holder = stepHolder.current;
    if (selected === null || holder === null || selected.isCollapsed || !holder.contains(selected.anchorNode) || !holder.contains(selected.focusNode)) {
      return undefined;
    }
    const text = selected.toString().trim();
    return text === '' ? undefined : text;
  }, []);

  const moveTo = useCallback(
    (next: number) => {
      setStep(next);
      setWelcome(undefined);
      window.scrollTo(0, 0);
      const save = async (): Promise<void> => {
        const saved = await savePosition(lesson.subjectId, lesson.id, next, lesson.revision);
        // The subject was reloaded underneath: fetch the lesson again and take it up from the server's answer.
        const refetched = saved === 'changed' && refetchFor(lesson.revision);
        setSaveFailed(saved === 'failed' || (saved === 'changed' && !refetched));
      };
      void save();
    },
    [lesson.subjectId, lesson.id, lesson.revision, refetchFor],
  );

  // Opening the lesson records it as begun, at the step it opens on.
  const begun = useRef(false);
  useEffect(() => {
    if (!begun.current) {
      begun.current = true;
      if (openAt !== undefined) {
        // The step was asked for once; reloading the page takes the lesson up where the learner then is.
        window.history.replaceState(window.history.state, '', subjectPath(lesson.subjectId, 'lessons', [lesson.id]));
      }
      const begin = async (): Promise<void> => {
        const saved = await savePosition(lesson.subjectId, lesson.id, opensAt, lesson.revision);
        if (saved === 'changed' && !refetchFor(lesson.revision)) {
          setSaveFailed(true);
        }
      };
      void begin();
    }
  }, [lesson.subjectId, lesson.id, lesson.revision, opensAt, openAt, refetchFor]);

  const current = lesson.steps[step];
  const holding = again === undefined ? current?.type === 'check' && CheckStep !== undefined && !settled.has(step) : !again.settled;
  const forward = useCallback(() => {
    if (holding) {
      return;
    }
    if (again !== undefined) {
      setAgain(undefined);
      moveTo(total);
    } else if (step === total - 1 && wrong.size > 0 && CheckStep !== undefined) {
      setAgain({ questions: [...wrong], settled: false });
      window.scrollTo(0, 0);
    } else {
      moveTo(step + 1);
    }
  }, [holding, again, step, total, wrong, CheckStep, moveTo]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      const inField = target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable="true"]') !== null;
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      if (event.key === 'Enter' && !inField && plain && step < total) {
        event.preventDefault();
        forward();
        return;
      }
      if (event.key === 'Escape' && opened.size > 0) {
        // Escape closes what is open beside the lesson, even from inside it, where its own key would be typed.
        setOpened(new Set());
        return;
      }
      const side = !inField && plain && step < total ? sides.find(({ key }) => key === event.key.toLowerCase()) : undefined;
      if (side !== undefined) {
        event.preventDefault();
        toggleSide(side.module);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [forward, step, total, opened, sides, toggleSide]);

  const sourceLink = useSourceLink();
  const sourcesLine = lesson.sources.length === 0 ? null : (
    <p className="lesson-sources">
      {t('sources', { sources: '\u0000' })
        .split('\u0000')
        .flatMap((part, index, parts) => [
          part,
          index < parts.length - 1
            ? lesson.sources.map((source, at) => {
                const named = t('source', { title: source.title, publisher: source.publisher });
                return (
                  <span key={source.id}>
                    {at > 0 ? ', ' : ''}
                    {sourceLink === undefined ? named : <Link to={sourceLink(subject.id, source.id)}>{named}</Link>}
                  </span>
                );
              })
            : null,
        ])}
    </p>
  );

  const head = (
    <>
      <div className="lesson-top">
        <p className="crumb">
          <Link to={home}>{subject.title}</Link> › {lesson.area.title}
        </p>
        {step < total ? (
          <p className="leave">
            <Link to={home}>{t('leave')}</Link>
            <span>{t('leave.resume', { step: String(step + 1) })}</span>
          </p>
        ) : null}
      </div>
      <h1 className="lesson-title">{lesson.title}</h1>
      {lesson.language === subject.language ? null : <p className="chip">{t('in-language', { language: languageName(lesson.language) })}</p>}
      <StepBar steps={lesson.steps} at={step} goTo={moveTo} />
      {again !== undefined ? <p className="stepcount">{t('again.count')}</p> : step < total ? <p className="stepcount">{t('step.of', { step: String(step + 1), steps: String(total) })}</p> : null}
    </>
  );

  if (current === undefined) {
    return (
      <div className="lesson">
        {head}
        <End subject={subject} lessonId={lesson.id} summary={lesson.summary}>
          {lessonEnds.map(({ module, End: Contributed }) => (
            <div key={module} className="lesson-end" data-module={module}>
              <Contributed subject={subject} language={language} lessonId={lesson.id} />
            </div>
          ))}
        </End>
        {sourcesLine}
      </div>
    );
  }

  const sideBlocks = sides
    .filter(({ module }) => opened.has(module))
    .map(({ module, Side }) => (
      <div key={module} className="lesson-side" data-module={module}>
        <Side subject={subject} language={language} lessonId={lesson.id} step={step} selection={selection} close={() => closeSide(module)} />
      </div>
    ));
  return (
    <div className="lesson">
      {head}
      <div className={sideBlocks.length > 0 ? 'lesson-grid with-side' : 'lesson-grid'}>
        <div>
          {welcome === undefined ? null : (
            <div className={welcome === 'resumed' ? 'banner info' : 'banner warn'} role="note">
              <span>
                {welcome === 'changed'
                  ? t('changed', { step: String(step + 1) })
                  : welcome === 'shortened'
                    ? t('shortened', { steps: String(total) })
                    : t('resumed', { step: String(step + 1), steps: String(total) })}
              </span>
              <button type="button" className="link-button" onClick={() => moveTo(0)}>
                {t('from-start')}
              </button>
            </div>
          )}
          {saveFailed ? (
            <output className="banner warn">{t('save.failed')}</output>
          ) : null}
          <div ref={stepHolder}>
          {again !== undefined && CheckStep !== undefined ? (
            <AgainCard
              subject={subject}
              language={language}
              lessonId={lesson.id}
              questions={again.questions}
              CheckStep={CheckStep}
              onSettled={(done) => setAgain((before) => (before === undefined || before.settled === done ? before : { ...before, settled: done }))}
              onAnswered={onAnswered}
            />
          ) : (
            <StepCard
              key={step}
              subject={subject}
              language={language}
              lessonId={lesson.id}
              step={current}
              answeredAfter={view.checks.answeredAfter}
              CheckStep={CheckStep}
              onSettled={(done) => setSettled((before) => (done === before.has(step) ? before : done ? new Set(before).add(step) : new Set([...before].filter((each) => each !== step))))}
              onAnswered={onAnswered}
            />
          )}
          </div>
          <div className="nav">
            <span>
              {step > 0 ? (
                <button type="button" className="btn quiet small" onClick={() => moveTo(step - 1)}>
                  ← {t('previous')}
                </button>
              ) : null}
            </span>
            <span className="keys">
              <span>
                <kbd>Enter</kbd> {t('keys.enter')}
              </span>
              {sides.map(({ module, key, label }) => (
                <span key={module}>
                  <kbd>{key.toUpperCase()}</kbd> {label[language].hint}
                </span>
              ))}
            </span>
            <span className="go">
              {sides.map(({ module, label }) => (
                <button key={module} type="button" className="side-toggle" aria-expanded={opened.has(module)} onClick={() => toggleSide(module)}>
                  {opened.has(module) ? label[language].close : label[language].open}
                </button>
              ))}
              <button type="button" className="btn" onClick={forward} disabled={holding} title={holding ? t('check.answer-first') : undefined}>
                {step === total - 1 || again !== undefined ? t('finish') : t('continue')}
              </button>
            </span>
          </div>
          {sourcesLine}
        </div>
        {sideBlocks.length > 0 ? <aside className="lesson-sides">{sideBlocks}</aside> : null}
      </div>
    </div>
  );
}

/** The round after the last step that asks again what was answered wrongly. */
function AgainCard({
  CheckStep,
  questions,
  ...props
}: Omit<CheckStepProps, 'questions'> & { readonly questions: readonly string[]; readonly CheckStep: NonNullable<ReturnType<typeof useCheckStep>> }) {
  const { t, tc } = useMessages();
  return (
    <article className="sheet step check again">
      <p className="step-kind again">{t('kind.again')}</p>
      <h2>{tc('again.title', questions.length)}</h2>
      <CheckStep {...props} questions={questions} />
    </article>
  );
}

/** One segment per step; a step already passed is a button back to it. */
function StepBar({ steps, at, goTo }: { readonly steps: readonly ShownStep[]; readonly at: number; readonly goTo: (step: number) => void }) {
  const { t } = useMessages();
  return (
    <ol className="stepbar" aria-label={t('steps')}>
      {steps.map((_, index) => (
        // The steps never change order within one revision, and the bar is redrawn for a new one.
        <li key={index} className={index < at ? 'done' : index === at ? 'now' : undefined} aria-current={index === at ? 'step' : undefined}>
          {index < at ? (
            <button type="button" onClick={() => goTo(index)}>
              <span className="sr">{t('step.back', { step: String(index + 1) })}</span>
            </button>
          ) : (
            <span className="sr">{t('step.n', { step: String(index + 1) })}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function StepCard({
  subject,
  language,
  lessonId,
  step,
  answeredAfter,
  CheckStep,
  onSettled,
  onAnswered,
}: {
  readonly subject: SubjectOutline;
  readonly language: Language;
  readonly lessonId: string;
  readonly step: ShownStep;
  /** Where in the learning record the pass under way began, so a check taken up again shows what was answered in it. */
  readonly answeredAfter: number;
  readonly CheckStep: ReturnType<typeof useCheckStep>;
  readonly onSettled: (settled: boolean) => void;
  readonly onAnswered: (questionId: string, correct: boolean) => void;
}) {
  const { t, tc } = useMessages();
  const imageText = useCallback((alt: string) => t('image', { alt }), [t]);
  if (step.type === 'check') {
    return (
      <article className="sheet step check">
        <p className="step-kind check">{t('kind.check')}</p>
        <h2>{t('check.title')}</h2>
        {CheckStep === undefined ? (
          <p className="placeholder">{tc('check.placeholder', step.questions.length)}</p>
        ) : (
          <CheckStep
            subject={subject}
            language={language}
            lessonId={lessonId}
            questions={step.questions}
            answeredAfter={answeredAfter}
            onSettled={onSettled}
            onAnswered={onAnswered}
          />
        )}
      </article>
    );
  }
  return (
    <article className={`sheet step ${step.type}`}>
      <p className={`step-kind ${step.type}`}>{t(`kind.${step.type}`)}</p>
      <Markdown className="prose-step" source={step.body} subjectId={subject.id} imageText={imageText} />
    </article>
  );
}

function End({ subject, lessonId, summary, children }: { readonly subject: SubjectOutline; readonly lessonId: string; readonly summary: string; readonly children: ReactNode }) {
  const { t } = useMessages();
  const path = subject.areas.flatMap((area) => area.lessons);
  const next = path[path.findIndex((lesson) => lesson.id === lessonId) + 1];
  return (
    <section className="sheet end" aria-labelledby="end-h">
      <h2 id="end-h">{t('end.title')}</h2>
      <h3>{t('end.summary')}</h3>
      <p>{summary}</p>
      {next === undefined ? <p>{t('end.last')}</p> : null}
      {children}
      <div className="actions">
        {next === undefined ? null : (
          <Link className="btn" to={subjectPath(subject.id, 'lessons', [next.id])}>
            {t('end.next', { lesson: next.title })}
          </Link>
        )}
        <Link className={next === undefined ? 'btn' : 'btn quiet'} to={subjectPath(subject.id)}>
          {t('end.home')}
        </Link>
      </div>
    </section>
  );
}

function Missing({ subject, lessonId }: { readonly subject: SubjectOutline; readonly lessonId: string }) {
  const { t } = useMessages();
  return (
    <div className="sheet state" role="alert">
      <h2>{t('missing.title')}</h2>
      <p>
        <WithCode text={t('missing.body')} placeholder="id" code={lessonId} />
      </p>
      <Link to={subjectPath(subject.id)} className="btn small">
        {t('missing.back')}
      </Link>
    </div>
  );
}
