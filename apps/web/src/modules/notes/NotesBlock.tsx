import { useMemo } from 'react';
import type { SubjectProps } from '../../shell/contract.js';
import { Link, subjectPath } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchNotebook } from './api.js';
import { useMessages } from './messages.js';
import { NOTE_KEY, placeOf } from './place.js';

/** On the subject home: how much of the notebook is written, where last, and the way to it. */
export function NotesBlock({ subject }: SubjectProps) {
  const { t, tc } = useMessages();
  const load = useMemo(() => async (signal: AbortSignal) => fetchNotebook(subject.id, '', signal), [subject.id]);
  const { fetched } = useFetched(`${subject.id}/notebook`, load);

  let body: string | undefined;
  if (fetched?.kind === 'ok') {
    const [latest] = fetched.value.sections;
    const where =
      latest === undefined
        ? undefined
        : latest.kind === 'area'
          ? (subject.areas.find((area) => area.id === latest.itemId)?.title ?? latest.itemId)
          : (placeOf(subject, latest.itemId)?.lesson.title ?? latest.itemId);
    body = where === undefined ? t('block.none', { key: NOTE_KEY.toUpperCase() }) : t('block.some', { count: tc('written', fetched.value.sections.length), place: where });
  } else if (fetched !== undefined) {
    body = t('block.failed');
  }

  return (
    <div className="sheet">
      <h2>{t('notebook')}</h2>
      {body === undefined ? null : <p>{body}</p>}
      <Link to={subjectPath(subject.id, 'notes')}>{t('block.open')}</Link>
    </div>
  );
}
