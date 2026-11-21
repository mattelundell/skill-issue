import { API_PREFIX, HealthResponseSchema, type HealthResponse } from '@skill-issue/contract';

export type StatusOutcome =
  | { readonly kind: 'answered'; readonly health: HealthResponse }
  | { readonly kind: 'unreachable'; readonly url: string }
  | { readonly kind: 'not-skill-issue'; readonly url: string };

export async function fetchStatus(url: string): Promise<StatusOutcome> {
  let body: unknown;
  try {
    const response = await fetch(new URL(`${API_PREFIX}/health`, url), { signal: AbortSignal.timeout(5000) });
    body = await response.json();
  } catch {
    // Refused, timed out, or not JSON: nothing usable is listening there.
    return { kind: 'unreachable', url };
  }
  const parsed = HealthResponseSchema.safeParse(body);
  return parsed.success ? { kind: 'answered', health: parsed.data } : { kind: 'not-skill-issue', url };
}

/** What to print for an outcome, and the exit code that goes with it. */
export function report(outcome: StatusOutcome): { readonly text: string; readonly exitCode: 0 | 1 } {
  switch (outcome.kind) {
    case 'unreachable':
      return { text: `Nothing answers at ${outcome.url}. Is the application started?`, exitCode: 1 };
    case 'not-skill-issue':
      return { text: `Something answers at ${outcome.url}, but it is not Skill Issue.`, exitCode: 1 };
    case 'answered': {
      const { health } = outcome;
      switch (health.status) {
        case 'ok':
          return {
            text: `Skill Issue ${health.version} is up.\nModules: ${health.modules.join(', ')}`,
            exitCode: 0,
          };
        case 'unavailable':
          return { text: `Skill Issue ${health.version} is running, but its database cannot be reached.`, exitCode: 1 };
        default: {
          const unhandled: never = health;
          return unhandled;
        }
      }
    }
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}
