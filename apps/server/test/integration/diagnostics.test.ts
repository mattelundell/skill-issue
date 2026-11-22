import {
  RECORDING_MAX_EVENTS,
  RecordingListSchema,
  RecordingSchema,
  RecordingStateSchema,
  SessionFileSchema,
  type InterfaceEvent,
  type Recording,
  type SessionFile,
} from '@skill-issue/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

const BASE = '/api/v1/diagnostics';

let here: Installation;

beforeEach(async () => {
  here = await install();
});

afterEach(async () => {
  await here.drop();
});

async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: unknown }> {
  const response = await here.app.request(path, {
    method: init.method ?? 'GET',
    ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text === '' ? undefined : JSON.parse(text) };
}

async function start(client: unknown = { userAgent: 'test-browser', viewport: { width: 1440, height: 900 }, interfaceLanguage: 'sv' }): Promise<Recording> {
  const { status, json } = await call(`${BASE}/recordings`, { method: 'POST', body: { client } });
  expect(status).toBe(201);
  return RecordingSchema.parse(json);
}

async function exported(id: number): Promise<SessionFile> {
  const response = await here.app.request(`${BASE}/recordings/${id}/export`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="skill-issue-session-${id}-\\d{4}-\\d{2}-\\d{2}\\.json"$`));
  return SessionFileSchema.parse(await response.json());
}

/** Each event as one line naming what it was, enough to tell any two apart. */
const lines = (file: SessionFile): string[] =>
  file.events.map(({ source, event }) => {
    switch (event.kind) {
      case 'call':
        return `${source} ${event.method} ${event.url} ${event.status}`;
      case 'navigate':
        return `${source} navigate ${event.page}`;
      case 'click':
        return `${source} click ${event.element} ${event.name ?? ''}`;
      case 'key':
        return `${source} key ${event.key}`;
      case 'error':
      case 'rejection':
      case 'visibility':
      case 'fault':
        return `${source} ${event.kind}`;
      default: {
        const unhandled: never = event;
        return unhandled;
      }
    }
  });

const at = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();

describe('a recording', () => {
  it('records nothing until it is started', async () => {
    await call('/api/v1/health');
    await call('/api/v1/content/subjects');

    expect(RecordingStateSchema.parse((await call(`${BASE}/recording`)).json)).toEqual({ recording: null });
    const recording = await start();
    await call('/api/v1/content/subjects?language=en');

    expect(lines(await exported(recording.id))).toEqual(['api GET /api/v1/content/subjects?language=… 200']);
  });

  it('keeps the browser it was started in, and is the one under way', async () => {
    const recording = await start();

    expect(recording).toMatchObject({ endedAt: null, endedBy: null, events: 0, client: { userAgent: 'test-browser', viewport: { width: 1440, height: 900 }, interfaceLanguage: 'sv' } });
    expect(RecordingStateSchema.parse((await call(`${BASE}/recording`)).json)).toEqual({ recording });
  });

  it('is given back, not doubled, when started while under way', async () => {
    const first = await start();

    const again = await call(`${BASE}/recordings`, { method: 'POST', body: {} });

    expect(again.status).toBe(200);
    expect(RecordingSchema.parse(again.json).id).toBe(first.id);
    expect(RecordingListSchema.parse((await call(`${BASE}/recordings`)).json).recordings.map(({ id }) => id)).toEqual([first.id]);
  });

  it('keeps the names in a called address’s query and never their values, which may be what the learner typed', async () => {
    const recording = await start();

    await call('/api/v1/notes/subjects/no-such-subject/notes?q=min+hemliga+s%C3%B6kning&lesson=watt&q=igen');

    const file = await exported(recording.id);
    expect(lines(file)).toEqual(['api GET /api/v1/notes/subjects/no-such-subject/notes?q=…&lesson=… 404']);
    expect(JSON.stringify(file)).not.toMatch(/hemlig|igen|watt/);
  });

  it('records a refused call with its problem, and none of its own calls', async () => {
    const recording = await start();

    await call('/api/v1/content/subjects/no-such-subject');
    await call(`${BASE}/recordings`);

    const file = await exported(recording.id);
    expect(lines(file)).toEqual(['api GET /api/v1/content/subjects/no-such-subject 404']);
    expect(file.events[0]?.event).toMatchObject({ kind: 'call', problem: { title: 'No such subject' } });
  });

  it('interleaves what the browser saw with the calls, in the order they happened', async () => {
    const recording = await start();
    await call('/api/v1/health');
    const browser: InterfaceEvent[] = [
      { kind: 'navigate', at: at(-60_000), page: '/' },
      { kind: 'click', at: at(-50_000), page: '/', element: 'a', role: 'link', name: 'Energi' },
      { kind: 'key', at: at(60_000), page: '/subjects/energi', key: 'Enter', modifiers: [], inField: true },
    ];

    const sent = await call(`${BASE}/recordings/${recording.id}/events`, { method: 'POST', body: { events: browser } });

    expect(sent).toEqual({ status: 200, json: { taken: 3, recording: true } });
    const file = await exported(recording.id);
    expect(lines(file)).toEqual(['interface navigate /', 'interface click a Energi', 'api GET /api/v1/health 200', 'interface key Enter']);
    expect(file.events.filter(({ source }) => source === 'interface').map(({ event }) => event)).toEqual(browser);
    expect(file).toMatchObject({ format: 'skill-issue-session', formatVersion: 1, appVersion: 'test', recording: { id: recording.id, events: 4 } });
  });

  it('refuses an event carrying anything not in its shape, such as what was typed, and keeps none of the batch', async () => {
    const recording = await start();

    const sent = await call(`${BASE}/recordings/${recording.id}/events`, {
      method: 'POST',
      body: {
        events: [
          { kind: 'navigate', at: at(0), page: '/' },
          { kind: 'key', at: at(0), page: '/', key: 'a', modifiers: [], inField: true, value: 'my password' },
        ],
      },
    });

    expect(sent.status).toBe(400);
    expect(JSON.stringify(sent.json)).toContain('events.1');
    expect(lines(await exported(recording.id))).toEqual([]);
  });

  it('stops recording when ended, and takes no more from the browser', async () => {
    const recording = await start();

    const ended = await call(`${BASE}/recordings/${recording.id}/end`, { method: 'POST' });
    await call('/api/v1/health');
    const late = await call(`${BASE}/recordings/${recording.id}/events`, { method: 'POST', body: { events: [{ kind: 'navigate', at: at(0), page: '/' }] } });

    expect(ended.status).toBe(200);
    expect(RecordingSchema.parse(ended.json)).toMatchObject({ id: recording.id, endedBy: 'learner' });
    expect(late.status).toBe(409);
    expect(RecordingStateSchema.parse((await call(`${BASE}/recording`)).json)).toEqual({ recording: null });
    expect(lines(await exported(recording.id))).toEqual([]);
  });

  it('ends itself as full, keeping what fits and dropping the rest', async () => {
    const recording = await start();
    await here.db.query('UPDATE diagnostics.recording SET events = $1 WHERE id = $2', [RECORDING_MAX_EVENTS - 2, recording.id]);
    const pages = ['/one', '/two', '/three', '/four'];

    const sent = await call(`${BASE}/recordings/${recording.id}/events`, {
      method: 'POST',
      body: { events: pages.map((page, n) => ({ kind: 'navigate', at: at(n), page })) },
    });
    await call('/api/v1/health');

    expect(sent).toEqual({ status: 200, json: { taken: 2, recording: false } });
    const file = await exported(recording.id);
    expect(lines(file)).toEqual(['interface navigate /one', 'interface navigate /two']);
    expect(file.recording).toMatchObject({ endedBy: 'full', events: RECORDING_MAX_EVENTS });
  });

  it('is removed with everything it saw', async () => {
    const recording = await start();
    await call('/api/v1/health');

    const removed = await call(`${BASE}/recordings/${recording.id}`, { method: 'DELETE' });

    expect(removed.status).toBe(204);
    expect((await call(`${BASE}/recordings/${recording.id}/export`)).status).toBe(404);
    expect(await here.db.query('SELECT 1 FROM diagnostics.event')).toEqual([]);
    expect(RecordingStateSchema.parse((await call(`${BASE}/recording`)).json)).toEqual({ recording: null });
  });

  it('answers 404 for a recording that does not exist', async () => {
    for (const [method, path] of [
      ['POST', `${BASE}/recordings/999/end`],
      ['GET', `${BASE}/recordings/999/export`],
      ['DELETE', `${BASE}/recordings/999`],
      ['GET', `${BASE}/recordings/abc/export`],
    ] as const) {
      expect((await call(path, { method })).status, `${method} ${path}`).toBe(404);
    }
    expect((await call(`${BASE}/recordings/999/events`, { method: 'POST', body: { events: [{ kind: 'navigate', at: at(0), page: '/' }] } })).status).toBe(404);
  });
});
