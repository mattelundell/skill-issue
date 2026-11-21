import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LessonSideProps } from '../../shell/contract.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchNotes, writeNote } from './api.js';
import { useMessages } from './messages.js';
import { asQuote, NOTE_KEY, placeOf, QUOTE_KEY, typedIntoField } from './place.js';

/** How long typing must pause before the note is saved. Moving to another step or closing the pane saves at once. */
export const SAVE_AFTER_MS = 600;

/** Where the note at one step stands: as loaded or last saved, typed and waiting, on its way, or refused. */
type Status = 'kept' | 'waiting' | 'saving' | 'failed';

/**
 * The note pane beside a lesson. It holds one note per step and shows the one
 * for the step on screen; the note is filed under the lesson and the step
 * without the learner choosing anything, and saved as they write.
 */
export function NotePane({ subject, lessonId, step, selection }: LessonSideProps) {
  const { t } = useMessages();
  const load = useMemo(() => async (signal: AbortSignal) => fetchNotes(subject.id, { lessonId }, signal), [subject.id, lessonId]);
  const { fetched, retry } = useFetched(`${subject.id}/${lessonId}`, load);

  // The text at each step as the learner has it: what the server held, then as typed.
  const [texts, setTexts] = useState<ReadonlyMap<number, string>>();
  const [statuses, setStatuses] = useState<ReadonlyMap<number, Status>>(new Map());
  // The step at which the quote key was pressed with nothing selected, so the hint goes with that step.
  const [hintAt, setHintAt] = useState<number>();
  const field = useRef<HTMLTextAreaElement>(null);

  if (texts === undefined && fetched?.kind === 'ok') {
    setTexts(new Map(fetched.value.notes.map((note) => [note.step, note.body])));
  }

  // Opened, the pane is ready to type into; moving between steps leaves the focus where the learner put it.
  const ready = texts !== undefined;
  useEffect(() => {
    if (ready) {
      field.current?.focus();
    }
  }, [ready]);

  const setStatus = useCallback((at: number, status: Status) => {
    setStatuses((before) => (before.get(at) === status ? before : new Map(before).set(at, status)));
  }, []);

  // Saves run one after another, so an earlier text can never land after a later one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(new Map<number, string>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    for (const [at, body] of waiting.current) {
      setStatus(at, 'saving');
      const send = async (): Promise<void> => {
        const written = await writeNote(subject.id, lessonId, at, body);
        // A later text for the same step is already waiting or on its way; its own save reports.
        if (!waiting.current.has(at)) {
          setStatus(at, written.kind === 'failed' ? 'failed' : 'kept');
        }
      };
      queue.current = queue.current.then(send);
    }
    waiting.current.clear();
  }, [subject.id, lessonId, setStatus]);

  // Leaving a step, or closing the pane, saves what is waiting at once.
  useEffect(() => () => flush(), [step, flush]);

  const change = useCallback(
    (body: string) => {
      setHintAt(undefined);
      setTexts((before) => new Map(before).set(step, body));
      waiting.current.set(step, body);
      setStatus(step, 'waiting');
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_AFTER_MS);
    },
    [step, flush, setStatus],
  );

  const text = texts?.get(step) ?? '';
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== QUOTE_KEY || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const selected = selection();
      // In a field the key is typing — unless text in the step is selected, as when a keyboard user selects it and the note keeps the focus.
      if (typedIntoField(event.target) && selected === undefined) {
        return;
      }
      event.preventDefault();
      if (selected === undefined) {
        setHintAt(step);
        return;
      }
      const kept = text.trimEnd();
      const body = `${kept === '' ? '' : `${kept}\n\n`}${asQuote(selected)}\n\n`;
      change(body);
      const target = field.current;
      if (target !== null) {
        target.focus();
        // The learner writes on after the quote.
        requestAnimationFrame(() => target.setSelectionRange(body.length, body.length));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ready, selection, text, change, step]);

  const place = placeOf(subject, lessonId);
  const filedUnder = place === undefined ? undefined : { area: place.area.title, lesson: place.lesson.title };
  const status = statuses.get(step) ?? 'kept';
  let line: string | undefined;
  if (hintAt === step) {
    line = t('pane.no-selection');
  } else if (status === 'waiting' || status === 'saving') {
    line = t('pane.saving');
  } else if (status === 'failed') {
    line = t('pane.save-failed');
  } else if (filedUnder !== undefined) {
    line = text.trim() === '' ? t('pane.files', filedUnder) : t('pane.saved', filedUnder);
  }

  return (
    <section className="sheet notes-pane" aria-labelledby="notes-pane-h">
      <h2 id="notes-pane-h">{t('pane.title')}</h2>
      <p className="at">{t('pane.at', { lesson: place?.lesson.title ?? lessonId, step: String(step + 1) })}</p>
      {fetched === undefined && texts === undefined ? (
        <p className="state-line" aria-busy="true">
          {t('pane.loading')}
        </p>
      ) : fetched !== undefined && fetched.kind !== 'ok' && texts === undefined ? (
        <div className="state-line" role="alert">
          <p>{t('pane.failed')}</p>
          <button type="button" className="btn quiet small" onClick={retry}>
            {t('pane.retry')}
          </button>
        </div>
      ) : (
        <>
          <textarea ref={field} rows={8} aria-label={t('pane.field', { step: String(step + 1) })} value={text} onChange={(event) => change(event.target.value)} />
          {line === undefined ? null : (
            <output className={status === 'failed' ? 'saved failed' : 'saved'} aria-live="polite">
              {line}
            </output>
          )}
        </>
      )}
      <p className="keys">
        <span>
          <kbd>{NOTE_KEY.toUpperCase()}</kbd> {t('pane.keys.or')} <kbd>Esc</kbd> {t('pane.keys.close')}
        </span>
        <span>
          <kbd>{QUOTE_KEY.toUpperCase()}</kbd> {t('pane.keys.quote')}
        </span>
      </p>
    </section>
  );
}
