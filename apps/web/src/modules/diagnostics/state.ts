import type { Recording } from '@skill-issue/contract';
import { useSyncExternalStore } from 'react';
import { endRecording, fetchRecordingState, startRecording } from './api.js';

/**
 * Whether a session is being recorded, shared by the footer, which follows the
 * session while it is, and the page, which starts and stops it. Undefined until
 * the server has said; null when nothing is recorded.
 */
let current: Recording | null | undefined;
const listeners = new Set<() => void>();
/** Sends what the footer's recorder still holds, so a recording ended after it has everything. */
let finishing: (() => Promise<void>) | undefined;

function set(recording: Recording | null | undefined): void {
  current = recording;
  for (const listener of listeners) {
    listener();
  }
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The recording under way, as last heard. */
export const useRecording = (): Recording | null | undefined => useSyncExternalStore(subscribe, () => current);

/** Asks the server again, as after the recording may have been ended elsewhere. A server that does not answer leaves what was known. */
export async function refreshRecording(signal: AbortSignal): Promise<void> {
  const fetched = await fetchRecordingState(signal);
  if (fetched.kind !== 'ok') {
    return;
  }
  const { recording } = fetched.value;
  if (current === undefined || current?.id !== recording?.id) {
    set(recording);
  }
}

/** Registered by whatever follows the session while one is recorded. */
export function whileRecording(finish: (() => Promise<void>) | undefined): void {
  finishing = finish;
}

/** Starts recording, telling the server which browser this is. False when the server could not be reached. */
export async function start(language: string): Promise<boolean> {
  const started = await startRecording({
    userAgent: navigator.userAgent.slice(0, 500),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    interfaceLanguage: language,
  });
  if (started !== undefined) {
    set(started);
  }
  return started !== undefined;
}

/** Stops recording once what the browser still holds has been sent. False when the server could not be reached. */
export async function stop(id: number): Promise<boolean> {
  await finishing?.();
  const ended = await endRecording(id);
  if (ended !== undefined) {
    set(null);
  }
  return ended !== undefined;
}

/** Forgets that a recording is under way, as when the server says it has ended. */
export const ended = (): void => set(null);
