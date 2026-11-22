import { InterfaceEventSchema, SubjectSummarySchema, type InterfaceEvent, type Recording } from '@skill-issue/contract';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getJson } from '../../api.js';
import { App } from '../../App.js';
import type { WebModule } from '../../shell/contract.js';
import { catalogueFaults } from '../../shell/messages.js';
import { navigate } from '../../shell/router.js';
import { diagnosticsModule } from './index.js';
import { catalogues } from './messages.js';
import { startRecorder, type Sent } from './recorder.js';
import { ended } from './state.js';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A recorder whose batches are kept as sent, answering each with `answer`. */
function recorded(answer: () => Sent = () => 'kept'): { readonly batches: InterfaceEvent[][]; readonly finish: () => Promise<void>; readonly endedTold: { count: number } } {
  const batches: InterfaceEvent[][] = [];
  const endedTold = { count: 0 };
  const finish = startRecorder({
    send: async (events) => {
      batches.push([...events]);
      return answer();
    },
    sendAtExit: (events) => batches.push([...events]),
    onEnded: () => {
      endedTold.count += 1;
    },
    flushMs: 60_000,
  });
  return { batches, finish, endedTold };
}

/** Each event as the contract takes it, with its moment and page left out, so tests read what happened. */
const what = (batches: readonly InterfaceEvent[][]): unknown[] =>
  batches.flat().map((event) => {
    expect({ event, valid: InterfaceEventSchema.safeParse(event).success }).toEqual({ event, valid: true });
    const { at: _at, page: _page, ...rest } = event;
    return rest;
  });

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('the recorder', () => {
  it('starts with the page the learner is on, and records each page they go to', async () => {
    window.history.replaceState(null, '', '/subjects/energi?language=en');
    const { batches, finish } = recorded();

    navigate('/subjects/energi/lessons/watt');
    await finish();

    expect(batches.flat().map((event) => [event.kind, event.page])).toEqual([
      // The query keeps its names: a value may be what was typed.
      ['navigate', '/subjects/energi?language=…'],
      ['navigate', '/subjects/energi/lessons/watt'],
    ]);
  });

  it('names what was clicked by its text or label, never by what was typed in it, and ignores clicks on nothing that acts', async () => {
    document.body.innerHTML = `
      <p id="prose">Energi är <b id="bold">förmåga</b> att uträtta arbete.</p>
      <button id="go"><span id="inner">Fortsätt</span></button>
      <label><input id="opt" type="radio" name="q"> 230 V</label>
      <label for="answer">Ditt svar</label><input id="answer" type="text" value="hemligt svar">
      <textarea id="note" placeholder="Skriv en anteckning">min privata anteckning</textarea>
      <a id="glossary" href="/x" aria-label="Kilowattimme, ordförklaring">kWh</a>`;
    const { batches, finish } = recorded();

    for (const id of ['bold', 'inner', 'opt', 'answer', 'note', 'glossary']) {
      document.getElementById(id)?.click();
    }
    await finish();

    const clicks = what(batches).filter((event) => (event as { kind: string }).kind === 'click');
    expect(clicks).toEqual([
      { kind: 'click', element: 'button', name: 'Fortsätt' },
      // The radio's own click, then the one the browser sends its label.
      { kind: 'click', element: 'input[type=radio]', name: '230 V' },
      { kind: 'click', element: 'input[type=text]', name: 'Ditt svar' },
      { kind: 'click', element: 'textarea', name: 'Skriv en anteckning' },
      { kind: 'click', element: 'a', name: 'Kilowattimme, ordförklaring' },
    ]);
    expect(JSON.stringify(batches)).not.toMatch(/hemligt|privata/);
  });

  it('records keys outside a field, and inside one only Enter, Escape and Tab', async () => {
    document.body.innerHTML = '<textarea id="note"></textarea><div id="page" tabindex="0"></div>';
    const { batches, finish } = recorded();
    const note = document.getElementById('note');
    const page = document.getElementById('page');

    for (const key of ['h', 'e', 'j', 'Shift', 'Enter', 'Escape']) {
      fireEvent.keyDown(note ?? document, { key, shiftKey: key === 'Shift' });
    }
    fireEvent.keyDown(page ?? document, { key: 'n' });
    fireEvent.keyDown(page ?? document, { key: 'Enter', ctrlKey: true });
    await finish();

    expect(what(batches).filter((event) => (event as { kind: string }).kind === 'key')).toEqual([
      { kind: 'key', key: 'Enter', modifiers: [], inField: true },
      { kind: 'key', key: 'Escape', modifiers: [], inField: true },
      { kind: 'key', key: 'n', modifiers: [], inField: false },
      { kind: 'key', key: 'Enter', modifiers: ['ctrl'], inField: false },
    ]);
  });

  it('records an uncaught error and an unhandled rejection, cut to what the contract takes', async () => {
    const { batches, finish } = recorded();
    const thrown = new TypeError('cannot read step of undefined');
    thrown.stack = `TypeError: cannot read step of undefined\n${'    at frame (app.js:1:1)\n'.repeat(1_000)}`;

    window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught TypeError: cannot read step of undefined', filename: 'http://127.0.0.1:4747/assets/app.js', lineno: 12, colno: 34, error: thrown }));
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = 'the server went away';
    window.dispatchEvent(rejection);
    await finish();

    const [error, rejected] = batches.flat().filter((event) => event.kind === 'error' || event.kind === 'rejection');
    expect(error).toMatchObject({ kind: 'error', message: 'Uncaught TypeError: cannot read step of undefined', source: 'http://127.0.0.1:4747/assets/app.js', line: 12, column: 34 });
    expect(error?.kind === 'error' ? error.stack?.length : undefined).toBe(8_000);
    expect(rejected).toMatchObject({ kind: 'rejection', reason: 'the server went away' });
    what(batches);
  });

  it('records a read the browser gave up on because the answer did not match the contract', async () => {
    vi.stubGlobal('fetch', async () => json([{ id: 'energi' }]));
    const { batches, finish } = recorded();

    await getJson('/content/subjects', SubjectSummarySchema.array(), new AbortController().signal);
    await finish();

    expect(what(batches).filter((event) => (event as { kind: string }).kind === 'fault')).toEqual([{ kind: 'fault', request: '/api/v1/content/subjects', reason: 'contract' }]);
  });

  it('sends in batches of at most fifty, in order, each event once, and the rest when stopped', async () => {
    document.body.innerHTML = '<button id="b">Nästa</button>';
    const { batches, finish } = recorded();

    for (let n = 0; n < 120; n += 1) {
      document.getElementById('b')?.click();
    }
    await finish();

    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 21]);
    const times = batches.flat().map(({ at }) => at);
    expect(times).toEqual(times.toSorted());
    expect(batches.flat().filter(({ kind }) => kind === 'click')).toHaveLength(120);
  });

  it('stops following the session once the server says the recording has ended', async () => {
    document.body.innerHTML = '<button id="b">Nästa</button>';
    const { batches, finish, endedTold } = recorded(() => 'ended');

    for (let n = 0; n < 50; n += 1) {
      document.getElementById('b')?.click();
    }
    await waitFor(() => expect(endedTold.count).toBe(1));
    document.getElementById('b')?.click();
    await finish();

    expect(batches).toHaveLength(1);
  });
});

const RECORDING: Recording = { id: 7, startedAt: '2026-11-22T12:40:00.000Z', endedAt: null, endedBy: null, events: 12, client: {} };
const ENDED: Recording = { id: 6, startedAt: '2026-11-21T09:00:00.000Z', endedAt: '2026-11-21T09:30:00.000Z', endedBy: 'full', events: 20_000, client: {} };

const server: { recording: Recording | null; kept: Recording[]; requests: { method: string; path: string; body: unknown }[] } = { recording: null, kept: [], requests: [] };

beforeEach(() => {
  ended();
  server.recording = null;
  server.kept = [ENDED];
  server.requests = [];
});

function stubServer(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input, 'http://app.test');
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    server.requests.push({ method, path: url.pathname, body });
    switch (`${method} ${url.pathname}`) {
      case 'GET /api/v1/health':
        return json({ status: 'ok', version: 'test', database: 'up', modules: ['diagnostics'] });
      case 'GET /api/v1/content/subjects':
        return json([]);
      case 'GET /api/v1/diagnostics/recording':
        return json({ recording: server.recording });
      case 'GET /api/v1/diagnostics/recordings':
        return json({ recordings: [...(server.recording === null ? [] : [server.recording]), ...server.kept] });
      case 'POST /api/v1/diagnostics/recordings':
        server.recording = RECORDING;
        return json(RECORDING, 201);
      case 'POST /api/v1/diagnostics/recordings/7/events':
        return json({ taken: 1, recording: true });
      case 'POST /api/v1/diagnostics/recordings/7/end': {
        const done = { ...RECORDING, endedAt: '2026-11-22T13:00:00.000Z', endedBy: 'learner' as const };
        server.recording = null;
        server.kept = [done, ...server.kept];
        return json(done);
      }
      case 'DELETE /api/v1/diagnostics/recordings/6':
        server.kept = server.kept.filter(({ id }) => id !== 6);
        return new Response(null, { status: 204 });
      default:
        return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404);
    }
  });
}

function open(path: string, modules: readonly WebModule[] = [diagnosticsModule]): void {
  stubServer();
  window.history.replaceState(null, '', path);
  render(<App modules={modules} />);
}

describe('the diagnostics module', () => {
  it('has every message in every language, with the same placeholders', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
  });

  it('puts a quiet way to it in the footer, which says plainly while a session is recorded', async () => {
    server.recording = RECORDING;
    open('/');

    const link = await screen.findByRole('link', { name: 'Spelar in' });
    expect(link.getAttribute('href')).toBe('/diagnostics');
  });

  it('names itself in the window’s title, whatever page came before', async () => {
    document.title = 'Energi och effekt · Exempelämne';
    open('/diagnostics');

    await screen.findByRole('heading', { name: 'Felsökning' });
    expect(document.title).toBe('Felsökning · Skill Issue');
  });

  it('starts a recording, telling the server the browser, its window and the interface language', async () => {
    open('/diagnostics');

    fireEvent.click(await screen.findByRole('button', { name: 'Börja spela in' }));

    await screen.findByRole('button', { name: 'Sluta spela in' });
    expect(screen.getByRole('link', { name: 'Spelar in' })).toBeTruthy();
    const start = server.requests.find(({ method, path }) => method === 'POST' && path === '/api/v1/diagnostics/recordings');
    expect(start?.body).toEqual({ client: { userAgent: navigator.userAgent, viewport: { width: window.innerWidth, height: window.innerHeight }, interfaceLanguage: 'sv' } });
  });

  it('sends what the browser still holds before it ends the recording, so the recording has everything', async () => {
    server.recording = RECORDING;
    open('/diagnostics');

    fireEvent.click(await screen.findByRole('button', { name: 'Sluta spela in' }));

    await screen.findByRole('button', { name: 'Börja spela in' });
    const writes = server.requests.filter(({ method }) => method === 'POST').map(({ path }) => path);
    expect(writes).toEqual(['/api/v1/diagnostics/recordings/7/events', '/api/v1/diagnostics/recordings/7/end']);
    const sent = server.requests.find(({ path }) => path.endsWith('/events'))?.body as { events: InterfaceEvent[] };
    expect(sent.events.map(({ kind }) => kind)).toEqual(['navigate', 'click']);
    expect(screen.getByRole('link', { name: 'Felsökning' })).toBeTruthy();
  });

  it('lists every recording with its time, its size and how it ended, each with its file to export', async () => {
    open('/diagnostics');

    const row = (await screen.findByText(/20000 händelser/)).closest('li');
    expect(row?.textContent).toContain('avslutad när den blev full');
    expect(screen.getByRole('link', { name: 'Exportera' }).getAttribute('href')).toBe('/api/v1/diagnostics/recordings/6/export');
    expect(screen.getByRole('link', { name: 'Exportera' }).hasAttribute('download')).toBe(true);
  });

  it('removes a recording only once the removal is confirmed', async () => {
    open('/diagnostics');

    fireEvent.click(await screen.findByRole('button', { name: 'Ta bort' }));
    expect(server.requests.some(({ method }) => method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ta bort för gott' }));

    await screen.findByText('Inga inspelningar ännu.');
    expect(server.requests.filter(({ method }) => method === 'DELETE').map(({ path }) => path)).toEqual(['/api/v1/diagnostics/recordings/6']);
  });

  it('leaves nothing in the footer, and has no page, when the module is removed', async () => {
    open('/', []);

    await screen.findByText(/^Servern svarar/);
    expect(screen.queryByRole('link', { name: 'Felsökning' })).toBeNull();
    act(() => navigate('/diagnostics'));
    expect(await screen.findByRole('heading', { name: 'Sidan finns inte' })).toBeTruthy();
  });
});
