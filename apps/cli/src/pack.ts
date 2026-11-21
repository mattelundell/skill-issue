import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  API_PREFIX,
  LoadResultSchema,
  ProblemSchema,
  type ContentFault,
  type ItemRef,
  type LoadResult,
  type Result,
} from '@skill-issue/contract';
import { checkPackFiles, readFolder, readZip, writeFolder, writeZip, type PackFiles } from '@skill-issue/pack';

/** What to print, where, and the exit code. */
export interface Outcome {
  readonly text: string;
  readonly exitCode: 0 | 1;
}

const failed = (text: string): Outcome => ({ text, exitCode: 1 });

/** Faults grouped under the file they are in, one line each. */
export function formatFaults(faults: readonly ContentFault[]): string {
  const byFile = Map.groupBy(faults, (fault) => fault.file);
  const lines = [`${faults.length} ${faults.length === 1 ? 'fault' : 'faults'}:`];
  for (const [file, inFile] of byFile) {
    lines.push('', file);
    for (const fault of inFile) {
      const where = [fault.item, fault.field].filter((part) => part !== null && part !== '').join(' · ');
      lines.push(`  ${where === '' ? '' : `${where}: `}expected ${fault.expected}, found ${fault.found}  [${fault.code}]`);
    }
  }
  return lines.join('\n');
}

const refText = (ref: ItemRef): string => `${ref.kind} ${ref.id}${ref.language === null ? '' : ` (${ref.language})`}`;

/** What a load changed, or would change, one item per line. */
export function formatChanges(result: LoadResult): string {
  const lines = [`Subject ${result.subject}${result.created ? ' (new)' : ''}`];
  for (const [label, refs] of [['added  ', result.added], ['changed', result.changed], ['retired', result.retired]] as const) {
    for (const ref of refs) {
      lines.push(`  ${label}  ${refText(ref)}`);
    }
  }
  lines.push(`  ${result.unchanged} unchanged`);
  return lines.join('\n');
}

/** A pack folder, or a .zip file holding one. */
export async function readPackAt(path: string): Promise<Result<PackFiles, ContentFault[]> | { readonly ok: false; readonly missing: string }> {
  let info;
  try {
    info = await stat(path);
  } catch {
    // Not propagated: a path that is not there is the user's to correct.
    return { ok: false, missing: path };
  }
  return info.isDirectory() ? readFolder(path) : readZip(await readFile(path));
}

/** Checks a pack on this machine, without the application. */
export async function validate(path: string): Promise<Outcome> {
  const files = await readPackAt(path);
  if (!files.ok) {
    return failed('missing' in files ? `No pack at ${files.missing}.` : formatFaults(files.error));
  }
  const checked = checkPackFiles(files.value);
  if (!checked.ok) {
    return failed(formatFaults(checked.error));
  }
  const pack = checked.value;
  const count = (language: string): number => pack.lessons.filter((lesson) => lesson.language === language).length;
  const languages = [...new Set(pack.subject.map((entry) => entry.language))].toSorted();
  const defaultLanguage = pack.subject[0]?.defaultLanguage ?? '';
  return {
    text: `The pack is valid: subject ${pack.subject[0]?.id ?? ''}, ${pack.areas.filter((a) => a.language === defaultLanguage).length} areas, ${count(defaultLanguage)} lessons, ${pack.questions.filter((q) => q.language === defaultLanguage).length} questions, in ${languages.join(', ')}.`,
    exitCode: 0,
  };
}

type Fetch = typeof fetch;

type Answer = { readonly kind: 'result'; readonly result: LoadResult } | { readonly kind: 'failed'; readonly outcome: Outcome };

async function send(fetchImpl: Fetch, url: string, archive: Uint8Array, dryRun: boolean): Promise<Answer> {
  let response: Response;
  try {
    response = await fetchImpl(new URL(`${API_PREFIX}/content/packs?dryRun=${dryRun}`, url), {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: new Uint8Array(archive).buffer,
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    // Not propagated: refused or timed out, the advice is the same.
    return { kind: 'failed', outcome: failed(`Nothing answers at ${url}. Is the application started?`) };
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    const result = LoadResultSchema.safeParse(body);
    return result.success ? { kind: 'result', result: result.data } : { kind: 'failed', outcome: failed(`Something answers at ${url}, but it is not Skill Issue.`) };
  }
  const problem = ProblemSchema.safeParse(body);
  if (!problem.success) {
    return { kind: 'failed', outcome: failed(`The application answered ${response.status} without saying why.`) };
  }
  const { title, detail, faults } = problem.data;
  return { kind: 'failed', outcome: failed(faults === undefined ? `${title}${detail === undefined ? '' : `: ${detail}`}` : `${title}.\n${formatFaults(faults)}`) };
}

/**
 * Checks the pack here, asks the application what loading it would change,
 * and stores it if the subject is new, or if `yes` says an update may go ahead.
 */
export async function load(command: { readonly path: string; readonly url: string; readonly yes: boolean }, fetchImpl: Fetch = fetch): Promise<Outcome> {
  const files = await readPackAt(command.path);
  if (!files.ok) {
    return failed('missing' in files ? `No pack at ${files.missing}.` : formatFaults(files.error));
  }
  const checked = checkPackFiles(files.value);
  if (!checked.ok) {
    return failed(formatFaults(checked.error));
  }
  const archive = writeZip(files.value, basename(command.path).replace(/\.zip$/, ''));

  const preview = await send(fetchImpl, command.url, archive, true);
  if (preview.kind === 'failed') {
    return preview.outcome;
  }
  const { result } = preview;
  if (result.added.length + result.changed.length + result.retired.length === 0) {
    return { text: `Nothing to change: subject ${result.subject} already holds this pack (${result.unchanged} items).`, exitCode: 0 };
  }
  if (!result.created && !command.yes) {
    return failed(`${formatChanges(result)}\n\nNothing was stored. This updates an existing subject; run again with --yes to apply it.`);
  }
  const stored = await send(fetchImpl, command.url, archive, false);
  if (stored.kind === 'failed') {
    return stored.outcome;
  }
  return { text: `${formatChanges(stored.result)}\n\nLoaded.`, exitCode: 0 };
}

const exists = async (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

/** Writes a subject as a pack: a .zip file, or a folder that does not exist yet or is empty. Never overwrites. */
export async function exportSubject(command: { readonly subject: string; readonly target: string; readonly url: string }, fetchImpl: Fetch = fetch): Promise<Outcome> {
  const asZip = command.target.endsWith('.zip');
  if (asZip ? await exists(command.target) : (await exists(command.target)) && (await readdir(command.target)).length > 0) {
    return failed(`${command.target} already exists${asZip ? '' : ' and is not empty'}; choose another target.`);
  }
  let response: Response;
  try {
    response = await fetchImpl(new URL(`${API_PREFIX}/content/subjects/${encodeURIComponent(command.subject)}/pack?format=zip`, command.url), {
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    // Not propagated: refused or timed out, the advice is the same.
    return failed(`Nothing answers at ${command.url}. Is the application started?`);
  }
  if (response.status === 404) {
    return failed(`There is no subject ${command.subject}.`);
  }
  if (!response.ok || response.headers.get('content-type') !== 'application/zip') {
    return failed(`The application answered ${response.status} without a pack.`);
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  if (asZip) {
    await writeFile(command.target, archive);
    return { text: `Wrote ${command.subject} to ${command.target}.`, exitCode: 0 };
  }
  const files = readZip(archive);
  if (!files.ok) {
    return failed(formatFaults(files.error));
  }
  await writeFolder(command.target, files.value);
  return { text: `Wrote ${command.subject} to ${command.target}/ (${files.value.size} files).`, exitCode: 0 };
}
