import { useMemo } from 'react';
import type { SubjectProps } from '../../shell/contract.js';
import { Link, subjectPath } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchNotes } from './api.js';
import { useMessages } from './messages.js';
import { placeOf } from './place.js';

/** On the subject home: how many notes the subject has, where the latest was written, and the way to them all. */
export function NotesBlock({ subject }: SubjectProps) {
  const { t, tc } = useMessages();
  const load = useMemo(() => async (signal: AbortSignal) => fetchNotes(subject.id, {}, signal), [subject.id]);
  const { fetched } = useFetched(subject.id, load);

  let body: string | undefined;
  let some = false;
  if (fetched?.kind === 'ok') {
    const { notes } = fetched.value;
    const latest = notes[0];
    some = latest !== undefined;
    body = latest === undefined ? t('block.none') : t('block.some', { count: tc('browse.count', notes.length), lesson: placeOf(subject, latest.lessonId)?.lesson.title ?? latest.lessonId });
  } else if (fetched !== undefined) {
    body = t('block.failed');
  }

  return (
    <div className="sheet">
      <h2>{t('tab')}</h2>
      {body === undefined ? null : <p>{body}</p>}
      {some ? <Link to={subjectPath(subject.id, 'notes')}>{t('block.open')}</Link> : null}
    </div>
  );
}
