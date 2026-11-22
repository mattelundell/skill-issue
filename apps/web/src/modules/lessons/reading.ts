import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * How a lesson is read: the workbench, with the lesson's steps and sources on
 * one side and notes and the step's terms on the other, or focus mode, one
 * column with nothing beside the text. It is a way of reading rather than a fact
 * about a subject, so it is kept on the device, as the interface language is.
 */
export type Reading = 'bench' | 'focus';

const READING_STORAGE_KEY = 'skill-issue.lessons.reading';

function storedReading(): Reading {
  let stored: unknown;
  try {
    stored = window.localStorage.getItem(READING_STORAGE_KEY);
  } catch {
    // Storage blocked: the workbench is a fine answer.
    stored = undefined;
  }
  return stored === 'focus' ? 'focus' : 'bench';
}

export function useReading(): { readonly reading: Reading; readonly toggle: () => void } {
  const [reading, setReading] = useState<Reading>(storedReading);
  useEffect(() => {
    try {
      window.localStorage.setItem(READING_STORAGE_KEY, reading);
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  }, [reading]);
  const toggle = useCallback(() => setReading((now) => (now === 'bench' ? 'focus' : 'bench')), []);
  return { reading, toggle };
}

/** A step's title for a list of the lesson's steps: its heading, where it opens with one, else what kind of step it is. */
export function stepHeading(body: string): string | undefined {
  const first = body.trimStart().split('\n', 1)[0] ?? '';
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(first);
  return heading?.[1];
}

/** Wider than a phone: where the workbench has room beside the text. The same breakpoint as the stylesheets'. */
const WIDE = '(min-width: 761px)';

const wideQuery = (): MediaQueryList | undefined => (typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : undefined);

/** Whether the window is wider than a phone, following it as it is resized; wide where the browser cannot say. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = wideQuery();
      query?.addEventListener('change', changed);
      return () => query?.removeEventListener('change', changed);
    },
    () => wideQuery()?.matches ?? true,
  );
}
