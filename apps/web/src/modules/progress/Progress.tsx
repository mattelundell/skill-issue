import type { DayProgress, SubjectProgress, SubjectSummary } from '@skill-issue/contract';
import { useCallback, useMemo } from 'react';
import type { Language } from '../../i18n/index.js';
import type { LessonMark, PageProps } from '../../shell/contract.js';
import { useLessonLink } from '../../shell/contributions.js';
import { usePolled } from '../../shell/poll.js';
import { Link } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchProgress, percent } from './api.js';
import { useMessages } from './messages.js';

/** A day as YYYY-MM-DD, said short the way the interface language says it. */
const dayWords = (day: string, language: Language): string =>
  new Intl.DateTimeFormat(language === 'sv' ? 'sv-SE' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

/** A share drawn as a bar, beside its figure; the figure is what is read out. */
function Meter({ share }: { readonly share: number }) {
  return (
    <span className="bar" aria-hidden="true">
      <i style={{ width: `${String(Math.floor(share * 100))}%` }} />
    </span>
  );
}

/** Answers per day as columns and the subject's recall at each day's end as a line over them; each day is named for a screen reader. */
function Days({ days, language }: { readonly days: readonly DayProgress[]; readonly language: Language }) {
  const { t, tc } = useMessages();
  const most = Math.max(1, ...days.map((day) => day.answers));
  const width = 100 / days.length;
  const line = days.map((day, index) => `${(index + 0.5) * width},${String(100 - day.recall * 100)}`).join(' ');
  return (
    <figure className="progress-days">
      <div className="progress-chart">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {days.map((day, index) => (day.answers === 0 ? null : <rect key={day.day} className="answers" x={index * width + width * 0.15} width={width * 0.7} y={100 - (day.answers / most) * 100} height={(day.answers / most) * 100} />))}
          <polyline className="recall" points={line} vectorEffect="non-scaling-stroke" />
        </svg>
        <ol className="progress-day-list">
          {days.map((day) => (
            <li key={day.day}>{t('time.day', { day: dayWords(day.day, language), answers: tc('time.answers', day.answers), correct: String(day.correct), recall: percent(day.recall, language) })}</li>
          ))}
        </ol>
      </div>
      <figcaption>
        <span className="key answers">{t('time.legend.answers')}</span>
        <span className="key recall">{t('time.legend.recall')}</span>
        <span className="span">
          {dayWords(days[0]?.day ?? '', language)} – {dayWords(days.at(-1)?.day ?? '', language)}
        </span>
      </figcaption>
    </figure>
  );
}

function Shown({ progress, subject, language }: { readonly progress: SubjectProgress } & Pick<PageProps, 'subject' | 'language'>) {
  const { t, tc } = useMessages();
  const lessonLink = useLessonLink();
  const titles = useMemo(() => new Map(subject.areas.flatMap((area) => [[`area:${area.id}`, area.title], ...area.lessons.map((lesson) => [`lesson:${lesson.id}`, lesson.title] as const)])), [subject]);
  const lessonName = (lessonId: string) => {
    const title = titles.get(`lesson:${lessonId}`) ?? lessonId;
    return lessonLink === undefined ? title : <Link to={lessonLink(subject.id, lessonId)}>{title}</Link>;
  };

  if (progress.met === 0) {
    return (
      <div className="sheet progress-empty">
        <h2>{t('empty.title')}</h2>
        <p>{t('empty.body')}</p>
      </div>
    );
  }

  const answers = progress.days.reduce((sum, day) => sum + day.answers, 0);
  const correct = progress.days.reduce((sum, day) => sum + day.correct, 0);
  const from = progress.days[0]?.recall ?? 0;
  const to = progress.days.at(-1)?.recall ?? 0;

  return (
    <>
      <section className="sheet progress-summary" aria-labelledby="progress-recall">
        <p id="progress-recall" className="progress-big">
          <b>{percent(progress.recall ?? 0, language)}</b> {t('summary.recall')}
        </p>
        <p>{t('summary.met', { met: String(progress.met), questions: String(progress.questions) })}</p>
        <p className="progress-note">{t('summary.target', { target: percent(progress.target, language) })}</p>
      </section>

      <section className="sheet progress-mastery" aria-labelledby="progress-mastery">
        <h2 id="progress-mastery">{t('mastery.title')}</h2>
        {progress.areas.map((area) => (
          <section key={area.areaId} className="progress-area" aria-label={titles.get(`area:${area.areaId}`) ?? area.areaId}>
            <h3>
              <span>{titles.get(`area:${area.areaId}`) ?? area.areaId}</span>
              {area.recall === null ? <span className="progress-figure">{t('mastery.none')}</span> : <span className="progress-figure meter"><Meter share={area.recall} />{percent(area.recall, language)}</span>}
            </h3>
            <ul>
              {area.lessons.map((lesson) => (
                <li key={lesson.lessonId} className={lesson.mastered ? 'mastered' : lesson.passed ? 'passed' : undefined}>
                  <span className="progress-lesson">{lessonName(lesson.lessonId)}</span>
                  {lesson.mastered ? <span className="state-word mastered">{t('lesson.mastered')}</span> : lesson.passed ? <span className="state-word passed">{t('lesson.passed')}</span> : null}
                  {lesson.recall === null ? <span className="progress-figure">{t('mastery.none')}</span> : <span className="progress-figure meter"><Meter share={lesson.recall} />{percent(lesson.recall, language)}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>

      <section className="sheet progress-time" aria-labelledby="progress-time">
        <h2 id="progress-time">{t('time.title')}</h2>
        {answers === 0 ? (
          <p>{t('time.summary.none', { days: String(progress.days.length) })}</p>
        ) : (
          <>
            <p>
              {t('time.summary', { days: String(progress.days.length), answers: tc('time.answers', answers), correct: percent(correct / answers, language) })}{' '}
              {t('time.recall', { from: percent(from, language), to: percent(to, language) })}
            </p>
            <Days days={progress.days} language={language} />
          </>
        )}
      </section>

      <section className="sheet progress-weak" aria-labelledby="progress-weak">
        <h2 id="progress-weak">{t('weak.title')}</h2>
        {progress.weakSpots.length === 0 ? (
          <p>{t('weak.none')}</p>
        ) : (
          <ol>
            {progress.weakSpots.map((spot) => (
              <li key={spot.concept}>
                <b>{spot.name}</b>
                <span className="progress-figure">{t('weak.line', { wrong: String(spot.wrong), answers: tc('time.answers', spot.answers) })}</span>
                <span className="progress-lesson">{lessonName(spot.lessonId)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

/** The Progress tab: what the learner remembers, by area and lesson, how it has moved, and where they go wrong most. */
export function ProgressPage({ subject, language }: PageProps) {
  const { t } = useMessages();
  // Asked in the language the subject is read in, so its weak spots are named in it, and asked again when that changes.
  const load = useCallback(async (signal: AbortSignal) => fetchProgress(subject.id, subject.language, signal), [subject.id, subject.language]);
  const { fetched, retry } = useFetched(`${subject.id}/${subject.language}`, load);

  if (fetched === undefined) {
    return <p className="progress-loading">{t('loading')}</p>;
  }
  if (fetched.kind !== 'ok') {
    return (
      <div className="sheet" role="alert">
        <h2>{t('failed.title')}</h2>
        <p>{t('failed.body')}</p>
        <button type="button" className="btn" onClick={retry}>
          {t('retry')}
        </button>
      </div>
    );
  }
  return (
    <div className="progress">
      <Shown progress={fetched.value} subject={subject} language={language} />
    </div>
  );
}

/** On a subject's row on the start screen: how much of the subject the learner remembers now. Nothing before a question has been answered. */
export function RecallFigure({ subject, language }: { readonly subject: SubjectSummary; readonly language: Language }) {
  const { t } = useMessages();
  // Figures only: no concept is named here, so the subject's own language serves.
  const load = useCallback(async (signal: AbortSignal) => fetchProgress(subject.id, undefined, signal), [subject.id]);
  const { value } = usePolled(load);
  if (value?.kind !== 'ok' || value.value.met === 0 || value.value.recall === null) {
    return null;
  }
  return <span className="progress-figure">{t('figure.recall', { recall: percent(value.value.recall, language) })}</span>;
}

/** The lessons that are mastered now. Passed and begun are for the modules that know them. */
export async function masteredMarks(subjectId: string, signal: AbortSignal): Promise<ReadonlyMap<string, LessonMark>> {
  const progress = await fetchProgress(subjectId, undefined, signal);
  if (progress.kind !== 'ok') {
    throw new Error('progress could not be read');
  }
  return new Map(progress.value.areas.flatMap((area) => area.lessons.filter((lesson) => lesson.mastered).map((lesson) => [lesson.lessonId, { state: 'mastered' as const }])));
}
