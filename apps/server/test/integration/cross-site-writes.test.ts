import { join } from 'node:path';
import { readFolder, writeZip } from '@skill-issue/pack';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

/**
 * A page on any site open in the learner's browser can send a POST without
 * asking first, so long as its body is plain text, a form, or nothing. The
 * body may still be valid JSON. Such a request must change nothing.
 */

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const BASE = '/api/v1/assessment/subjects/example-subject';

let here: Installation;

beforeEach(async () => {
  here = await install();
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(read.error)}`);
  }
  const loaded = await here.app.request('/api/v1/content/packs', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: new Uint8Array(writeZip(read.value, 'example-subject')).buffer,
  });
  if (loaded.status !== 201) {
    throw new Error(`example pack refused: ${loaded.status} ${await loaded.text()}`);
  }
});

afterEach(async () => {
  await here.drop();
});

/** Sent as a page on another site can send it: valid JSON, labelled as plain text. */
async function crossSite(path: string, body: unknown, contentType: string | undefined = 'text/plain;charset=UTF-8'): Promise<{ status: number; title: unknown }> {
  const response = await here.app.request(path, {
    method: 'POST',
    // A string body is labelled text/plain by the Request itself; bytes carry no type at all.
    ...(contentType === undefined ? { body: new TextEncoder().encode(JSON.stringify(body)) } : { headers: { 'content-type': contentType }, body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json();
  return { status: response.status, title: typeof json === 'object' && json !== null && 'title' in json ? json.title : undefined };
}

const recorded = async () => here.db.query('SELECT kind, item_id FROM record.event ORDER BY seq');

const ANSWER = { answer: { type: 'single-choice', option: 'b' }, durationMs: 1200, timeZone: 'Europe/Stockholm', setting: 'review' };

describe('a write from another site', () => {
  it('cannot answer a question: refused with 415, and the record holds nothing', async () => {
    expect(await crossSite(`${BASE}/questions/kwh-eller-kw/answers`, ANSWER)).toEqual({ status: 415, title: 'Send the request as application/json' });
    expect(await recorded()).toEqual([]);
  });

  it('cannot answer as a form, nor with no type at all', async () => {
    expect((await crossSite(`${BASE}/questions/kwh-eller-kw/answers`, ANSWER, 'application/x-www-form-urlencoded')).status).toBe(415);
    expect((await crossSite(`${BASE}/questions/kwh-eller-kw/answers`, ANSWER, 'multipart/form-data; boundary=x')).status).toBe(415);
    expect((await crossSite(`${BASE}/questions/kwh-eller-kw/answers`, ANSWER, undefined)).status).toBe(415);
    const bare = await here.app.request(`${BASE}/exams`, { method: 'POST' });
    expect(bare.status).toBe(415);
    expect(await here.db.query('SELECT id FROM assessment.sitting')).toEqual([]);
    expect(await recorded()).toEqual([]);
  });

  it('cannot start an exam: refused with 415, and no sitting is begun', async () => {
    expect(await crossSite(`${BASE}/exams`, { scope: { kind: 'lesson', id: 'energi-och-effekt' } })).toEqual({ status: 415, title: 'Send the request as application/json' });
    expect(await here.db.query('SELECT id FROM assessment.sitting')).toEqual([]);
    expect(await recorded()).toEqual([]);
  });

  it('cannot hand in an exam begun by the learner: refused with 415, and the sitting stays open with nothing recorded', async () => {
    const started = await here.app.request(`${BASE}/exams`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: { kind: 'lesson', id: 'energi-och-effekt' } }) });
    expect(started.status).toBe(201);
    const { id } = (await started.json()) as { id: string };

    expect(await crossSite(`${BASE}/exams/${id}`, { answers: [], timeZone: 'Europe/Stockholm' })).toEqual({ status: 415, title: 'Send the request as application/json' });

    expect(await here.db.query('SELECT submitted_at FROM assessment.sitting WHERE id = $1', [id])).toEqual([{ submitted_at: null }]);
    expect(await recorded()).toEqual([]);
  });

  it('cannot start a recording of the session, nor add to one', async () => {
    expect(await crossSite('/api/v1/diagnostics/recordings', {})).toEqual({ status: 415, title: 'Send the request as application/json' });
    expect(await here.db.query('SELECT id FROM diagnostics.recording')).toEqual([]);

    const started = await here.app.request('/api/v1/diagnostics/recordings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const { id } = (await started.json()) as { id: number };
    const events = { events: [{ kind: 'navigate', at: new Date().toISOString(), page: '/planted' }] };
    expect((await crossSite(`/api/v1/diagnostics/recordings/${id}/events`, events)).status).toBe(415);
    expect((await crossSite(`/api/v1/diagnostics/recordings/${id}/end`, {})).status).toBe(415);

    expect(await here.db.query('SELECT body FROM diagnostics.event')).toEqual([]);
    expect(await here.db.query('SELECT ended_at FROM diagnostics.recording WHERE id = $1', [id])).toEqual([{ ended_at: null }]);
  });

  it('still lets the learner’s own JSON through, with its charset', async () => {
    const response = await here.app.request(`${BASE}/questions/kwh-eller-kw/answers`, {
      method: 'POST',
      headers: { 'content-type': 'Application/JSON; charset=utf-8' },
      body: JSON.stringify(ANSWER),
    });

    expect(response.status).toBe(200);
    expect(await recorded()).toEqual([{ kind: 'answer', item_id: 'kwh-eller-kw' }]);
  });
});
