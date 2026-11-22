import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Backup } from '@skill-issue/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backup, exportNotes, restore } from './backup.js';

const APP_URL = 'http://127.0.0.1:4747';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'skill-issue-cli-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly type: string | null;
  readonly body: string | undefined;
}

/** A stand-in for the application that answers each request in turn and records what it was sent. */
function fakeApplication(...answers: readonly Response[]): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const queue = [...answers];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    sent.push({ url, method: init?.method ?? 'GET', type: new Headers(init?.headers).get('content-type'), body: typeof init?.body === 'string' ? init.body : undefined });
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(`unexpected request ${url}`);
    }
    return next;
  };
  return { fetch: fake, sent };
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const BACKUP: Backup = {
  format: 'skill-issue-backup',
  formatVersion: 1,
  application: '0.1.0',
  createdAt: '2026-11-22T10:00:00.000Z',
  migrations: { core: ['0001_catalogue'] },
  tables: [
    { owner: 'core', table: 'catalogue.subject', rows: [{ id: 'energi' }, { id: 'statistik' }] },
    { owner: 'core', table: 'record.event', rows: [{ seq: 1, kind: 'answer' }, { seq: 2, kind: 'step' }, { seq: 3, kind: 'answer' }] },
    { owner: 'notes', table: 'notes.note', rows: [{ body: 'En anteckning.' }] },
  ],
};

describe('backup', () => {
  it('writes what the application answers to the file, and says what is in it', async () => {
    const app = fakeApplication(json(BACKUP));
    const target = join(scratch, 'b.json');

    const outcome = await backup({ target, url: APP_URL }, app.fetch);

    expect(outcome).toEqual({ text: `Backed up 2 subjects, 3 rows of the learning record and 1 note to ${target}.`, exitCode: 0 });
    expect(app.sent.map(({ url, method }) => [method, url])).toEqual([['GET', `${APP_URL}/api/v1/backup`]]);
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual(BACKUP);
  });

  it('never writes over a file that is there, and asks the application nothing', async () => {
    const app = fakeApplication();
    const target = join(scratch, 'b.json');
    await writeFile(target, 'an earlier backup');

    const outcome = await backup({ target, url: APP_URL }, app.fetch);

    expect(outcome).toEqual({ text: `${target} already exists; choose another file.`, exitCode: 1 });
    expect(app.sent).toEqual([]);
    expect(await readFile(target, 'utf8')).toBe('an earlier backup');
  });

  it('writes nothing when the answer is not a backup', async () => {
    const app = fakeApplication(json({ status: 'ok' }));
    const target = join(scratch, 'b.json');

    expect(await backup({ target, url: APP_URL }, app.fetch)).toEqual({ text: `Something answers at ${APP_URL}, but it did not send a backup.`, exitCode: 1 });
    await expect(readFile(target)).rejects.toThrow(/ENOENT/);
  });
});

describe('restore', () => {
  it('sends the file as JSON and says what was restored, table by table', async () => {
    const path = join(scratch, 'b.json');
    await writeFile(path, JSON.stringify(BACKUP));
    const app = fakeApplication(json({ dryRun: false, tables: [{ owner: 'core', table: 'catalogue.subject', rows: 2 }, { owner: 'notes', table: 'notes.note', rows: 1 }] }));

    const outcome = await restore({ path, url: APP_URL, dryRun: false }, app.fetch);

    expect(outcome).toEqual({ text: 'Restored:\n  catalogue.subject  2 rows\n  notes.note         1 row', exitCode: 0 });
    expect(app.sent).toEqual([{ url: `${APP_URL}/api/v1/backup?dryRun=false`, method: 'POST', type: 'application/json', body: JSON.stringify(BACKUP) }]);
  });

  it('with --dry-run says what would be restored', async () => {
    const path = join(scratch, 'b.json');
    await writeFile(path, JSON.stringify(BACKUP));
    const app = fakeApplication(json({ dryRun: true, tables: [{ owner: 'core', table: 'catalogue.subject', rows: 2 }] }));

    const outcome = await restore({ path, url: APP_URL, dryRun: true }, app.fetch);

    expect(outcome).toEqual({ text: 'The backup restores into this installation. Nothing was written; it would restore:\n  catalogue.subject  2 rows', exitCode: 0 });
    expect(app.sent[0]?.url).toBe(`${APP_URL}/api/v1/backup?dryRun=true`);
  });

  it('passes on why the application refused it', async () => {
    const path = join(scratch, 'b.json');
    await writeFile(path, JSON.stringify(BACKUP));
    const app = fakeApplication(json({ type: 'about:blank', title: 'The installation is not empty', status: 409, detail: 'catalogue.subject already holds rows.' }, 409));

    expect(await restore({ path, url: APP_URL, dryRun: false }, app.fetch)).toEqual({ text: 'The installation is not empty: catalogue.subject already holds rows.', exitCode: 1 });
  });

  it('refuses a file that is not JSON before sending it', async () => {
    const path = join(scratch, 'b.json');
    await writeFile(path, 'not json');
    const app = fakeApplication();

    expect(await restore({ path, url: APP_URL, dryRun: false }, app.fetch)).toEqual({ text: `${path} is not a backup: it is not JSON.`, exitCode: 1 });
    expect(app.sent).toEqual([]);
  });
});

describe('export-notes', () => {
  it('asks for the notes in the languages given and writes the file', async () => {
    const markdown = '# Energi — notes\n\n## Grunder\n';
    const app = fakeApplication(new Response(markdown, { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8' } }));
    const target = join(scratch, 'n.md');

    const outcome = await exportNotes({ subject: 'energi', target, url: APP_URL, language: 'sv', interfaceLanguage: 'en' }, app.fetch);

    expect(outcome).toEqual({ text: `Wrote the notes of energi to ${target}.`, exitCode: 0 });
    expect(app.sent.map(({ url }) => url)).toEqual([`${APP_URL}/api/v1/notes/subjects/energi/notes.md?interface=en&language=sv`]);
    expect(await readFile(target, 'utf8')).toBe(markdown);
  });

  it('leaves the content language to the subject when none is given', async () => {
    const app = fakeApplication(new Response('# x\n', { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8' } }));

    await exportNotes({ subject: 'energi', target: join(scratch, 'n.md'), url: APP_URL, language: undefined, interfaceLanguage: 'sv' }, app.fetch);

    expect(app.sent.map(({ url }) => url)).toEqual([`${APP_URL}/api/v1/notes/subjects/energi/notes.md?interface=sv`]);
  });

  it('says there is no such subject, and writes nothing', async () => {
    const app = fakeApplication(json({ type: 'about:blank', title: 'No such subject', status: 404 }, 404));
    const target = join(scratch, 'n.md');

    expect(await exportNotes({ subject: 'finns-inte', target, url: APP_URL, language: undefined, interfaceLanguage: 'en' }, app.fetch)).toEqual({ text: 'There is no subject finns-inte.', exitCode: 1 });
    await expect(readFile(target)).rejects.toThrow(/ENOENT/);
  });
});
