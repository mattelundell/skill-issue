import type { SubjectSummary } from '@skill-issue/contract';
import { useCallback, useEffect, useMemo } from 'react';
import type { Language } from '../../i18n/index.js';
import type { SubjectProps } from '../../shell/contract.js';
import { usePolled } from '../../shell/poll.js';
import { Link, subjectPath } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchPositions, fetchResume } from './api.js';
import { suggestionFor } from './progress.js';
import { useMessages } from './messages.js';

/** Above the start screen's rows: where the learner left off, or the next lesson when the last one was gone through. */
export function ResumePanel({
  subjects,
  onShows,
}: {
  readonly subjects: readonly SubjectSummary[];
  readonly language: Language;
  readonly onShows: (subjectId: string | undefined) => void;
}) {
  const { t } = useMessages();
  const load = useCallback(async (signal: AbortSignal) => fetchResume(signal), []);
  const { value } = usePolled(load);
  const offer = value?.kind === 'ok' ? value.value.offer : null;
  const subject = offer === null ? undefined : subjects.find((candidate) => candidate.id === offer.subjectId);
  const shown = offer !== null && subject !== undefined ? offer : null;

  useEffect(() => onShows(shown?.subjectId), [onShows, shown?.subjectId]);

  if (shown === null || subject === undefined) {
    return null;
  }
  const to = subjectPath(shown.subjectId, 'lessons', [shown.lessonId]);
  return (
    <section className="sheet resume" aria-labelledby="resume-h">
      <div>
        <p className="where">{shown.kind === 'continue' ? t('panel.continue') : t('panel.next')}</p>
        {/* The subject's name opens its overview, as a name in the list below does: the button goes on with the lesson. */}
        <h2 id="resume-h">
          <Link to={subjectPath(subject.id)}>{subject.title}</Link>
        </h2>
        <p className="lesson">
          {t('panel.where', { area: shown.areaTitle, lesson: shown.title })}
          {shown.kind === 'continue' ? `, ${t('panel.step', { step: String(shown.step + 1), steps: String(shown.steps) })}` : ''}
        </p>
        {shown.kind === 'continue' ? (
          <div className="steps" aria-hidden="true">
            {Array.from({ length: shown.steps }, (_, index) => (
              <i key={index} className={index <= shown.step ? 'on' : undefined} />
            ))}
          </div>
        ) : null}
      </div>
      <Link className="btn" to={to}>
        {shown.kind === 'continue' ? t('panel.continue.action') : t('panel.next.action')}
      </Link>
    </section>
  );
}

/** On the subject home, above the path: carry on with the lesson left midway, or begin the first not yet gone through. */
export function ContinueBlock({ subject }: SubjectProps) {
  const { t } = useMessages();
  const load = useMemo(() => async (signal: AbortSignal) => fetchPositions(subject.id, signal), [subject.id]);
  const { fetched } = useFetched(subject.id, load);
  if (fetched?.kind !== 'ok') {
    return null;
  }
  const suggestion = suggestionFor(subject, fetched.value.lessons);
  if (suggestion === undefined) {
    return null;
  }
  const to = subjectPath(subject.id, 'lessons', [suggestion.lesson.id]);
  const heading =
    suggestion.kind === 'continue'
      ? t('block.continue', { lesson: suggestion.lesson.title })
      : suggestion.kind === 'begin'
        ? t('block.begin', { lesson: suggestion.lesson.title })
        : t('block.next', { lesson: suggestion.lesson.title });
  return (
    <div className="sheet due slim">
      <div>
        <h2>{heading}</h2>
        <p>{suggestion.kind === 'continue' ? t('block.where', { area: suggestion.area, step: String(suggestion.step), steps: String(suggestion.steps) }) : t('block.area', { area: suggestion.area })}</p>
      </div>
      <Link className="btn small" to={to}>
        {suggestion.kind === 'continue' ? t('panel.continue.action') : t('panel.next.action')}
      </Link>
    </div>
  );
}
