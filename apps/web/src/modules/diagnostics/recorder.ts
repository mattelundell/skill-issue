import { withoutQueryValues, type InterfaceEvent } from '@skill-issue/contract';
import { onFault } from '../../shell/faults.js';
import { onNavigation } from '../../shell/router.js';

/**
 * Follows what the learner does in the browser while a session is recorded,
 * and hands it on in batches. Nothing typed into a field is kept: a key pressed
 * in one is recorded only when it is Enter, Escape or Tab, and a field is named
 * by its label, never by its value.
 */

/** What became of a batch: kept, refused as malformed, not deliverable now, or not wanted because the recording has ended. */
export type Sent = 'kept' | 'refused' | 'unreachable' | 'ended';

export interface RecorderOptions {
  /** Delivers a batch. */
  readonly send: (events: readonly InterfaceEvent[]) => Promise<Sent>;
  /** Delivers a batch as the page goes away, when nothing can be waited for. */
  readonly sendAtExit: (events: readonly InterfaceEvent[]) => void;
  /** Told once the server has said the recording is over. */
  readonly onEnded: () => void;
  readonly now?: () => Date;
  /** How long events wait before they are sent. */
  readonly flushMs?: number;
}

/** A batch is sent at this many events without waiting; the API takes at most 200. */
const BATCH = 50;
/** Events kept while the server cannot be reached; the oldest go first beyond it. */
const HELD_MAX = 1_000;
const KEYS_IN_A_FIELD: ReadonlySet<string> = new Set(['Enter', 'Escape', 'Tab']);
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);
/** What counts as acting when clicked; a click anywhere else is not recorded. */
const ACTIVE = 'a[href], button, input, select, textarea, summary, label, [role], [tabindex]';
const TEXT_INPUTS: ReadonlySet<string> = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** Cuts text to what the contract takes, so one long message cannot make a whole batch refused. */
const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const words = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
const named = (text: string): string | undefined => (text === '' ? undefined : text);
/** Where in the app the learner is: its address without the origin, and its query without the values. */
const page = (): string => named(cut(withoutQueryValues(`${window.location.pathname}${window.location.search}`), 2_000)) ?? '/';

/** Whether keys pressed in `target` are text the learner is writing. */
export function isField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLInputElement && !TEXT_INPUTS.has(target.type);
}

/**
 * What a clicked element is called, without its value: its own label, the text
 * of the label it sits in, or for a field its label or placeholder; otherwise
 * its text.
 */
function nameOf(element: Element): string | undefined {
  const labelled = element.getAttribute('aria-label');
  if (labelled !== null && labelled.trim() !== '') {
    return words(labelled);
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const label = words(element.labels?.[0]?.textContent);
    if (label !== '') {
      return label;
    }
    return element instanceof HTMLSelectElement ? undefined : named(words(element.placeholder));
  }
  return named(words(element.textContent));
}

function describeClick(target: EventTarget | null): { element: string; role?: string; name?: string } | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const active = target.closest(ACTIVE);
  if (active === null) {
    return undefined;
  }
  const tag = active.tagName.toLowerCase();
  const element = active instanceof HTMLInputElement ? `input[type=${active.type}]` : tag;
  const role = active.getAttribute('role');
  const name = nameOf(active);
  return {
    element: cut(element, 32),
    ...(role === null ? {} : { role: cut(role, 32) }),
    ...(name === undefined ? {} : { name: cut(name, 120) }),
  };
}

function modifiersOf(event: KeyboardEvent): ('alt' | 'ctrl' | 'meta' | 'shift')[] {
  return [...(event.altKey ? ['alt' as const] : []), ...(event.ctrlKey ? ['ctrl' as const] : []), ...(event.metaKey ? ['meta' as const] : []), ...(event.shiftKey ? ['shift' as const] : [])];
}

function described(thrown: unknown): { message: string; stack?: string } {
  if (thrown instanceof Error) {
    return { message: cut(`${thrown.name}: ${thrown.message}`, 2_000), ...(thrown.stack === undefined ? {} : { stack: cut(thrown.stack, 8_000) }) };
  }
  let message: string;
  try {
    message = typeof thrown === 'string' ? thrown : JSON.stringify(thrown) ?? String(thrown);
  } catch {
    message = String(thrown);
  }
  return { message: cut(message, 2_000) };
}

/**
 * Starts following the session. The function returned stops it and sends what
 * is still held, settling once that is delivered, so a recording ended after it
 * has everything.
 */
export function startRecorder({ send, sendAtExit, onEnded, now = () => new Date(), flushMs = 2_000 }: RecorderOptions): () => Promise<void> {
  let held: InterfaceEvent[] = [];
  /** The batch on its way, if one is: at most one is, so batches arrive in order and none is sent twice. */
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const at = (): string => now().toISOString();

  const flush = (): Promise<void> => {
    if (inFlight !== undefined || held.length === 0 || stopped) {
      return inFlight ?? Promise.resolve();
    }
    inFlight = deliver().finally(() => {
      inFlight = undefined;
      // A full batch waiting goes now, once this one has settled, so the two cannot overlap.
      if (held.length >= BATCH && !stopped) {
        void flush();
      }
    });
    return inFlight;
  };

  const deliver = async (): Promise<void> => {
    const batch = held.slice(0, BATCH);
    const sent = await send(batch);
    switch (sent) {
      case 'kept':
        held = held.slice(batch.length);
        break;
      case 'refused':
        // A batch the server will never take: holding it would block every later one. The recorder's tests hold its events to the contract.
        held = held.slice(batch.length);
        break;
      case 'unreachable':
        // Kept for the next try.
        break;
      case 'ended':
        // Nothing more is wanted, this batch included.
        held = [];
        stop();
        onEnded();
        return;
      default: {
        const unhandled: never = sent;
        return unhandled;
      }
    }
  };

  const add = (event: InterfaceEvent): void => {
    if (stopped) {
      return;
    }
    held.push(event);
    // Not while a batch is on its way: it is the oldest, and is taken off once it is kept.
    if (held.length > HELD_MAX && inFlight === undefined) {
      held = held.slice(held.length - HELD_MAX);
    }
    if (held.length >= BATCH) {
      void flush();
    }
  };

  const onClick = (event: MouseEvent): void => {
    const click = describeClick(event.target);
    if (click !== undefined) {
      add({ kind: 'click', at: at(), page: page(), ...click });
    }
  };
  const onKey = (event: KeyboardEvent): void => {
    const inField = isField(event.target);
    if (MODIFIER_KEYS.has(event.key) || (inField && !KEYS_IN_A_FIELD.has(event.key))) {
      return;
    }
    add({ kind: 'key', at: at(), page: page(), key: cut(event.key, 32), modifiers: modifiersOf(event), inField });
  };
  const onError = (event: ErrorEvent): void => {
    const thrown: unknown = event.error;
    const { stack } = described(thrown);
    add({
      kind: 'error',
      at: at(),
      page: page(),
      message: cut(named(event.message) ?? described(thrown).message, 2_000),
      ...(event.filename === '' ? {} : { source: cut(event.filename, 500) }),
      ...(event.lineno > 0 ? { line: event.lineno } : {}),
      ...(event.colno > 0 ? { column: event.colno } : {}),
      ...(stack === undefined ? {} : { stack }),
    });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const { message, stack } = described(event.reason);
    add({ kind: 'rejection', at: at(), page: page(), reason: message, ...(stack === undefined ? {} : { stack }) });
  };
  const onVisibility = (): void => {
    add({ kind: 'visibility', at: at(), page: page(), state: document.visibilityState === 'hidden' ? 'hidden' : 'visible' });
    if (document.visibilityState === 'hidden') {
      void flush();
    }
  };
  const onLeave = (): void => {
    // The page is going: nothing can be waited for, so what is held goes in one send that outlives it.
    if (held.length > 0 && !stopped) {
      sendAtExit(held.slice(0, 200));
      held = [];
    }
  };

  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('pagehide', onLeave);
  document.addEventListener('visibilitychange', onVisibility);
  const stopNavigation = onNavigation(() => add({ kind: 'navigate', at: at(), page: page() }));
  const stopFaults = onFault(({ request, reason }) => add({ kind: 'fault', at: at(), page: page(), request: cut(request, 2_000), reason }));
  const timer = window.setInterval(() => void flush(), flushMs);

  add({ kind: 'navigate', at: at(), page: page() });

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('pagehide', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    stopNavigation();
    stopFaults();
  }

  return async () => {
    stop();
    await inFlight;
    // Everything still held, in batches as during the session, until the server stops taking them.
    while (held.length > 0) {
      const batch = held.slice(0, BATCH);
      held = held.slice(batch.length);
      if ((await send(batch)) !== 'kept') {
        held = [];
      }
    }
  };
}
