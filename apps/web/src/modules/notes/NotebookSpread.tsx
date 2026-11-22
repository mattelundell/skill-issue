import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LessonSideProps } from '../../shell/contract.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchNotebook } from './api.js';
import { Composer } from './Composer.js';
import { KeyMap } from './KeyMap.js';
import { useMessages } from './messages.js';
import { areaOf, sectionKey, shelves, type Place, type Shelf } from './notebook.js';
import { NoteText } from './NoteText.js';
import { asQuote, NOTE_KEY, QUOTE_KEY, typedIntoField } from './place.js';
import { useSections } from './save.js';

/** The class names given, without the ones that are not. */
const classes = (...names: readonly (string | false)[]): string | undefined => {
  const given = names.filter((name) => name !== false);
  return given.length === 0 ? undefined : given.join(' ');
};

/** The key that shows and hides the key map, pressed outside a text field. */
export const KEYMAP_KEY = '?';

/**
 * The notebook as a spread beside a lesson: its contents, areas and lessons,
 * on one side, and one section to read or write on the other. It opens at the
 * lesson on screen, and any other section is a click away, so a note under an
 * earlier area can be added to while a later one is read.
 */
export function NotebookSpread({ subject, lessonId, selection, close }: LessonSideProps) {
  const { t, tc } = useMessages();
  const load = useMemo(() => async (signal: AbortSignal) => fetchNotebook(subject.id, '', signal), [subject.id]);
  const { fetched, retry } = useFetched(`${subject.id}/notebook`, load);
  const { texts, statuses, change, flush } = useSections(subject.id, fetched?.kind === 'ok' ? fetched.value.sections : undefined);

  const here = sectionKey('lesson', lessonId);
  const [at, setAt] = useState(here);
  const [mode, setMode] = useState<'write' | 'read'>('write');
  const [keys, setKeys] = useState(false);
  const [hint, setHint] = useState<string>();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set([areaOf(subject, lessonId) ?? '']));
  // Each time a section is opened for writing, the caret goes to its end; counted so that reopening one counts too.
  const [opening, setOpening] = useState(0);

  const written = useMemo(() => new Map([...(texts ?? new Map<string, string>())].filter(([, body]) => body.trim() !== '')), [texts]);
  const laid: readonly Shelf[] = useMemo(() => shelves(subject, written.keys(), t('gone')), [subject, written, t]);
  const places = useMemo(() => new Map(laid.flatMap((shelf) => shelf.places.map((place) => [place.key, { place, shelf }] as const))), [laid]);
  const current = places.get(at) ?? places.get(here);

  const goTo = useCallback(
    (key: string) => {
      flush();
      setAt(key);
      setHint(undefined);
      setOpening((n) => n + 1);
      const area = places.get(key)?.shelf.areaId;
      if (area !== undefined) {
        setOpen((before) => new Set(before).add(area));
      }
    },
    [flush, places],
  );
  const write = useCallback(() => {
    setMode('write');
    setOpening((n) => n + 1);
  }, []);

  // Q quotes what is selected in the step into the section open here; ? shows the key map.
  const body = current === undefined ? '' : (texts?.get(current.place.key) ?? '');
  useEffect(() => {
    if (texts === undefined || current === undefined) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key === KEYMAP_KEY && !typedIntoField(event.target)) {
        event.preventDefault();
        setKeys((shown) => !shown);
        return;
      }
      if (event.key.toLowerCase() !== QUOTE_KEY) {
        return;
      }
      const selected = selection();
      // In a field the key is typing — unless text in the step is selected, as when a keyboard user selects it and the note keeps the focus.
      if (typedIntoField(event.target) && selected === undefined) {
        return;
      }
      event.preventDefault();
      if (selected === undefined) {
        setHint(t('no-selection'));
        return;
      }
      const kept = body.trimEnd();
      change(current.place, `${kept === '' ? '' : `${kept}\n\n`}${asQuote(selected)}\n\n`);
      write();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [texts, current, selection, body, change, write, t]);

  const titleOf = (place: Place): string => place.title ?? (place.kind === 'area' ? t('area.own') : t('gone.lesson', { id: place.itemId }));
  // The note as read takes the focus, so Enter there writes in it again rather than reaching the lesson as "continue"; a click writes too.
  const readRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const read = readRef.current;
    if (mode !== 'read' || read === null) {
      return undefined;
    }
    read.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        write();
      }
    };
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element && event.target.closest('a') !== null)) {
        write();
      }
    };
    read.addEventListener('keydown', onKey);
    read.addEventListener('click', onClick);
    return () => {
      read.removeEventListener('keydown', onKey);
      read.removeEventListener('click', onClick);
    };
  }, [mode, write, at]);

  let page;
  if (texts === undefined || current === undefined) {
    page =
      fetched !== undefined && fetched.kind !== 'ok' ? (
        <div className="state-line" role="alert">
          <p>{t('failed')}</p>
          <button type="button" className="btn quiet small" onClick={retry}>
            {t('retry')}
          </button>
        </div>
      ) : (
        <p className="state-line" aria-busy="true">
          {t('loading')}
        </p>
      );
  } else {
    const { place, shelf } = current;
    page = (
      <>
        <p className="sec-path">
          {shelf.title}
          {place.kind === 'lesson' && place.title !== undefined ? ` › ${place.title}` : ''}
        </p>
        <h3>{titleOf(place)}</h3>
        {place.key === here ? null : (
          <p className="away">
            <span>{t('away')}</span>
            <button type="button" className="link-button" onClick={() => goTo(here)}>
              {t('away.back')}
            </button>
          </p>
        )}
        {hint === undefined ? null : (
          <output className="hint">{hint}</output>
        )}
        {mode === 'write' ? (
          <Composer
            key={`${place.key}#${opening}`}
            subjectId={subject.id}
            value={body}
            onChange={(next) => change(place, next)}
            label={t('field', { place: titleOf(place) })}
            status={statuses.get(place.key) ?? 'kept'}
            rows={16}
            caretAtEnd
            onEscape={() => {
              flush();
              setMode('read');
            }}
          />
        ) : (
          <section ref={readRef} className="md-click read-note" tabIndex={-1} aria-label={t('read.write')}>
            {body.trim() === '' ? <p className="empty-sec">{t('empty')}</p> : <NoteText subjectId={subject.id} body={body} below={3} />}
          </section>
        )}
        <p className="keymap-line">
          <button type="button" className="keymap-btn" aria-expanded={keys} onClick={() => setKeys((shown) => !shown)}>
            {keys ? t('keys.hide') : t('keys')} <kbd>{KEYMAP_KEY}</kbd>
          </button>
        </p>
        {keys ? <KeyMap /> : null}
      </>
    );
  }

  return (
    <div className="notebook-spread">
      <header>
        <div>
          <h2>{t('notebook')}</h2>
          <span className="of">
            {subject.title} · {tc('written', written.size)}
          </span>
        </div>
        <div className="spread-tools">
          <fieldset className="modes">
            <legend className="sr">{t('mode')}</legend>
            <button type="button" aria-pressed={mode === 'write'} onClick={write}>
              {t('mode.write')}
            </button>
            <button
              type="button"
              aria-pressed={mode === 'read'}
              onClick={() => {
                flush();
                setMode('read');
              }}
            >
              {t('mode.read')}
            </button>
          </fieldset>
          <button type="button" className="spread-close" aria-label={t('close')} title={`${t('close')} (${NOTE_KEY.toUpperCase()})`} onClick={close}>
            ✕
          </button>
        </div>
      </header>
      <div className="spread-body">
        <nav aria-label={t('contents')}>
          <Contents shelves={laid} written={written} open={open} setOpen={setOpen} at={current?.place.key} here={here} goTo={goTo} titleOf={titleOf} />
        </nav>
        <div className="page">{page}</div>
      </div>
    </div>
  );
}

/** A fold's key: the area's id, or nothing for the lessons the subject no longer holds. */
const foldKey = (shelf: Shelf): string => shelf.areaId ?? '';

/** The notebook's contents: an area per fold, its own section and its lessons', a dot on each with something written. */
export function Contents({
  shelves: laid,
  written,
  open,
  setOpen,
  at,
  here,
  goTo,
  titleOf,
}: {
  readonly shelves: readonly Shelf[];
  readonly written: ReadonlyMap<string, string>;
  readonly open: ReadonlySet<string>;
  readonly setOpen: (open: ReadonlySet<string>) => void;
  readonly at: string | undefined;
  readonly here: string | undefined;
  readonly goTo: (key: string) => void;
  readonly titleOf: (place: Place) => string;
}) {
  const { t, tc } = useMessages();
  return (
    <>
      <p className="toc-tools">
        <button type="button" onClick={() => setOpen(new Set(laid.map(foldKey)))}>
          {t('fold.open')}
        </button>
        <button type="button" onClick={() => setOpen(new Set())}>
          {t('fold.close')}
        </button>
      </p>
      <ul className="toc">
        {laid.map((shelf) => {
          const count = shelf.places.filter((place) => written.has(place.key)).length;
          const [own, ...lessons] = shelf.areaId === undefined ? [undefined, ...shelf.places] : shelf.places;
          return (
            <li key={foldKey(shelf)}>
              <details
                open={open.has(foldKey(shelf))}
                onToggle={(event) => {
                  const isOpen = event.currentTarget.open;
                  if (isOpen !== open.has(foldKey(shelf))) {
                    const after = new Set(open);
                    if (isOpen) {
                      after.add(foldKey(shelf));
                    } else {
                      after.delete(foldKey(shelf));
                    }
                    setOpen(after);
                  }
                }}
              >
                <summary>
                  {own === undefined ? (
                    <span>{shelf.title}</span>
                  ) : (
                    <a
                      href={`#${own.key}`}
                      className={written.has(own.key) ? 'has' : undefined}
                      aria-current={at === own.key ? 'true' : undefined}
                      onClick={(event) => {
                        event.preventDefault();
                        goTo(own.key);
                      }}
                    >
                      {shelf.title}
                    </a>
                  )}
                  {count === 0 ? null : <span className="n">{tc('area.count', count)}</span>}
                </summary>
                <ul>
                  {lessons.map((place) =>
                    place === undefined ? null : (
                      <li key={place.key}>
                        <a
                          href={`#${place.key}`}
                          className={classes(written.has(place.key) && 'has', place.key === here && 'here')}
                          aria-current={at === place.key ? 'true' : undefined}
                          onClick={(event) => {
                            event.preventDefault();
                            goTo(place.key);
                          }}
                        >
                          {titleOf(place)}
                          {place.key === here ? (
                            <span className="here-tag">
                              <span aria-hidden="true">←</span>
                              <span className="sr">{t('this-lesson')}</span>
                            </span>
                          ) : null}
                        </a>
                      </li>
                    ),
                  )}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}
