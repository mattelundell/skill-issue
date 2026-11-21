import { API_PREFIX, HealthResponseSchema, type HealthResponse } from '@skill-issue/contract';

export type ServerStatus =
  | { readonly kind: 'answered'; readonly health: HealthResponse }
  | { readonly kind: 'unreachable' };

/** Asks the server how it is. A server that cannot be reached is an answer, not an exception. */
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
