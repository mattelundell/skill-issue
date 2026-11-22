import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PageProps } from '../../shell/contract.js';
import { useLessonLink } from '../../shell/contributions.js';
import { useI18n } from '../../shell/i18n.js';
import { Link } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchNotebook, notebookZipUrl } from './api.js';
import { Composer } from './Composer.js';
import { useMessages } from './messages.js';
import { shelves, type Place } from './notebook.js';
import { Contents } from './NotebookSpread.js';
import { NoteText } from './NoteText.js';
import { NOTE_KEY } from './place.js';
import { useSections } from './save.js';

/** How long typing in the search must pause before the server is asked. */
export const SEARCH_AFTER_MS = 250;

/**
 * A subject's notebook read as one document: its contents beside it, every
 * section writable where it stands, a search, and an export as Markdown files
 * or, through the browser's printing, as a PDF.
 */
export function NotebookPage({ subject }: PageProps) {
  const { t } = useMessages();
  const { language } = useI18n();
  const lessonLink = useLessonLink();
  const load = useMemo(() => async (signal: AbortSignal) => fetchNotebook(subject.id, '', signal), [subject.id]);
  const { fetched, retry } = useFetched(`${subject.id}/notebook`, load);
  const { texts, statuses, change, flush } = useSections(subject.id, fetched?.kind === 'ok' ? fetched.value.sections : undefined);

  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const wait = setTimeout(() => setQuery(typed.trim()), SEARCH_AFTER_MS);
    return () => clearTimeout(wait);
  }, [typed]);
  // The search is the server's, so a word is matched from its start as it is everywhere else; what matches is kept to the sections it names.
  const searchLoad = useMemo(() => async (signal: AbortSignal) => fetchNotebook(subject.id, query, signal), [subject.id, query]);
  const { fetched: searched } = useFetched(`${subject.id}/notebook?${query}`, searchLoad);
  const matching = query === '' || searched?.kind !== 'ok' ? undefined : new Set(searched.value.sections.map((section) => `${section.kind}/${section.itemId}`));

  const [onlyWritten, setOnlyWritten] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const written = useMemo(() => new Map([...(texts ?? new Map<string, string>())].filter(([, body]) => body.trim() !== '')), [texts]);
  const laid = useMemo(() => shelves(subject, written.keys(), t('gone')), [subject, written, t]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(subject.areas.map((area) => area.id)));
  const article = useRef<HTMLElement>(null);

  const goTo = useCallback((key: string) => {
    article.current?.querySelector(`[data-section="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'start' });
  }, []);
  const titleOf = useCallback((place: Place): string => place.title ?? (place.kind === 'area' ? t('area.own') : t('gone.lesson', { id: place.itemId })), [t]);

  if (fetched !== undefined && fetched.kind !== 'ok') {
    return (
      <div className="sheet state error" role="alert">
        <h2>{t('browse.failed.title')}</h2>
        <p>{t('browse.failed.body')}</p>
        <button type="button" className="btn quiet small" onClick={retry}>
          {t('retry')}
        </button>
      </div>
    );
  }
  if (texts === undefined) {
    return (
      <div className="sheet notes-list" aria-busy="true">
        <span className="sr">{t('loading')}</span>
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }

  const shown = laid
    .map((shelf) => ({ ...shelf, places: shelf.places.filter((place) => (!onlyWritten || written.has(place.key)) && (matching === undefined || matching.has(place.key))) }))
    .filter((shelf) => shelf.places.length > 0);

  return (
    <div className="notebook-page">
      {written.size === 0 ? (
        <div className="sheet state">
          <h2>{t('browse.empty.title')}</h2>
          <p>{t('browse.empty.body', { key: NOTE_KEY.toUpperCase() })}</p>
        </div>
      ) : null}
      <div className="nb-tools">
        <label className="notes-search">
          <span className="sr">{t('browse.search')}</span>
          <input type="search" value={typed} placeholder={t('browse.search')} onChange={(event) => setTyped(event.target.value)} />
        </label>
        <label className="only-written">
          <input type="checkbox" checked={onlyWritten} onChange={(event) => setOnlyWritten(event.target.checked)} /> {t('browse.only')}
        </label>
        <button type="button" className="btn small" onClick={() => setExporting(true)}>
          {t('browse.export')}
        </button>
      </div>
      <div className="nb-layout">
        <nav className="sheet nb-contents" aria-label={t('contents')}>
          <Contents shelves={laid} written={written} open={open} setOpen={setOpen} at={undefined} here={undefined} goTo={goTo} titleOf={titleOf} />
        </nav>
        <article className="sheet nb-document" ref={article} data-only-written={onlyWritten || matching !== undefined ? 'true' : undefined}>
          {shown.length === 0 ? <p className="empty-sec">{t('browse.no-match', { query })}</p> : null}
          {shown.map((shelf) => (
            <section key={shelf.areaId ?? ''} className="doc-area" aria-label={shelf.title}>
              <h2>{shelf.title}</h2>
              {shelf.places.map((place) => {
                const body = texts.get(place.key) ?? '';
                const isEditing = editing === place.key;
                return (
                  <div key={place.key} className={`doc-sec${place.kind === 'area' ? ' area-note' : ''}${body.trim() === '' ? ' empty' : ''}`} data-section={place.key}>
                    <header>
                      <h3>
                        {place.kind === 'lesson' && place.title !== undefined && lessonLink !== undefined ? <Link to={lessonLink(subject.id, place.itemId)}>{titleOf(place)}</Link> : titleOf(place)}
                      </h3>
                      <button
                        type="button"
                        className="link-button edit"
                        onClick={() => {
                          flush();
                          setEditing(isEditing ? undefined : place.key);
                        }}
                      >
                        {isEditing ? t('browse.done') : body.trim() === '' ? t('browse.write') : t('browse.edit')}
                      </button>
                    </header>
                    {isEditing ? (
                      <Composer
                        subjectId={subject.id}
                        value={body}
                        onChange={(next) => change(place, next)}
                        label={t('field', { place: titleOf(place) })}
                        status={statuses.get(place.key) ?? 'kept'}
                        rows={8}
                        caretAtEnd
                        onEscape={() => {
                          flush();
                          setEditing(undefined);
                        }}
                      />
                    ) : body.trim() === '' ? null : (
                      <NoteText subjectId={subject.id} body={body} below={3} />
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </article>
      </div>
      {exporting ? <ExportDialog subjectId={subject.id} contentLanguage={subject.language} interfaceLanguage={language} onClose={() => setExporting(false)} /> : null}
    </div>
  );
}

/** The two ways out: Markdown files with their images in a zip, or a PDF through the browser's own printing. */
function ExportDialog({ subjectId, contentLanguage, interfaceLanguage, onClose }: { readonly subjectId: string; readonly contentLanguage: string; readonly interfaceLanguage: string; readonly onClose: () => void }) {
  const { t } = useMessages();
  const dialog = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<'zip' | 'pdf'>('zip');
  // A browser without the dialog element's own closing takes it down through the page instead.
  const closeDialog = (): void => {
    if (typeof dialog.current?.close === 'function') {
      dialog.current.close();
    } else {
      onClose();
    }
  };
  useEffect(() => {
    const shown = dialog.current;
    if (shown !== null && !shown.open) {
      // A modal dialog keeps the focus inside it and closes on Escape; a browser without one shows it in place.
      if (typeof shown.showModal === 'function') {
        shown.showModal();
      } else {
        shown.setAttribute('open', '');
      }
    }
  }, []);
  return (
    <dialog ref={dialog} className="export-dialog" aria-labelledby="export-h" onClose={onClose}>
      <h2 id="export-h">{t('export.title')}</h2>
      <div className="choices" role="radiogroup">
        <label className="choice">
          <input type="radio" name="format" checked={format === 'zip'} onChange={() => setFormat('zip')} />
          <b>{t('export.zip')}</b>
          <small>{t('export.zip.body')}</small>
        </label>
        <label className="choice">
          <input type="radio" name="format" checked={format === 'pdf'} onChange={() => setFormat('pdf')} />
          <b>{t('export.pdf')}</b>
          <small>{t('export.pdf.body')}</small>
        </label>
      </div>
      <footer>
        <button type="button" className="btn quiet" onClick={closeDialog}>
          {t('export.cancel')}
        </button>
        {format === 'zip' ? (
          <a className="btn" href={notebookZipUrl(subjectId, contentLanguage, interfaceLanguage)} download onClick={closeDialog}>
            {t('export.go')}
          </a>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => {
              closeDialog();
              // After the dialog has gone, so it is not printed with the notebook.
              setTimeout(() => window.print(), 0);
            }}
          >
            {t('export.go')}
          </button>
        )}
      </footer>
    </dialog>
  );
}
