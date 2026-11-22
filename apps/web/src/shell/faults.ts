/**
 * Reads the browser app gave up on, which the server cannot see: no answer at
 * all, or an answer that does not match the contract. The shell reports them;
 * whoever wants to know, such as a session recording, listens. Nobody listening
 * costs nothing.
 */

export type FaultReason = 'network' | 'contract';

export interface Fault {
  /** The address that was read. */
  readonly request: string;
  readonly reason: FaultReason;
}

const FAULT = 'skill-issue:fault';

export function reportFault(fault: Fault): void {
  window.dispatchEvent(new CustomEvent<Fault>(FAULT, { detail: fault }));
}

/** Calls `listener` with every fault reported from now on, until the returned function is called. */
export function onFault(listener: (fault: Fault) => void): () => void {
  const handle = (event: Event): void => {
    if (event instanceof CustomEvent) {
      const detail: unknown = event.detail;
      if (typeof detail === 'object' && detail !== null && 'request' in detail && 'reason' in detail && typeof detail.request === 'string' && (detail.reason === 'network' || detail.reason === 'contract')) {
        listener({ request: detail.request, reason: detail.reason });
      }
    }
  };
  window.addEventListener(FAULT, handle);
  return () => window.removeEventListener(FAULT, handle);
}
