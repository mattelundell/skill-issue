import { useCallback, useEffect, useState } from 'react';
import type { Fetched } from '../../api.js';

/**
 * Loads a value once per `key`, and again on `retry()`. Undefined while the
 * load for the current key is in flight; an answer for an earlier key is dropped.
 */
export function useFetched<T>(key: string, load: (signal: AbortSignal) => Promise<Fetched<T>>): { readonly fetched: Fetched<T> | undefined; readonly retry: () => void } {
  const [state, setState] = useState<{ readonly key: string; readonly attempt: number; readonly fetched: Fetched<T> | undefined }>({ key, attempt: 0, fetched: undefined });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const settle = async (): Promise<void> => {
      const fetched = await load(controller.signal);
      if (!controller.signal.aborted) {
        setState({ key, attempt, fetched });
      }
    };
    void settle();
    return () => controller.abort();
  }, [key, attempt, load]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { fetched: state.key === key && state.attempt === attempt ? state.fetched : undefined, retry };
}
