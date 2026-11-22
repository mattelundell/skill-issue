import type { NotebookSection } from '@skill-issue/contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import { writeSection } from './api.js';
import type { Place } from './notebook.js';

/** How long typing must pause before a section is saved. Leaving it, or closing the notebook, saves at once. */
export const SAVE_AFTER_MS = 600;

/** Where one section stands: as loaded or last saved, typed and waiting, on its way, or refused. */
export type Status = 'kept' | 'waiting' | 'saving' | 'failed';

/**
 * The notebook's text as the learner has it, section by section, saved as they
 * write. Saves run one after another, so an earlier text can never land after a
 * later one; a section whose save failed is tried again with its next change.
 */
export function useSections(subjectId: string, loaded: readonly NotebookSection[] | undefined) {
  const [texts, setTexts] = useState<ReadonlyMap<string, string>>();
  const [statuses, setStatuses] = useState<ReadonlyMap<string, Status>>(new Map());
  if (texts === undefined && loaded !== undefined) {
    setTexts(new Map(loaded.map((section) => [`${section.kind}/${section.itemId}`, section.body])));
  }

  const setStatus = useCallback((key: string, status: Status) => {
    setStatuses((before) => (before.get(key) === status ? before : new Map(before).set(key, status)));
  }, []);

  const queue = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(new Map<string, { readonly place: Place; readonly body: string }>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    for (const [key, { place, body }] of waiting.current) {
      setStatus(key, 'saving');
      const send = async (): Promise<void> => {
        const written = await writeSection(subjectId, place.kind, place.itemId, body);
        // A later text for the same section is already waiting or on its way; its own save reports.
        if (!waiting.current.has(key)) {
          setStatus(key, written.kind === 'failed' ? 'failed' : 'kept');
        }
      };
      queue.current = queue.current.then(send);
    }
    waiting.current.clear();
  }, [subjectId, setStatus]);

  // Closing the notebook, or leaving the page, saves what is waiting at once.
  useEffect(() => () => flush(), [flush]);

  const change = useCallback(
    (place: Place, body: string) => {
      setTexts((before) => new Map(before).set(place.key, body));
      waiting.current.set(place.key, { place, body });
      setStatus(place.key, 'waiting');
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_AFTER_MS);
    },
    [flush, setStatus],
  );

  return { texts, statuses, change, flush };
}
