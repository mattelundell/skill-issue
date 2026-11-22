import type { Note, SubjectOutline } from '@skill-issue/contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PageProps } from '../../shell/contract.js';
import { useLessonLink } from '../../shell/contributions.js';
import { useI18n } from '../../shell/i18n.js';
import { Markdown } from '../../shell/markdown.js';
import { Link } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchNotes, notesFileUrl } from './api.js';
import { useMessages } from './messages.js';
import { NOTE_KEY } from './place.js';

/** How long typing in the search must pause before the server is asked. */
export const SEARCH_AFTER_MS = 250;

/** One lesson's notes, in step order, under its area. */
interface Filed {
  readonly lessonId: string;
  readonly title: string | undefined;
  readonly notes: readonly Note[];
}

interface Shelf {
  readonly heading: string;
  readonly lessons: readonly Filed[];
}

/**
 * The notes filed the way the subject is laid out: by area and lesson in the
 * order of the path, each lesson's notes in step order. Notes on a lesson the
 * subject no longer holds come last, under a heading of their own.
 */
function shelve(subject: SubjectOutline, notes: readonly Note[], goneHeading: string): readonly Shelf[] {
  const byLesson = Map.groupBy(notes, (note) => note.lessonId);
  const inStepOrder = (lessonId: string): readonly Note[] => (byLesson.get(lessonId) ?? []).toSorted((a, b) => a.step - b.step);
  const held = new Set(subject.areas.flatMap((area) => area.lessons.map((lesson) => lesson.id)));
  const shelves: Shelf[] = subject.areas.flatMap((area) => {
    const lessons = area.lessons.filter((lesson) => byLesson.has(lesson.id)).map((lesson) => ({ lessonId: lesson.id, title: lesson.title, notes: inStepOrder(lesson.id) }));
    return lessons.length === 0 ? [] : [{ heading: area.title, lessons }];
  });
  const gone = [...byLesson.keys()].filter((lessonId) => !held.has(lessonId)).toSorted();
  if (gone.length > 0) {
    shelves.push({ heading: goneHeading, lessons: gone.map((lessonId) => ({ lessonId, title: undefined, notes: inStepOrder(lessonId) })) });
  }
  return shelves;
}

/** The Notes tab: every note in the subject, filed by area and lesson, searchable as text, each linking back to its step. */
export function NotesPage({ subject }: PageProps) {
  const { t, tc } = useMessages();
  const { language } = useI18n();
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const wait = setTimeout(() => setQuery(typed.trim()), SEARCH_AFTER_MS);
    return () => clearTimeout(wait);
  }, [typed]);

  // "/" goes to the search box from anywhere on the page, as in the material; typed into a field, it is just a character.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const load = useMemo(() => async (signal: AbortSignal) => fetchNotes(subject.id, { query }, signal), [subject.id, query]);
  const { fetched, retry } = useFetched(`${subject.id}?${query}`, load);
  // The answer before the one in flight stays on screen while the next is fetched, so typing does not blank the page.
  const [shown, setShown] = useState<{ readonly query: string; readonly notes: readonly Note[] }>();
  if (fetched?.kind === 'ok' && (shown?.query !== query || shown.notes !== fetched.value.notes)) {
    setShown({ query, notes: fetched.value.notes });
  }
  const clear = useCallback(() => {
    setTyped('');
    setQuery('');
  }, []);

  if (fetched !== undefined && fetched.kind !== 'ok') {
    return (
      <div className="sheet state error" role="alert">
        <h2>{t('browse.failed.title')}</h2>
        <p>{t('browse.failed.body')}</p>
        <button type="button" className="btn quiet small" onClick={retry}>
          {t('pane.retry')}
        </button>
      </div>
    );
  }
  if (shown === undefined) {
    return (
      <div className="sheet notes-list" aria-busy="true">
        <span className="sr">{t('browse.loading')}</span>
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }
  if (shown.query === '' && shown.notes.length === 0) {
    return (
      <div className="sheet state">
        <h2>{t('browse.empty.title')}</h2>
        <p>{t('browse.empty.body', { key: NOTE_KEY.toUpperCase() })}</p>
      </div>
    );
  }

  return (
    <div className="notes-page">
      <div className="notes-toolbar">
        <label className="notes-search">
          <span className="sr">{t('browse.search')}</span>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="7" cy="7" r="5" />
            <path d="m11 11 3.5 3.5" />
          </svg>
          <input ref={search} type="search" value={typed} placeholder={t('browse.search.placeholder')} onChange={(event) => setTyped(event.target.value)} />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <a className="btn quiet small notes-export" href={notesFileUrl(subject.id, subject.language, language)} download>
          {t('browse.export')}
        </a>
      </div>
      {shown.notes.length === 0 ? (
        <>
          <output className="notes-count">{t('browse.no-match', { query: shown.query })}</output>
          <div className="sheet state">
            <p>{t('browse.no-match.hint')}</p>
            <button type="button" className="btn quiet small" onClick={clear}>
              {t('browse.show-all')}
            </button>
          </div>
        </>
      ) : (
        <>
          <output className="notes-count">
            {shown.query === '' ? tc('browse.count', shown.notes.length) : tc('browse.matches', shown.notes.length).replace('{query}', shown.query)}
          </output>
          {shelve(subject, shown.notes, t('browse.gone')).map((shelf) => (
            <section key={shelf.heading} className="notes-area" aria-label={shelf.heading}>
              <h2>{shelf.heading}</h2>
              {shelf.lessons.map((filed) => (
                <LessonNotes key={filed.lessonId} subject={subject} filed={filed} />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function LessonNotes({ subject, filed }: { readonly subject: SubjectOutline; readonly filed: Filed }) {
  const { t } = useMessages();
  const { language } = useI18n();
  const lessonLink = useLessonLink();
  const imageText = useCallback((alt: string) => t('image', { alt }), [t]);
  const day = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'medium' }), [language]);
  const title = filed.title ?? t('browse.gone.lesson', { id: filed.lessonId });
  return (
    <article className="sheet notes-lesson" aria-label={title}>
      <h3>{title}</h3>
      <ol>
        {filed.notes.map((note) => {
          const stepName = t('browse.step', { step: String(note.step + 1) });
          // A lesson the subject no longer holds has no step to go back to.
          const linked = filed.title !== undefined && lessonLink !== undefined;
          return (
            <li key={note.step} className="note">
              <p className="note-head">
                {linked ? <Link to={lessonLink(subject.id, filed.lessonId, note.step)}>{stepName}</Link> : <b>{stepName}</b>}
                <span>{t('browse.written', { date: day.format(new Date(note.updatedAt)) })}</span>
              </p>
              <Markdown className="note-body" source={note.body} subjectId={subject.id} imageText={imageText} />
            </li>
          );
        })}
      </ol>
    </article>
  );
}
