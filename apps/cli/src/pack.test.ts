import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoadResult } from '@skill-issue/contract';
import { readFolder, readZip, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { exportSubject, formatFaults, load, validate } from './pack.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');
const APP_URL = 'http://127.0.0.1:4747';

let example: PackFiles;
let scratch: string;

beforeAll(async () => {
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error('example pack unreadable');
  }
  example = read.value;
});

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
  readonly files: PackFiles | undefined;
}

/** A stand-in for the application that answers each request in turn and records what it was sent. */
function fakeApplication(...answers: readonly Response[]): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const queue = [...answers];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const body = init?.body;
    const unpacked = body instanceof ArrayBuffer ? readZip(new Uint8Array(body)) : undefined;
    sent.push({
      url,
      method: init?.method ?? 'GET',
      type: new Headers(init?.headers).get('content-type'),
      files: unpacked?.ok === true ? unpacked.value : undefined,
    });
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(`unexpected request ${url}`);
    }
    return next;
  };
  return { fetch: fake, sent };
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const refusing = async (): Promise<Response> => {
  throw new TypeError('fetch failed');
};

const zipResponse = (): Response =>
  new Response(new Uint8Array(writeZip(example, 'example-subject')).buffer, { status: 200, headers: { 'content-type': 'application/zip' } });

const result = (overrides: Partial<LoadResult>): LoadResult => ({
  subject: 'example-subject',
  stored: false,
  created: false,
  added: [],
  changed: [],
  retired: [],
  unchanged: 0,
  ...overrides,
});

describe('validate', () => {
  it('describes a valid pack', async () => {
    expect(await validate(EXAMPLE)).toEqual({
      text: 'The pack is valid: subject example-subject, 2 areas, 3 lessons, 8 questions, in en, sv.',
      exitCode: 0,
    });
  });

  it('lists the faults of a broken pack under their files', async () => {
    const broken = join(scratch, 'broken.zip');
    const files = new Map(example);
    files.delete('sources/exempelkalla.md');
    await writeFile(broken, writeZip(files, 'broken'));

    const outcome = await validate(broken);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.text.split('\n').slice(0, 4)).toEqual([
      '17 faults:',
      '',
      'areas/fordjupning/lessons/energibalans/lesson.md',
      '  lesson energibalans · sources[0]: expected the id of a source in this pack, found "exempelkalla"  [unknown-source]',
    ]);
  });

  it('says so when there is no pack at the path', async () => {
    expect(await validate(join(scratch, 'nothing'))).toEqual({ text: `No pack at ${join(scratch, 'nothing')}.`, exitCode: 1 });
  });
});

describe('load', () => {
  it('asks first, then stores a new subject, sending the pack as a zip both times', async () => {
    const added = [{ kind: 'lesson' as const, id: 'energibalans', language: 'sv' }];
    const app = fakeApplication(json(200, result({ created: true, added })), json(201, result({ created: true, stored: true, added })));

    const outcome = await load({ path: EXAMPLE, url: APP_URL, yes: false }, app.fetch);

    expect(outcome).toEqual({ text: 'Subject example-subject (new)\n  added    lesson energibalans (sv)\n  0 unchanged\n\nLoaded.', exitCode: 0 });
    expect(app.sent.map(({ url, method, type }) => [url, method, type])).toEqual([
      [`${APP_URL}/api/v1/content/packs?dryRun=true`, 'POST', 'application/zip'],
      [`${APP_URL}/api/v1/content/packs?dryRun=false`, 'POST', 'application/zip'],
    ]);
    expect(app.sent[0]?.files).toEqual(example);
  });

  it('names the archive after the folder when the pack is given as "." or with a trailing "/."', async () => {
    const added = [{ kind: 'lesson' as const, id: 'energibalans', language: 'sv' }];
    const app = fakeApplication(json(200, result({ created: true, added })), json(201, result({ created: true, stored: true, added })));

    await load({ path: `${EXAMPLE}/.`, url: APP_URL, yes: false }, app.fetch);

    // An entry named "./subject.yaml" is refused by the application as a path outside the pack.
    expect(app.sent[0]?.files).toEqual(example);
    expect(app.sent[1]?.files).toEqual(example);
  });

  it('stores nothing in an existing subject without --yes, and shows what would change', async () => {
    const changed = [{ kind: 'question' as const, id: 'kwh-eller-kw', language: 'sv' }];
    const app = fakeApplication(json(200, result({ changed, unchanged: 3 })));

    const outcome = await load({ path: EXAMPLE, url: APP_URL, yes: false }, app.fetch);

    expect(outcome).toEqual({
      text: 'Subject example-subject\n  changed  question kwh-eller-kw (sv)\n  3 unchanged\n\nNothing was stored. This updates an existing subject; run again with --yes to apply it.',
      exitCode: 1,
    });
    expect(app.sent.map((s) => s.url)).toEqual([`${APP_URL}/api/v1/content/packs?dryRun=true`]);
  });

  it('updates an existing subject with --yes', async () => {
    const retired = [{ kind: 'asset' as const, id: 'assets/old.png', language: null }];
    const app = fakeApplication(json(200, result({ retired })), json(200, result({ retired, stored: true })));

    const outcome = await load({ path: EXAMPLE, url: APP_URL, yes: true }, app.fetch);

    expect(outcome).toEqual({ text: 'Subject example-subject\n  retired  asset assets/old.png\n  0 unchanged\n\nLoaded.', exitCode: 0 });
    expect(app.sent.map((s) => s.url)).toEqual([`${APP_URL}/api/v1/content/packs?dryRun=true`, `${APP_URL}/api/v1/content/packs?dryRun=false`]);
  });

  it('sends nothing more when the subject already holds the pack', async () => {
    const app = fakeApplication(json(200, result({ unchanged: 22 })));

    expect(await load({ path: EXAMPLE, url: APP_URL, yes: true }, app.fetch)).toEqual({
      text: 'Nothing to change: subject example-subject already holds this pack (22 items).',
      exitCode: 0,
    });
    expect(app.sent).toHaveLength(1);
  });

  it("prints the application's faults when it rejects the pack", async () => {
    const fault = { code: 'unknown-option', file: 'q.yaml', item: 'question x', field: 'answer', expected: 'one of a, b', found: '"d"' };
    const app = fakeApplication(json(422, { type: 'about:blank', title: 'The pack was not loaded', status: 422, faults: [fault] }));

    expect(await load({ path: EXAMPLE, url: APP_URL, yes: false }, app.fetch)).toEqual({
      text: `The pack was not loaded.\n${formatFaults([fault])}`,
      exitCode: 1,
    });
  });

  it('says so when nothing answers', async () => {
    expect(await load({ path: EXAMPLE, url: APP_URL, yes: false }, refusing)).toEqual({
      text: `Nothing answers at ${APP_URL}. Is the application started?`,
      exitCode: 1,
    });
  });
});

describe('exportSubject', () => {
  it('writes a .zip file as the application sent it', async () => {
    const target = join(scratch, 'out.zip');
    const app = fakeApplication(zipResponse());

    const outcome = await exportSubject({ subject: 'example-subject', target, url: APP_URL }, app.fetch);

    expect(outcome).toEqual({ text: `Wrote example-subject to ${target}.`, exitCode: 0 });
    expect(app.sent.map((s) => s.url)).toEqual([`${APP_URL}/api/v1/content/subjects/example-subject/pack?format=zip`]);
    expect(readZip(await readFile(target))).toEqual({ ok: true, value: example });
  });

  it('writes a folder that reads back as the same pack', async () => {
    const target = join(scratch, 'out');

    const outcome = await exportSubject({ subject: 'example-subject', target, url: APP_URL }, fakeApplication(zipResponse()).fetch);

    expect(outcome).toEqual({ text: `Wrote example-subject to ${target}/ (${example.size} files).`, exitCode: 0 });
    expect(await readFolder(target)).toEqual({ ok: true, value: example });
  });

  it('never overwrites a file or a folder with something in it', async () => {
    const file = join(scratch, 'taken.zip');
    await writeFile(file, 'mine');
    const app = fakeApplication();

    expect(await exportSubject({ subject: 'example-subject', target: file, url: APP_URL }, app.fetch)).toEqual({
      text: `${file} already exists; choose another target.`,
      exitCode: 1,
    });
    expect(await exportSubject({ subject: 'example-subject', target: scratch, url: APP_URL }, app.fetch)).toEqual({
      text: `${scratch} already exists and is not empty; choose another target.`,
      exitCode: 1,
    });
    expect(await readFile(file, 'utf8')).toBe('mine');
    expect(app.sent).toEqual([]);
  });

  it('says so when there is no such subject', async () => {
    const app = fakeApplication(json(404, { type: 'about:blank', title: 'No such subject', status: 404 }));

    expect(await exportSubject({ subject: 'nope', target: join(scratch, 'x.zip'), url: APP_URL }, app.fetch)).toEqual({
      text: 'There is no subject nope.',
      exitCode: 1,
    });
  });
});
