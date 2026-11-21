import { useCallback, useEffect, useRef, useState } from 'react';

/** How often a screen that shows server state asks again while it is open. */
export const REFRESH_INTERVAL_MS = 30_000;

/**
 * Loads a value now, again every `intervalMs`, again whenever the tab is shown
 * or focused, and on `refresh()`. Only the latest answer is kept: one that
 * arrives after a newer request was made is dropped.
 */
export function usePolled<T>(load: (signal: AbortSignal) => Promise<T>, intervalMs = REFRESH_INTERVAL_MS): { readonly value: T | undefined; readonly refresh: () => void } {
  const [value, setValue] = useState<T>();
  const latest = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(() => {
    latest.current?.abort();
    const controller = new AbortController();
    latest.current = controller;
    const settle = async (): Promise<void> => {
      const loaded = await load(controller.signal);
      if (latest.current === controller) {
        setValue(() => loaded);
      }
    };
    void settle();
  }, [load]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, intervalMs);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      latest.current?.abort();
      latest.current = undefined;
    };
  }, [refresh, intervalMs]);

  return { value, refresh };
}
