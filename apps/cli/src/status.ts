import { API_PREFIX, DueCountsSchema, HealthResponseSchema, minutesFor, type DueCounts, type HealthResponse } from '@skill-issue/contract';

export type StatusOutcome =
  | { readonly kind: 'answered'; readonly health: HealthResponse; readonly due?: DueCounts | { readonly unread: string } }
  | { readonly kind: 'unreachable'; readonly url: string }
  | { readonly kind: 'not-skill-issue'; readonly url: string };

export async function fetchStatus(url: string, timeZone: string, fetchImpl: typeof fetch = fetch): Promise<StatusOutcome> {
  let body: unknown;
  try {
    const response = await fetchImpl(new URL(`${API_PREFIX}/health`, url), { signal: AbortSignal.timeout(5000) });
    body = await response.json();
  } catch {
    // Refused, timed out, or not JSON: nothing usable is listening there.
    return { kind: 'unreachable', url };
  }
  const parsed = HealthResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { kind: 'not-skill-issue', url };
  }
  const health = parsed.data;
  if (health.status !== 'ok' || !health.modules.includes('review')) {
    return { kind: 'answered', health };
  }
  try {
    const response = await fetchImpl(new URL(`${API_PREFIX}/review/due?timeZone=${encodeURIComponent(timeZone)}`, url), { signal: AbortSignal.timeout(10_000) });
    const due = DueCountsSchema.safeParse(await response.json().catch(() => undefined));
    return { kind: 'answered', health, due: due.success ? due.data : { unread: `the application answered ${response.status}` } };
  } catch {
    // Not propagated: refused or timed out, the reason is the same.
    return { kind: 'answered', health, due: { unread: 'nothing answered' } };
  }
}

/** One line per subject with a question scheduled, in the order of their ids. */
function dueLines(due: DueCounts): string[] {
  const subjects = Object.entries(due.subjects).toSorted(([a], [b]) => a.localeCompare(b));
  if (subjects.every(([, s]) => s.due === 0)) {
    return ['Nothing is due today.'];
  }
  const idWidth = Math.max(...subjects.map(([id]) => id.length));
  const countWidth = Math.max(...subjects.map(([, s]) => String(s.due).length));
  return [
    'Due today:',
    ...subjects.map(([id, s]) => {
      const minutes = minutesFor(s.due, s.typicalAnswerMs);
      return `  ${id.padEnd(idWidth)}  ${String(s.due).padStart(countWidth)}${minutes === undefined ? '' : `, about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`}`;
    }),
  ];
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
        case 'ok': {
          const lines = [`Skill Issue ${health.version} is up.`, `Modules: ${health.modules.join(', ')}`];
          if (outcome.due === undefined) {
            return { text: lines.join('\n'), exitCode: 0 };
          }
          if ('unread' in outcome.due) {
            return { text: [...lines, `What is due could not be read: ${outcome.due.unread}.`].join('\n'), exitCode: 1 };
          }
          return { text: [...lines, ...dueLines(outcome.due)].join('\n'), exitCode: 0 };
        }
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
