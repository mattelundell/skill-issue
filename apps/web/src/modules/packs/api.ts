import { API_PREFIX, LoadResultSchema, ProblemSchema, type ContentFault, type LoadResult } from '@skill-issue/contract';

/** What sending a pack came to. */
export type Sent =
  | { readonly kind: 'checked'; readonly result: LoadResult }
  | { readonly kind: 'faults'; readonly faults: readonly ContentFault[] }
  /** Refused as a whole — too large, not a zip — with the server's own words. */
  | { readonly kind: 'refused'; readonly title: string; readonly detail: string | undefined }
  | { readonly kind: 'failed' };

/** Sends a zip as a pack: checked only, or stored. The same request the command-line tool makes. */
export async function sendPack(zip: Blob, dryRun: boolean): Promise<Sent> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}/content/packs?dryRun=${String(dryRun)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/zip', accept: 'application/json' },
      body: zip,
    });
  } catch {
    return { kind: 'failed' };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'failed' };
  }
  if (response.ok) {
    const result = LoadResultSchema.safeParse(body);
    return result.success ? { kind: 'checked', result: result.data } : { kind: 'failed' };
  }
  const problem = ProblemSchema.safeParse(body);
  if (!problem.success) {
    return { kind: 'failed' };
  }
  if (problem.data.faults !== undefined && problem.data.faults.length > 0) {
    return { kind: 'faults', faults: problem.data.faults };
  }
  return { kind: 'refused', title: problem.data.title, detail: problem.data.detail };
}
