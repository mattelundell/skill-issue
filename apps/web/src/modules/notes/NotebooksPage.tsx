import type { NotebookSummary, SubjectOutline, SubjectSummary } from '@skill-issue/contract';
import { useEffect, useMemo } from 'react';
import { fetchOutline, fetchSubjects } from '../../api.js';
import type { AppPageProps } from '../../shell/contract.js';
import { Link, subjectPath } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchNotebooks } from './api.js';
import { useMessages } from './messages.js';
import { placeOf } from './place.js';

interface Shelf {
  readonly subject: SubjectSummary;
  readonly notebook: NotebookSummary | undefined;
  readonly outline: SubjectOutline | undefined;
}

/** Every subject's notebook, reached from the start screen: how much is written, in which areas, and where last. */
export function NotebooksPage({ language }: AppPageProps) {
  const { t, tc } = useMessages();
  const load = useMemo(
    () =>
      async (signal: AbortSignal): Promise<{ readonly kind: 'ok'; readonly value: readonly Shelf[] } | { readonly kind: 'failed' }> => {
        const [subjects, notebooks] = await Promise.all([fetchSubjects(signal), fetchNotebooks(signal)]);
        if (subjects.kind !== 'ok' || notebooks.kind !== 'ok') {
          return { kind: 'failed' };
        }
        const shelves = await Promise.all(
          subjects.value.map(async (subject) => {
            const outline = await fetchOutline(subject.id, signal, language);
            return { subject, notebook: notebooks.value.notebooks.find((each) => each.subjectId === subject.id), outline: outline.kind === 'ok' ? outline.value : undefined };
          }),
        );
        return { kind: 'ok', value: shelves };
      },
    [language],
  );
  const { fetched } = useFetched(`notebooks/${language}`, load);
  useEffect(() => {
    // A page outside the subjects sets its own window title; the shell sets none for it.
    document.title = `${t('notebooks')} · Skill Issue`;
  }, [t]);

  return (
    <div className="notebooks">
      <h1 className="page-title">{t('notebooks')}</h1>
      <p className="lead">{t('books.lead')}</p>
      {fetched === undefined ? (
        <div className="sheet notes-list" aria-busy="true">
          <span className="sr">{t('loading')}</span>
          <div className="skeleton" />
        </div>
      ) : fetched.kind !== 'ok' ? (
        <p className="sheet state error" role="alert">
          {t('books.failed')}
        </p>
      ) : fetched.value.length === 0 ? (
        <p className="sheet state">{t('books.none')}</p>
      ) : (
        <ul className="books">
          {fetched.value.map(({ subject, notebook, outline }) => {
            const written = notebook?.written ?? 0;
            const last = notebook?.last;
            const place =
              last === undefined || outline === undefined
                ? undefined
                : last.kind === 'area'
                  ? outline.areas.find((area) => area.id === last.itemId)?.title
                  : placeOf(outline, last.itemId)?.lesson.title;
            const areasWritten = new Set(notebook?.areasWritten ?? []);
            return (
              <li key={subject.id} className="sheet book">
                <div>
                  <h2>{subject.title}</h2>
                  <p>
                    {tc('written', written)}
                    {place === undefined ? '' : ` · ${t('books.last', { place })}`}
                  </p>
                </div>
                <Link className={written > 0 ? 'btn small' : 'btn small quiet'} to={subjectPath(subject.id, 'notes')}>
                  {t('books.open')}
                </Link>
                {outline === undefined ? null : (
                  <p className="areas-mini">
                    {outline.areas.map((area) => (
                      <span key={area.id} className={areasWritten.has(area.id) ? 'has' : undefined}>
                        {area.title}
                      </span>
                    ))}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** On the start screen, under the subjects: the way to every notebook. */
export function NotebooksLine({ subjects }: { readonly subjects: readonly SubjectSummary[] }) {
  const { t } = useMessages();
  const load = useMemo(() => async (signal: AbortSignal) => fetchNotebooks(signal), []);
  const { fetched } = useFetched('notebooks', load);
  if (subjects.length === 0) {
    return null;
  }
  const some = fetched?.kind === 'ok' ? fetched.value.notebooks.filter((notebook) => notebook.written > 0).length : 0;
  return (
    <p className="notebooks-line">
      <Link to="/notes">{t('line')}</Link>
      {some === 0 ? null : <span> · {t('line.some', { count: String(some) })}</span>}
    </p>
  );
}
