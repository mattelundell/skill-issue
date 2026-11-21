import { useMemo } from 'react';
import type { SubjectProps } from '../../shell/contract.js';
import { useI18n } from '../../shell/i18n.js';
import { Link, subjectPath } from '../../shell/router.js';
import { fetchLibrary } from './api.js';
import { firstDifference } from './format.js';
import { useMessages } from './messages.js';
import { useFetched } from './useFetched.js';

/** How many publishers the block names before it counts the rest. */
const NAMED_PUBLISHERS = 2;

/** On the subject home: how many sources the subject has, from whom, and the way into the library. */
export function MaterialBlock({ subject }: SubjectProps) {
  const { t, tc } = useMessages();
  const { list } = useI18n();
  const load = useMemo(() => async (signal: AbortSignal) => fetchLibrary(subject.id, signal), [subject.id]);
  const { fetched } = useFetched(subject.id, load);

  let body: string | undefined;
  if (fetched?.kind === 'ok') {
    const { sources } = fetched.value;
    const counts = new Map<string, number>();
    for (const source of sources) {
      counts.set(source.publisher, (counts.get(source.publisher) ?? 0) + 1);
    }
    const ranked = [...counts].toSorted(([a, x], [b, y]) => firstDifference(y - x, a.localeCompare(b))).map(([name]) => name);
    const named = ranked.length <= NAMED_PUBLISHERS + 1 ? ranked : [...ranked.slice(0, NAMED_PUBLISHERS), tc('block.others', ranked.length - NAMED_PUBLISHERS)];
    body = sources.length === 0 ? t('block.none') : t('block.from', { sources: tc('library.count', sources.length), publishers: list(named) });
  } else if (fetched !== undefined) {
    body = t('block.failed');
  }

  return (
    <div className="sheet">
      <h2>{t('tab')}</h2>
      {body === undefined ? null : <p>{body}</p>}
      <Link to={subjectPath(subject.id, 'reader')}>{t('block.open')}</Link>
    </div>
  );
}
