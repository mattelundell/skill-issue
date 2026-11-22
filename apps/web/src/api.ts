import {
  API_PREFIX,
  HealthResponseSchema,
  SubjectOutlineSchema,
  SubjectSummarySchema,
  type HealthResponse,
  type SubjectOutline,
  type SubjectSummary,
} from '@skill-issue/contract';
import { reportFault } from './shell/faults.js';

export type ServerStatus =
  | { readonly kind: 'answered'; readonly health: HealthResponse }
  | { readonly kind: 'unreachable' };

/** What a read from the API came to. A server that cannot be reached is an answer, not an exception. */
export type Fetched<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'not-found' }
  /** No connection, an error status, or an answer that does not match the contract. */
  | { readonly kind: 'failed' };

interface Parser<T> {
  safeParse(input: unknown): { readonly success: true; readonly data: T } | { readonly success: false };
}

/** Reads JSON from the API and checks it against the contract. A module's own reads go through this too. */
export async function getJson<T>(path: string, parser: Parser<T>, signal: AbortSignal): Promise<Fetched<T>> {
  const request = `${API_PREFIX}${path}`;
  let response: Response;
  try {
    response = await fetch(request, { signal, headers: { accept: 'application/json' } });
  } catch {
    // No connection, or an aborted request, which nobody is waiting for and is no fault.
    if (!signal.aborted) {
      reportFault({ request, reason: 'network' });
    }
    return { kind: 'failed' };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // An answer that is not JSON: an error page from something in between, or a body cut short.
    if (!signal.aborted) {
      reportFault({ request, reason: 'contract' });
    }
    return { kind: 'failed' };
  }
  if (response.status === 404) {
    return { kind: 'not-found' };
  }
  if (!response.ok) {
    // The server saw this one, and a recording has it from there.
    return { kind: 'failed' };
  }
  const parsed = parser.safeParse(body);
  if (!parsed.success) {
    reportFault({ request, reason: 'contract' });
    return { kind: 'failed' };
  }
  return { kind: 'ok', value: parsed.data };
}

/** Asks the server how it is. The health endpoint answers 503 with a body when the database is down. */
export async function fetchStatus(signal: AbortSignal): Promise<ServerStatus> {
  let body: unknown;
  try {
    const response = await fetch(`${API_PREFIX}/health`, { signal });
    body = await response.json();
  } catch {
    // No connection, or an answer that is not JSON: either way the server is not usable.
    return { kind: 'unreachable' };
  }
  const parsed = HealthResponseSchema.safeParse(body);
  return parsed.success ? { kind: 'answered', health: parsed.data } : { kind: 'unreachable' };
}

const SubjectListSchema = SubjectSummarySchema.array();

export const fetchSubjects = async (signal: AbortSignal): Promise<Fetched<readonly SubjectSummary[]>> =>
  getJson('/content/subjects', SubjectListSchema, signal);

/** A subject's path, read in `language` where translated and in its default language where not; in the default language when none is given. */
export const fetchOutline = async (subjectId: string, signal: AbortSignal, language?: string): Promise<Fetched<SubjectOutline>> =>
  getJson(`/content/subjects/${encodeURIComponent(subjectId)}${language === undefined ? '' : `?language=${encodeURIComponent(language)}`}`, SubjectOutlineSchema, signal);
