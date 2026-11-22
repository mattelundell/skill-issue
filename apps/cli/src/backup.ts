import { readFile, stat, writeFile } from 'node:fs/promises';
import { API_PREFIX, BackupSchema, ProblemSchema, RestoreResultSchema, type Backup } from '@skill-issue/contract';
import type { Outcome } from './pack.js';

type Fetch = typeof fetch;

const failed = (text: string): Outcome => ({ text, exitCode: 1 });
const unreachable = (url: string): Outcome => failed(`Nothing answers at ${url}. Is the application started?`);
/** A backup holds a subject's assets and every answer, so it may take a while to write or restore. */
const TIMEOUT_MS = 300_000;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    // Not propagated: a path that is not there is what is hoped for.
    return false;
  }
}

/** Why the application refused, in its own words. */
async function refusal(response: Response): Promise<Outcome> {
  const problem = ProblemSchema.safeParse(await response.json().catch(() => undefined));
  if (!problem.success) {
    return failed(`The application answered ${response.status} without saying why.`);
  }
  return failed(`${problem.data.title}${problem.data.detail === undefined ? '' : `: ${problem.data.detail}`}`);
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
const rowsIn = (written: Backup, table: string): number => written.tables.filter((t) => t.table === table).reduce((sum, t) => sum + t.rows.length, 0);

/** Writes the whole installation to a new file. */
export async function backup(command: { readonly target: string; readonly url: string }, fetchImpl: Fetch = fetch): Promise<Outcome> {
  if (await exists(command.target)) {
    return failed(`${command.target} already exists; choose another file.`);
  }
  let response: Response;
  try {
    response = await fetchImpl(new URL(`${API_PREFIX}/backup`, command.url), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    // Not propagated: refused or timed out, the advice is the same.
    return unreachable(command.url);
  }
  if (!response.ok) {
    return refusal(response);
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const checked = BackupSchema.safeParse(parsed);
  if (!checked.success) {
    return failed(`Something answers at ${command.url}, but it did not send a backup.`);
  }
  // Written as it came, so the file is byte for byte what the application wrote.
  await writeFile(command.target, text, { flag: 'wx' });
  const notes = rowsIn(checked.data, 'notes.note');
  return {
    text: `Backed up ${plural(rowsIn(checked.data, 'catalogue.subject'), 'subject', 'subjects')}, ${plural(rowsIn(checked.data, 'record.event'), 'row', 'rows')} of the learning record and ${plural(notes, 'note', 'notes')} to ${command.target}.`,
    exitCode: 0,
  };
}

/** Restores a backup file into an empty installation, or with `dryRun` checks that it would. */
export async function restore(command: { readonly path: string; readonly url: string; readonly dryRun: boolean }, fetchImpl: Fetch = fetch): Promise<Outcome> {
  let text: string;
  try {
    text = await readFile(command.path, 'utf8');
  } catch {
    // Not propagated: a path that is not there is the user's to correct.
    return failed(`No file at ${command.path}.`);
  }
  try {
    JSON.parse(text);
  } catch {
    return failed(`${command.path} is not a backup: it is not JSON.`);
  }
  let response: Response;
  try {
    response = await fetchImpl(new URL(`${API_PREFIX}/backup?dryRun=${command.dryRun}`, command.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Not propagated: refused or timed out, the advice is the same.
    return unreachable(command.url);
  }
  if (!response.ok) {
    return refusal(response);
  }
  const result = RestoreResultSchema.safeParse(await response.json().catch(() => undefined));
  if (!result.success) {
    return failed(`Something answers at ${command.url}, but it is not Skill Issue.`);
  }
  const width = Math.max(0, ...result.data.tables.map((t) => t.table.length));
  const lines = result.data.tables.map((t) => `  ${t.table.padEnd(width)}  ${plural(t.rows, 'row', 'rows')}`);
  const heading = result.data.dryRun ? 'The backup restores into this installation. Nothing was written; it would restore:' : 'Restored:';
  return { text: [heading, ...lines].join('\n'), exitCode: 0 };
}

/** Writes a subject's notes as one Markdown file. */
export async function exportNotes(
  command: { readonly subject: string; readonly target: string; readonly url: string; readonly language: string | undefined; readonly interfaceLanguage: string },
  fetchImpl: Fetch = fetch,
): Promise<Outcome> {
  if (await exists(command.target)) {
    return failed(`${command.target} already exists; choose another file.`);
  }
  const search = new URLSearchParams({ interface: command.interfaceLanguage });
  if (command.language !== undefined) {
    search.set('language', command.language);
  }
  let response: Response;
  try {
    response = await fetchImpl(new URL(`${API_PREFIX}/notes/subjects/${encodeURIComponent(command.subject)}/notes.md?${search.toString()}`, command.url), {
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    // Not propagated: refused or timed out, the advice is the same.
    return unreachable(command.url);
  }
  if (response.status === 404) {
    return failed(`There is no subject ${command.subject}.`);
  }
  if (!response.ok) {
    return refusal(response);
  }
  if (!(response.headers.get('content-type') ?? '').startsWith('text/markdown')) {
    return failed(`Something answers at ${command.url}, but it did not send Markdown.`);
  }
  await writeFile(command.target, await response.text(), { flag: 'wx' });
  return { text: `Wrote the notes of ${command.subject} to ${command.target}.`, exitCode: 0 };
}
