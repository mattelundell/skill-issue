import type { LessonView, ShownStep, SubjectOutline } from '@skill-issue/contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Language } from '../../i18n/index.js';
import { languageName } from '../../i18n/index.js';
import type { PageProps } from '../../shell/contract.js';
import { useCheckStep, useLessonSides, useSourceLink } from '../../shell/contributions.js';
import { Markdown } from '../../shell/markdown.js';
import { Link, subjectPath } from '../../shell/router.js';
import { WithCode } from '../../shell/text.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchLesson, savePosition } from './api.js';
import { useMessages } from './messages.js';

/** One lesson at `/subjects/<subject>/lessons/<lesson>`: nothing above or below that address is a place of its own. */
export function LessonPage({ subject, language, path }: PageProps) {
  const [lessonId, ...beyond] = path;
  if (lessonId === undefined || beyond.length > 0) {
    return <Missing subject={subject} lessonId={path.join('/')} />;
  }
  return <Lesson key={`${lessonId}:${language}`} subject={subject} language={language} lessonId={lessonId} />;
}

function Lesson({ subject, language, lessonId }: { readonly subject: SubjectOutline; readonly language: Language; readonly lessonId: string }) {
  const { t } = useMessages();
  const load = useMemo(() => async (signal: AbortSignal) => fetchLesson(subject.id, lessonId, language, signal), [subject.id, lessonId, language]);
  const { fetched, retry } = useFetched(`${subject.id}/${lessonId}/${language}`, load);
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
  return <Taking key={`${fetched.value.lesson.revision}`} subject={subject} language={language} view={fetched.value} refetchFor={refetchFor} />;
}

/** Whether to say where the learner is taken up, and why. Said once, on opening. */
type Welcome = 'resumed' | 'changed' | undefined;

function Taking({
  subject,
  language,
  view,
  refetchFor,
}: {
  readonly subject: SubjectOutline;
  readonly language: Language;
  readonly view: LessonView;
  /** Fetches the lesson again after a save was refused as stale; false when that was already done for this revision. */
  readonly refetchFor: (revision: number) => boolean;
}) {
  const { t } = useMessages();
  const { lesson } = view;
  const total = lesson.steps.length;
  const [step, setStep] = useState(view.resumeAt);
  const [welcome, setWelcome] = useState<Welcome>(view.changedSince ? 'changed' : view.position !== null && view.resumeAt > 0 ? 'resumed' : undefined);
  const [saveFailed, setSaveFailed] = useState(false);
  // A check drawn by another module holds the learner until its questions are answered, per step.
  const [settled, setSettled] = useState<ReadonlySet<number>>(new Set());
  const CheckStep = useCheckStep();
  const sides = useLessonSides();
  const home = subjectPath(subject.id);

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
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      const begin = async (): Promise<void> => {
        const saved = await savePosition(lesson.subjectId, lesson.id, view.resumeAt, lesson.revision);
        if (saved === 'changed' && !refetchFor(lesson.revision)) {
          setSaveFailed(true);
        }
      };
      void begin();
    }
  }, [lesson.subjectId, lesson.id, lesson.revision, view.resumeAt, refetchFor]);

  const current = lesson.steps[step];
  const holding = current?.type === 'check' && CheckStep !== undefined && !settled.has(step);
  const forward = useCallback(() => {
    if (!holding) {
      moveTo(step + 1);
    }
  }, [holding, moveTo, step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      const inField = target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable="true"]') !== null;
      if (event.key === 'Enter' && !inField && !event.metaKey && !event.ctrlKey && !event.altKey && step < total) {
        event.preventDefault();
        forward();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [forward, step, total]);

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
      {lesson.language === language ? null : <p className="chip">{t('in-language', { language: languageName(lesson.language) })}</p>}
      <StepBar steps={lesson.steps} at={step} goTo={moveTo} />
      {step < total ? <p className="stepcount">{t('step.of', { step: String(step + 1), steps: String(total) })}</p> : null}
    </>
  );

  if (current === undefined) {
    return (
      <div className="lesson">
        {head}
        <End subject={subject} lessonId={lesson.id} summary={lesson.summary} />
        {sourcesLine}
      </div>
    );
  }

  const sideBlocks = sides.map(({ module, Side }) => (
    <div key={module} className="lesson-side" data-module={module}>
      <Side subject={subject} language={language} lessonId={lesson.id} step={step} />
    </div>
  ));
  return (
    <div className="lesson">
      {head}
      <div className={sideBlocks.length > 0 ? 'lesson-grid with-side' : 'lesson-grid'}>
        <div>
          {welcome === undefined ? null : (
            <div className={welcome === 'changed' ? 'banner warn' : 'banner info'} role="note">
              <span>{welcome === 'changed' ? t('changed', { step: String(step + 1) }) : t('resumed', { step: String(step + 1), steps: String(total) })}</span>
              <button type="button" className="link-button" onClick={() => moveTo(0)}>
                {t('from-start')}
              </button>
            </div>
          )}
          {saveFailed ? (
            <output className="banner warn">{t('save.failed')}</output>
          ) : null}
          <StepCard
            key={step}
            subject={subject}
            language={language}
            lessonId={lesson.id}
            step={current}
            CheckStep={CheckStep}
            onSettled={(done) => setSettled((before) => (done === before.has(step) ? before : done ? new Set(before).add(step) : new Set([...before].filter((each) => each !== step))))}
          />
          <div className="nav">
            <span>
              {step > 0 ? (
                <button type="button" className="btn quiet small" onClick={() => moveTo(step - 1)}>
                  ← {t('previous')}
                </button>
              ) : null}
            </span>
            <span className="keys">
              <kbd>Enter</kbd> {t('keys.enter')}
            </span>
            <button type="button" className="btn" onClick={forward} disabled={holding} title={holding ? t('check.answer-first') : undefined}>
              {step === total - 1 ? t('finish') : t('continue')}
            </button>
          </div>
          {sourcesLine}
        </div>
        {sideBlocks.length > 0 ? <aside className="lesson-sides">{sideBlocks}</aside> : null}
      </div>
    </div>
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
  CheckStep,
  onSettled,
}: {
  readonly subject: SubjectOutline;
  readonly language: Language;
  readonly lessonId: string;
  readonly step: ShownStep;
  readonly CheckStep: ReturnType<typeof useCheckStep>;
  readonly onSettled: (settled: boolean) => void;
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
          <CheckStep subject={subject} language={language} lessonId={lessonId} questions={step.questions} onSettled={onSettled} />
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

function End({ subject, lessonId, summary }: { readonly subject: SubjectOutline; readonly lessonId: string; readonly summary: string }) {
  const { t } = useMessages();
  const path = subject.areas.flatMap((area) => area.lessons);
  const next = path[path.findIndex((lesson) => lesson.id === lessonId) + 1];
  return (
    <section className="sheet end" aria-labelledby="end-h">
      <h2 id="end-h">{t('end.title')}</h2>
      <h3>{t('end.summary')}</h3>
      <p>{summary}</p>
      {next === undefined ? <p>{t('end.last')}</p> : null}
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
