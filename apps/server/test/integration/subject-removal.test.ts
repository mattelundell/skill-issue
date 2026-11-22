import { join } from 'node:path';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const ZONE = 'Europe/Stockholm';

let example: PackFiles;
let here: Installation;

beforeAll(async () => {
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example unreadable: ${JSON.stringify(read.error)}`);
  }
  example = read.value;
});

beforeEach(async () => {
  here = await install();
  await load();
});

afterEach(async () => {
  await here.drop();
});

async function load(): Promise<number> {
  const response = await here.app.request('/api/v1/content/packs', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: new Uint8Array(writeZip(example, 'example-subject')).buffer });
  return response.status;
}

const call = async (method: string, path: string, body?: unknown): Promise<number> =>
  (await here.app.request(`/api/v1${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })).status;

const listed = async (): Promise<string[]> => ((await (await here.app.request('/api/v1/content/subjects')).json()) as { id: string }[]).map((subject) => subject.id);

/** Studied a little: a question answered wrongly, so it is due again today, and a lesson begun. */
async function studied(): Promise<void> {
  expect(await call('POST', '/assessment/subjects/example-subject/questions/kwh-eller-kw/answers', { answer: { type: 'single-choice', option: 'a' }, durationMs: 2000, timeZone: ZONE, setting: 'review' })).toBe(200);
  expect(await call('PUT', '/lessons/subjects/example-subject/lessons/energi-och-effekt/position', { step: 1, revision: 1, timeZone: ZONE })).toBe(200);
}

describe('removing a subject', () => {
  it('takes it out of the application everywhere, and keeps its history', async () => {
    await studied();
    const record = await here.db.query('SELECT seq FROM record.event ORDER BY seq');
    expect(Object.keys(((await (await here.app.request(`/api/v1/review/due?timeZone=${ZONE}`)).json()) as { subjects: object }).subjects)).toEqual(['example-subject']);

    expect(await call('DELETE', '/content/subjects/example-subject')).toBe(204);

    expect(await listed()).toEqual([]);
    expect(await call('GET', '/content/subjects/example-subject')).toBe(404);
    expect(await call('GET', '/lessons/subjects/example-subject/positions')).toBe(404);
    expect(await call('GET', '/lessons/subjects/example-subject/lessons/energi-och-effekt')).toBe(404);
    expect(await call('GET', `/review/subjects/example-subject/due?timeZone=${ZONE}`)).toBe(404);
    expect(await (await here.app.request(`/api/v1/review/due?timeZone=${ZONE}`)).json()).toEqual({ subjects: {}, questions: [] });
    // The record is append-only: nothing in it was touched.
    expect(await here.db.query('SELECT seq FROM record.event ORDER BY seq')).toEqual(record);
  });

  it('comes back with its history when its pack is loaded again', async () => {
    await studied();
    expect(await call('DELETE', '/content/subjects/example-subject')).toBe(204);

    expect(await load()).toBe(200);

    expect(await listed()).toEqual(['example-subject']);
    const positions = (await (await here.app.request('/api/v1/lessons/subjects/example-subject/positions')).json()) as { lessons: Record<string, { step: number }> };
    expect(positions.lessons['energi-och-effekt']?.step).toBe(1);
  });

  it('answers 404 for a subject that does not exist, or is already removed', async () => {
    expect(await call('DELETE', '/content/subjects/no-such-subject')).toBe(404);
    expect(await call('DELETE', '/content/subjects/example-subject')).toBe(204);
    expect(await call('DELETE', '/content/subjects/example-subject')).toBe(404);
  });
});
