import type { Due, DueCounts, SubjectOutline, SubjectSummary } from '@skill-issue/contract';
import { useCallback, useMemo, useState } from 'react';
import { fetchOutline, type Fetched } from '../../api.js';
import type { Language } from '../../i18n/index.js';
import type { AppPageProps, PageProps, SubjectProps } from '../../shell/contract.js';
import { useCheckStep } from '../../shell/contributions.js';
import { usePolled } from '../../shell/poll.js';
import { Link, appPagePath, startPath, subjectPath } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchDue, fetchDueEverywhere, minutesFor, minutesForAll } from './api.js';
import { useMessages } from './messages.js';

/** How many other questions a question answered wrong waits behind before it is asked again in the same session. */
export const AGAIN_AFTER = 3;

/**
 * Where a question answered wrong goes back into the queue: behind the next
 * three, or at the end when fewer are left. With nothing else left it comes
 * straight back — the learner has just read why, and the session ends only
 * when every question in it has been answered right once.
 */
export function requeue<T>(rest: readonly T[], wrong: T): readonly T[] {
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

/**
 * On the start screen, under the resume panel: how many questions are due in
 * every subject together, about how long they take, and a way into one session
 * of them all. With one subject holding them it names that subject, which is
 * how an installation of one subject sees its figure while the resume panel
 * hides that subject's row. Nothing when nothing is due anywhere.
 */
export function DueEverywhere({ subjects }: { readonly subjects: readonly SubjectSummary[]; readonly language: Language }) {
  const { t, tc } = useMessages();
  const { value } = usePolled(fetchDueEverywhere);
  if (value?.kind !== 'ok') {
    return null;
  }
  const due = Object.entries(value.value.subjects).filter(([, { due: count }]) => count > 0);
  const total = due.reduce((sum, [, { due: count }]) => sum + count, 0);
  if (total === 0) {
    return null;
  }
  const [only] = due;
  const title = due.length === 1 && only !== undefined ? subjects.find((subject) => subject.id === only[0])?.title : undefined;
  const where = title === undefined ? t('all.in-many', { count: String(due.length) }) : t('all.in-one', { subject: title });
  const minutes = minutesForAll(due.map(([, counted]) => counted));
  const lead = `${tc('all.due', total)} ${where}${minutes === undefined ? '' : `, ${t('figure.minutes', { minutes: String(minutes) })}`}.`;
  return (
    <p className="alldue">
      {lead} <Link to={appPagePath('review')}>{due.length === 1 ? t('block.action') : t('all.action')}</Link>
    </p>
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
  const due = fetched.value;
  if (due.questions.length === 0) {
    return (
      <div className="sheet state review-done">
        <h2>{t('page.nothing.title')}</h2>
        <p>{due.scheduled === 0 ? t('page.nothing.fresh') : t('page.nothing.body')}</p>
        <NextLine next={due.next} language={language} />
        <Link className="btn small" to={subjectPath(subject.id)}>
          {t('home')}
        </Link>
      </div>
    );
  }
  return (
    <Session
      language={language}
      queue={due.questions.map((questionId) => ({ subject, questionId }))}
      home={{ to: subjectPath(subject.id), label: t('home') }}
      namesSubject={false}
    />
  );
}

interface Everything {
  readonly due: DueCounts;
  /** The outline of every subject a due question is in. */
  readonly outlines: ReadonlyMap<string, SubjectOutline>;
}

/** What is due in every subject, and the outline of each subject it is in, since a question is asked in its own subject. */
async function loadEverything(signal: AbortSignal): Promise<Fetched<Everything>> {
  const due = await fetchDueEverywhere(signal);
  if (due.kind !== 'ok') {
    return due.kind === 'not-found' ? { kind: 'failed' } : due;
  }
  const ids = [...new Set(due.value.questions.map(({ subjectId }) => subjectId))];
  const fetched = await Promise.all(ids.map(async (id) => [id, await fetchOutline(id, signal)] as const));
  if (fetched.some(([, outline]) => outline.kind === 'failed')) {
    return { kind: 'failed' };
  }
  // A subject removed between the two reads has nothing left to ask.
  const outlines = new Map(fetched.flatMap(([id, outline]) => (outline.kind === 'ok' ? [[id, outline.value] as const] : [])));
  return { kind: 'ok', value: { due: due.value, outlines } };
}

/** The review of everything: what was due in every subject when it opened, one question at a time, each named by its subject. */
export function ReviewEverythingPage({ language }: AppPageProps) {
  const { t } = useMessages();
  const { fetched, retry } = useFetched('review/everything', loadEverything);
  const home = { to: startPath(), label: t('all.home') };
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
  const { due, outlines } = fetched.value;
  const queue = due.questions.flatMap(({ subjectId, questionId }) => {
    const subject = outlines.get(subjectId);
    return subject === undefined ? [] : [{ subject, questionId }];
  });
  if (queue.length === 0) {
    return (
      <div className="sheet state review-done">
        <h2>{t('page.nothing.title')}</h2>
        <p>{Object.keys(due.subjects).length === 0 ? t('page.nothing.fresh') : t('page.nothing.body')}</p>
        <Link className="btn small" to={home.to}>
          {home.label}
        </Link>
      </div>
    );
  }
  return <Session language={language} queue={queue} home={home} namesSubject />;
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

/** One question of a session, in the subject that holds it. */
interface Asking {
  readonly subject: SubjectOutline;
  readonly questionId: string;
}

/** The same question id may be in two subjects, so a question in a session is known by both. */
const keyOf = ({ subject, questionId }: Asking): string => `${subject.id}/${questionId}`;

function Session({
  language,
  queue: opened,
  home,
  namesSubject,
}: {
  readonly language: Language;
  /** What was due when the session opened, in the order to ask it. */
  readonly queue: readonly Asking[];
  /** Where the session leads when it ends or is stopped. */
  readonly home: { readonly to: string; readonly label: string };
  /** Whether each question says which subject it is from, as it must when the session spans several. */
  readonly namesSubject: boolean;
}) {
  const { t, tc } = useMessages();
  const CheckStep = useCheckStep();
  const [queue, setQueue] = useState<readonly Asking[]>(opened);
  // Each time a question is asked counts as a new asking, so a question asked again is drawn afresh.
  const [asked, setAsked] = useState(0);
  const [answer, setAnswer] = useState<{ readonly correct: boolean } | undefined>();
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());

  const current = queue[0];
  const currentKey = current === undefined ? undefined : keyOf(current);
  const onAnswered = useCallback(
    (_questionId: string, correct: boolean) => {
      setAnswer({ correct });
      if (currentKey !== undefined) {
        setReviewed((before) => (before.has(currentKey) ? before : new Set(before).add(currentKey)));
      }
    },
    [currentKey],
  );

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

  if (current === undefined) {
    return (
      <output className="sheet state review-done">
        <h2>{t('page.done.title')}</h2>
        <p>{tc('page.done.body', reviewed.size)}</p>
        <Link className="btn" to={home.to}>
          {home.label}
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
        <p className="review-kind">{namesSubject ? t('all.kind', { subject: current.subject.title }) : t('page.kind')}</p>
        <Asked
          key={`${String(asked)}:${keyOf(current)}`}
          CheckStep={CheckStep}
          subject={current.subject}
          language={language}
          questionId={current.questionId}
          onAnswered={onAnswered}
        />
        {answer?.correct === false ? <p className="review-again">{t('page.again')}</p> : null}
      </article>
      <div className="review-nav">
        <span>
          <Link to={home.to}>{t('page.stop')}</Link> <span className="review-hint">{t('page.stop.hint')}</span>
        </span>
        <button type="button" className="btn" onClick={next} disabled={answer === undefined}>
          {last ? t('page.finish') : t('page.next')}
        </button>
      </div>
    </div>
  );
}
