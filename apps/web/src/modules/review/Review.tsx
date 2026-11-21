import type { Due, SubjectSummary } from '@skill-issue/contract';
import { useCallback, useMemo, useState } from 'react';
import type { Language } from '../../i18n/index.js';
import type { PageProps, SubjectProps } from '../../shell/contract.js';
import { useCheckStep } from '../../shell/contributions.js';
import { usePolled } from '../../shell/poll.js';
import { Link, subjectPath } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchDue, minutesFor } from './api.js';
import { useMessages } from './messages.js';

/** How many other questions a question answered wrong waits behind before it is asked again in the same session. */
export const AGAIN_AFTER = 3;

/**
 * Where a question answered wrong goes back into the queue: behind the next
 * three, or at the end when fewer are left. With nothing else left it comes
 * straight back — the learner has just read why, and the session ends only
 * when every question in it has been answered right once.
 */
export function requeue(rest: readonly string[], wrong: string): readonly string[] {
  const at = Math.min(AGAIN_AFTER, rest.length);
  return [...rest.slice(0, at), wrong, ...rest.slice(at)];
}

/** A day as YYYY-MM-DD, said the way the interface language says a date. */
const dayWords = (day: string, language: Language): string =>
  new Intl.DateTimeFormat(language === 'sv' ? 'sv-SE' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

/** Tomorrow in the learner's own time zone, as YYYY-MM-DD. */
const tomorrow = (): string => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86_400_000));

function NextLine({ next, language }: { readonly next: Due['next']; readonly language: Language }) {
  const { t, tc } = useMessages();
  if (next === null) {
    return null;
  }
  return <p>{next.day === tomorrow() ? tc('next.tomorrow', next.questions) : t('next.later', { date: dayWords(next.day, language) })}</p>;
}

/** On the subject home, above the path: what is due today and a way into it, or that nothing is. Says nothing before a question has been met. */
export function DueBlock({ subject, language }: SubjectProps) {
  const { t, tc } = useMessages();
  const load = useCallback(async (signal: AbortSignal) => fetchDue(subject.id, signal), [subject.id]);
  const { value } = usePolled(load);
  if (value?.kind !== 'ok' || value.value.scheduled === 0) {
    return null;
  }
  const due = value.value;
  const minutes = minutesFor(due.questions.length, due.typicalAnswerMs);
  if (due.questions.length === 0) {
    return (
      <div className="sheet due none">
        <div>
          <h2>{t('block.none')}</h2>
          <NextLine next={due.next} language={language} />
        </div>
      </div>
    );
  }
  return (
    <div className="sheet due">
      <div>
        <h2>{tc('block.due', due.questions.length)}</h2>
        {minutes === undefined ? null : <p>{tc('block.minutes', minutes)}</p>}
      </div>
      <Link className="btn" to={subjectPath(subject.id, 'review')}>
        {t('block.action')}
      </Link>
    </div>
  );
}

/** On a subject's row on the start screen: how many questions are due today and about how long they take. Nothing before a question has been met. */
export function DueFigures({ subject }: { readonly subject: SubjectSummary; readonly language: Language }) {
  const { t } = useMessages();
  const load = useCallback(async (signal: AbortSignal) => fetchDue(subject.id, signal), [subject.id]);
  const { value } = usePolled(load);
  if (value?.kind !== 'ok' || value.value.scheduled === 0) {
    return null;
  }
  const due = value.value;
  const minutes = minutesFor(due.questions.length, due.typicalAnswerMs);
  if (due.questions.length === 0) {
    return <span className="review-figure">{t('figure.none')}</span>;
  }
  return (
    <span className="review-figure due-yes">
      <b>{t('figure.due', { count: String(due.questions.length) })}</b>
      {minutes === undefined ? null : `, ${t('figure.minutes', { minutes: String(minutes) })}`}
    </span>
  );
}

/** The review page: what was due when it opened, one question at a time, a wrong one asked again later in the session. */
export function ReviewPage({ subject, language }: PageProps) {
  const { t } = useMessages();
  // What is due is read once, on opening: the session is that list, and answering moves its questions on to later days.
  const load = useMemo(() => async (signal: AbortSignal) => fetchDue(subject.id, signal), [subject.id]);
  const { fetched, retry } = useFetched(`review/${subject.id}`, load);
  if (fetched === undefined) {
    return (
      <div className="sheet review-step" aria-busy="true">
        <span className="sr">{t('loading')}</span>
        <div className="skeleton" />
      </div>
    );
  }
  if (fetched.kind !== 'ok') {
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
  return <Session subject={subject} language={language} due={fetched.value} />;
}

const settledIgnored = (): void => undefined;

/** One question of the session, drawn by whoever draws a check and asked as a review. The session moves on by its own button, so being settled says nothing it needs. */
function Asked({
  CheckStep,
  questionId,
  ...props
}: SubjectProps & {
  readonly CheckStep: NonNullable<ReturnType<typeof useCheckStep>>;
  readonly questionId: string;
  readonly onAnswered: (questionId: string, correct: boolean) => void;
}) {
  const questions = useMemo(() => [questionId], [questionId]);
  return <CheckStep {...props} questions={questions} setting="review" onSettled={settledIgnored} />;
}

function Session({ subject, language, due }: SubjectProps & { readonly due: Due }) {
  const { t, tc } = useMessages();
  const CheckStep = useCheckStep();
  const [queue, setQueue] = useState<readonly string[]>(due.questions);
  // Each time a question is asked counts as a new asking, so a question asked again is drawn afresh.
  const [asked, setAsked] = useState(0);
  const [answer, setAnswer] = useState<{ readonly correct: boolean } | undefined>();
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());
  const home = subjectPath(subject.id);

  const onAnswered = useCallback((questionId: string, correct: boolean) => {
    setAnswer({ correct });
    setReviewed((before) => (before.has(questionId) ? before : new Set(before).add(questionId)));
  }, []);

  const current = queue[0];
  const next = (): void => {
    if (current === undefined || answer === undefined) {
      return;
    }
    const rest = queue.slice(1);
    setQueue(answer.correct ? rest : requeue(rest, current));
    setAnswer(undefined);
    setAsked((before) => before + 1);
    window.scrollTo(0, 0);
  };

  if (due.questions.length === 0) {
    return (
      <div className="sheet state review-done">
        <h2>{t('page.nothing.title')}</h2>
        <p>{due.scheduled === 0 ? t('page.nothing.fresh') : t('page.nothing.body')}</p>
        <NextLine next={due.next} language={language} />
        <Link className="btn small" to={home}>
          {t('home')}
        </Link>
      </div>
    );
  }
  if (current === undefined) {
    return (
      <output className="sheet state review-done">
        <h2>{t('page.done.title')}</h2>
        <p>{tc('page.done.body', reviewed.size)}</p>
        <Link className="btn" to={home}>
          {t('home')}
        </Link>
      </output>
    );
  }
  if (CheckStep === undefined) {
    return <p className="sheet placeholder">{t('page.no-checks')}</p>;
  }
  const last = queue.length === 1 && answer?.correct === true;
  return (
    <div className="review">
      <p className="review-count">{tc('page.left', queue.length)}</p>
      <article className="sheet review-step">
        <p className="review-kind">{t('page.kind')}</p>
        <Asked key={`${String(asked)}:${current}`} CheckStep={CheckStep} subject={subject} language={language} questionId={current} onAnswered={onAnswered} />
        {answer?.correct === false ? <p className="review-again">{t('page.again')}</p> : null}
      </article>
      <div className="review-nav">
        <span>
          <Link to={home}>{t('page.stop')}</Link> <span className="review-hint">{t('page.stop.hint')}</span>
        </span>
        <button type="button" className="btn" onClick={next} disabled={answer === undefined}>
          {last ? t('page.finish') : t('page.next')}
        </button>
      </div>
    </div>
  );
}
