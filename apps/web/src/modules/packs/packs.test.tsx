import type { ContentFault, LoadResult } from '@skill-issue/contract';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { catalogueFaults } from '../../shell/messages.js';
import { packsModule } from './index.js';
import { catalogues } from './messages.js';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const RESULT: LoadResult = { subject: 'statistik', stored: false, created: true, added: [], changed: [], retired: [], unchanged: 0 };
const ref = (id: string) => ({ kind: 'question' as const, id, language: 'sv' });

interface Server {
  /** The answer to a pack, by whether it is a dry run. */
  answer: (dryRun: boolean) => Response;
  readonly sent: { dryRun: string | null; type: string | null; size: number }[];
}
let server: Server;

beforeEach(() => {
  server = { answer: () => json(RESULT), sent: [] };
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input, 'http://app.test');
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/api/v1/health') {
      return json({ status: 'ok', version: '0.1.0', database: 'up', modules: [] });
    }
    if (method === 'POST' && url.pathname === '/api/v1/content/packs') {
      const body = init?.body;
      server.sent.push({ dryRun: url.searchParams.get('dryRun'), type: new Headers(init?.headers).get('content-type'), size: body instanceof Blob ? body.size : -1 });
      return server.answer(url.searchParams.get('dryRun') === 'true');
    }
    return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404);
  });
  window.history.replaceState(null, '', '/packs');
  render(<App modules={[packsModule]} />);
});

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

const zip = (name = 'statistik.zip'): File => new File([new Uint8Array([0x50, 0x4b, 3, 4])], name, { type: 'application/zip' });

const choose = async (file: File): Promise<void> => {
  await userEvent.upload(await screen.findByLabelText('Välj fil'), file);
};

const drop = async (file: File): Promise<void> => {
  const zone = (await screen.findByText('Släpp en zip-fil här')).closest('.dropzone');
  if (zone === null) {
    throw new Error('no drop zone');
  }
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
};

describe('loading a subject from the browser', () => {
  it('has every message in every language, with the same placeholders', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
  });

  it('is reached from the footer, and names itself in the window title', async () => {
    expect(await screen.findByRole('heading', { level: 1, name: 'Ladda in ämne' })).toBeTruthy();
    expect(screen.getByRole('contentinfo').querySelector('a[href="/packs"]')?.textContent).toBe('Ladda in ämne');
    expect(document.title).toBe('Ladda in ämne · Skill Issue');
  });

  it('checks a chosen zip first, says what it would add, and stores it only on the learner’s word', async () => {
    server.answer = (dryRun) => json({ ...RESULT, stored: !dryRun, added: [ref('a'), ref('b'), ref('c')] }, dryRun ? 200 : 201);
    await choose(zip());

    expect(await screen.findByRole('heading', { name: 'Ett nytt ämne: statistik' })).toBeTruthy();
    expect(screen.getByText('3 nya.')).toBeTruthy();
    expect(server.sent).toEqual([{ dryRun: 'true', type: 'application/zip', size: 4 }]);

    await userEvent.click(screen.getByRole('button', { name: 'Ladda in' }));

    expect(await screen.findByRole('heading', { name: 'statistik är inläst' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Öppna ämnet' }).getAttribute('href')).toBe('/subjects/statistik');
    expect(server.sent.map((sent) => sent.dryRun)).toEqual(['true', 'false']);
  });

  it('takes a zip dropped on the page as well', async () => {
    await drop(zip());

    expect(await screen.findByRole('heading', { name: 'Ett nytt ämne: statistik' })).toBeTruthy();
  });

  it('says what an update changes, and that the learner’s history is kept', async () => {
    server.answer = () => json({ ...RESULT, created: false, added: [ref('a')], changed: [ref('b'), ref('c')], retired: [ref('d')], unchanged: 40 });
    await choose(zip());

    expect(await screen.findByRole('heading', { name: 'Uppdaterar ämnet statistik' })).toBeTruthy();
    expect(screen.getByText('1 ny, 2 ändrade, 1 tas bort ur ämnet, 40 oförändrade.')).toBeTruthy();
    expect(screen.getByText('Det du har gjort i ämnet finns kvar.')).toBeTruthy();
  });

  it('says so when the pack is already loaded exactly as it is, and offers nothing to load', async () => {
    server.answer = () => json({ ...RESULT, created: false, unchanged: 12 });
    await choose(zip());

    expect(await screen.findByRole('heading', { name: 'statistik är redan inläst precis så här. Inget ändras.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ladda in' })).toBeNull();
  });

  it('lists every fault with its file, item and field, and stores nothing', async () => {
    const faults: ContentFault[] = [
      { code: 'schema', file: 'areas/a/lessons/b/questions.yaml', item: 'question q1', field: 'answer', expected: 'one of the option ids', found: '"e"' },
      { code: 'unknown-source', file: 'areas/a/lessons/b/lesson.md', item: 'lesson b', field: 'sources[0]', expected: 'a source in this pack', found: '"x"' },
    ];
    server.answer = () => json({ type: 'about:blank', title: 'The pack breaks the format', status: 422, faults }, 422);
    await choose(zip());

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading').textContent).toBe('Paketet har 2 fel');
    expect(within(alert).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'areas/a/lessons/b/questions.yaml · question q1 · answerVäntade one of the option ids, fick "e".',
      'areas/a/lessons/b/lesson.md · lesson b · sources[0]Väntade a source in this pack, fick "x".',
    ]);
    expect(server.sent.map((sent) => sent.dryRun)).toEqual(['true']);
  });

  it('refuses a file dropped that is not a zip before sending anything', async () => {
    // The file chooser offers only zip files; a drop can bring anything.
    await drop(new File(['hej'], 'anteckningar.txt', { type: 'text/plain' }));

    expect((await screen.findByRole('alert')).textContent).toBe('anteckningar.txt är ingen zip-fil. Packa ämnets mapp som en .zip och försök igen.');
    expect(server.sent).toEqual([]);
  });

  it('gives the server’s own words when it refuses the pack as a whole', async () => {
    server.answer = () => json({ type: 'about:blank', title: 'The pack is too large', status: 413, detail: 'A pack may be at most 64 MB.' }, 413);
    await choose(zip());

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading').textContent).toBe('The pack is too large');
    expect(within(alert).getByText('A pack may be at most 64 MB.')).toBeTruthy();
  });
});
