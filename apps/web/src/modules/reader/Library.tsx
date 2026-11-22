import type { LibrarySource, SourceLibrary } from '@skill-issue/contract';
import { useEffect, useMemo, useRef, useState } from 'react';
import { plainText } from '../../shell/markdown.js';
import { Link } from '../../shell/router.js';
import { WithCode } from '../../shell/text.js';
import { useI18n } from '../../shell/i18n.js';
import type { PageProps } from '../../shell/contract.js';
import { fetchLibrary } from './api.js';
import { firstDifference, formatDay } from './format.js';
import { useMessages } from './messages.js';
import { findAt, snippet } from './search.js';
import { useFetched } from '../../shell/useFetched.js';

const ORDERS = ['cited', 'title', 'read'] as const;
type Order = (typeof ORDERS)[number];
const isOrder = (value: unknown): value is Order => ORDERS.some((order) => order === value);

/** How much of the subject rests on a source, most first: lessons, then questions, then terms. Ties keep the pack's order. */
const byUse = (a: LibrarySource, b: LibrarySource): number =>
  firstDifference(b.cited.lessons - a.cited.lessons, b.cited.questions - a.cited.questions, b.cited.terms - a.cited.terms);

/** The subject's source library: every source, searchable, filterable by publisher, in a chosen order. */
export function Library({ subject, pathTo }: PageProps) {
  const { t } = useMessages();
  const load = useMemo(() => async (signal: AbortSignal) => fetchLibrary(subject.id, subject.language, signal), [subject.id, subject.language]);
  const { fetched, retry } = useFetched(`${subject.id}/${subject.language}`, load);

  if (fetched === undefined) {
    return (
      <div className="sheet library" aria-busy="true">
        <span className="sr">{t('loading')}</span>
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }
  if (fetched.kind !== 'ok') {
    return (
      <div className="sheet state error" role="alert">
        <h2>{t('library.failed.title')}</h2>
        <p>{t('library.failed.body')}</p>
        <button type="button" className="btn quiet small" onClick={retry}>
          {t('retry')}
        </button>
      </div>
    );
  }
  if (fetched.value.sources.length === 0) {
    return (
      <div className="sheet state">
        <h2>{t('library.empty.title')}</h2>
        <p>
          <WithCode text={t('library.empty.body')} placeholder="folder" code="sources/" />
        </p>
      </div>
    );
  }
  return <Shelf library={fetched.value} pathTo={pathTo} />;
}

function Shelf({ library, pathTo }: { readonly library: SourceLibrary; readonly pathTo: PageProps['pathTo'] }) {
  const { t, tc } = useMessages();
  const { language } = useI18n();
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<Order>('cited');
  const [publisher, setPublisher] = useState<string>();
  const search = useRef<HTMLInputElement>(null);

  // "/" goes to the search box from anywhere on the page, as in most readers; typed into a field, it is just a character.
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

  const texts = useMemo(() => new Map(library.sources.map((source) => [source.id, plainText(source.body)])), [library]);
  const publishers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const source of library.sources) {
      counts.set(source.publisher, (counts.get(source.publisher) ?? 0) + 1);
    }
    return [...counts].toSorted(([a, x], [b, y]) => firstDifference(y - x, a.localeCompare(b, language)));
  }, [library, language]);

  const trimmed = query.trim();
  const matching = library.sources.filter(
    (source) =>
      (publisher === undefined || source.publisher === publisher) &&
      (trimmed === '' || [source.title, source.publisher, texts.get(source.id) ?? ''].some((text) => findAt(text, trimmed) >= 0)),
  );
  const shown = matching.toSorted((a, b) => {
    switch (order) {
      case 'cited':
        return byUse(a, b);
      case 'title':
        return a.title.localeCompare(b.title, language);
      case 'read':
        return b.accessed.localeCompare(a.accessed);
      default: {
        const unhandled: never = order;
        return unhandled;
      }
    }
  });

  const count =
    trimmed !== ''
      ? t('library.matches', { shown: String(shown.length), total: tc('library.count', publisher === undefined ? library.sources.length : (publishers.find(([name]) => name === publisher)?.[1] ?? 0)), query: trimmed })
      : publisher === undefined
        ? tc('library.count', shown.length)
        : t('library.count.from', { count: tc('library.count', shown.length), publisher });

  return (
    <>
      <div className="toolbar">
        <label className="search">
          <span className="sr">{t('library.search')}</span>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="7" cy="7" r="5" />
            <path d="m11 11 3.5 3.5" />
          </svg>
          <input ref={search} type="search" value={query} placeholder={t('library.search.placeholder')} onChange={(event) => setQuery(event.target.value)} />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <label className="order">
          {t('library.order')}
          <select
            value={order}
            onChange={(event) => {
              const chosen: unknown = event.target.value;
              if (isOrder(chosen)) {
                setOrder(chosen);
              }
            }}
          >
            <option value="cited">{t('library.order.cited')}</option>
            <option value="title">{t('library.order.title')}</option>
            <option value="read">{t('library.order.read')}</option>
          </select>
        </label>
      </div>
      {publishers.length > 1 ? (
        <fieldset className="publishers">
          <legend className="sr">{t('library.publishers')}</legend>
          <button type="button" aria-pressed={publisher === undefined} onClick={() => setPublisher(undefined)}>
            {t('library.all')}
            <b>{library.sources.length}</b>
          </button>
          {publishers.map(([name, n]) => (
            <button key={name} type="button" aria-pressed={publisher === name} onClick={() => setPublisher(publisher === name ? undefined : name)}>
              {name}
              <b>{n}</b>
            </button>
          ))}
        </fieldset>
      ) : null}
      {shown.length === 0 ? (
        <>
          <output className="result-count">{t('library.no-match', { query: trimmed })}</output>
          <div className="sheet state no-match">
            <p>{t('library.no-match.hint')}</p>
            <button
              type="button"
              className="btn quiet small"
              onClick={() => {
                setQuery('');
                setPublisher(undefined);
              }}
            >
              {t('library.show-all')}
            </button>
          </div>
        </>
      ) : (
        <>
          <output className="result-count">{count}</output>
          <ul className="sheet library">
            {shown.map((source) => (
              <Row key={source.id} source={source} query={trimmed} text={texts.get(source.id) ?? ''} pathTo={pathTo} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Row({ source, query, text, pathTo }: { readonly source: LibrarySource; readonly query: string; readonly text: string; readonly pathTo: PageProps['pathTo'] }) {
  const { t, tc } = useMessages();
  const { language } = useI18n();
  const excerpt = query === '' ? undefined : snippet(text.replaceAll('\n', ' '), query, 60);
  const { lessons, questions, terms } = source.cited;
  const uses = [lessons > 0 ? tc('cited.lessons', lessons) : undefined, questions > 0 ? tc('cited.questions', questions) : undefined, lessons === 0 && questions === 0 && terms > 0 ? tc('cited.terms', terms) : undefined].filter(
    (part) => part !== undefined,
  );
  return (
    <li className="src-row" data-source={source.id}>
      <div>
        <h2>
          <Link to={pathTo([source.id])}>
            <Highlighted text={source.title} query={query} />
          </Link>
        </h2>
        <div className="origin-line">
          <b>
            <Highlighted text={source.publisher} query={query} />
          </b>
          {source.url === undefined ? null : <span>{new URL(source.url).hostname}</span>}
          <span>{t('read', { date: formatDay(source.accessed, language) })}</span>
          <span className="chip">{t(`kind.${source.kind}`)}</span>
        </div>
        {excerpt === undefined ? null : (
          <p className="snippet">
            <Highlighted text={excerpt} query={query} />
          </p>
        )}
      </div>
      <div className={uses.length === 0 ? 'uses none' : 'uses'}>
        {uses.length === 0 ? <b>{t('cited.none')}</b> : <>{uses.map((part, index) => (index === 0 ? <b key={part}>{part}</b> : <span key={part}>{part}</span>))}</>}
      </div>
    </li>
  );
}

/** `text` with the first word-start match of `query` marked. */
function Highlighted({ text, query }: { readonly text: string; readonly query: string }) {
  const at = findAt(text, query);
  if (at < 0) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}
