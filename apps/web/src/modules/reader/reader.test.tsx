import type { LibrarySource, SourceLibrary, SourcePage, SubjectOutline } from '@skill-issue/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import type { WebModule } from '../../shell/contract.js';
import { catalogueFaults } from '../../shell/messages.js';
import { readerModule } from './index.js';
import { catalogues } from './messages.js';

const OUTLINE: SubjectOutline = {
  id: 'energi',
  defaultLanguage: 'sv',
  languages: ['sv'],
  language: 'sv',
  title: 'Energi och hållbarhet',
  summary: 'Från grunden.',
  areas: [{ id: 'grunder', language: 'sv', title: 'Grunder', summary: 'Storheterna.', requires: [], lessons: [{ id: 'etal', language: 'sv', title: 'Energiprestandatal', summary: 'Etal.' }] }],
};

const source = (id: string, title: string, publisher: string, accessed: string, cited: LibrarySource['cited'], body = 'Text.'): LibrarySource => ({
  id,
  language: 'sv',
  title,
  publisher,
  url: `https://${publisher.toLowerCase()}.example/${id}`,
  accessed,
  licence: 'unknown',
  kind: 'summary',
  body,
  cited,
});

// In pack order. The most used is not first, the newest is not first, and the alphabetically first is not first, so each ordering shows.
const LIBRARY: SourceLibrary = {
  subjectId: 'energi',
  sources: [
    source('lcc', 'Livscykelkostnad', 'Energimyndigheten', '2026-11-19', { lessons: 1, questions: 7, terms: 3 }, 'Nuvärde, kalkylränta och **återbetalningstid**.'),
    source('bfs', 'BFS 2026:9', 'Boverket', '2026-11-20', { lessons: 6, questions: 22, terms: 4 }, '## Etal\n\nEnergiprestandatal (Etal) per m² Atemp.'),
    source('smhi', 'Graddagar', 'SMHI', '2026-11-21', { lessons: 2, questions: 9, terms: 2 }),
    source('handbok', 'Beräkning av Etal', 'Boverket', '2026-11-18', { lessons: 4, questions: 13, terms: 2 }),
    source('lth', 'Teoridel', 'LTH', '2026-11-17', { lessons: 0, questions: 0, terms: 0 }),
  ],
};

const CURRENT: SourcePage = {
  status: 'current',
  source: { id: 'bfs', language: 'sv', title: 'BFS 2026:9', publisher: 'Boverket', url: 'https://rinfo.boverket.se/BFS2026-9.pdf', accessed: '2026-11-20', licence: 'unknown', kind: 'summary', body: '## Viktningsfaktorer\n\n| Bärare | Faktor |\n|---|---|\n| El | 1,8 |\n' },
  areas: [
    { id: 'grunder', language: 'sv', title: 'Grunder', lessons: [{ id: 'etal', language: 'sv', title: 'Energiprestandatal', questions: 6 }] },
    { id: 'berakning', language: 'sv', title: 'Energiberäkning', lessons: [{ id: 'marginaler', language: 'sv', title: 'Säkerhetsmarginaler', questions: 1 }] },
  ],
  terms: [{ id: 'fgeo', language: 'sv', term: 'Fgeo', definition: 'Geografisk justeringsfaktor.' }],
};

interface FakeApi {
  library: SourceLibrary | 'failing';
  pages: Map<string, SourcePage>;
  readonly requested: string[];
}
let api: FakeApi;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = (title: string): Response => json({ type: 'about:blank', title, status: 404 }, 404);

beforeEach(() => {
  api = { library: LIBRARY, pages: new Map([['bfs', CURRENT]]), requested: [] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
    const { pathname } = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    api.requested.push(pathname);
    if (pathname === '/api/v1/health') {
      return json({ status: 'ok', version: 'test', database: 'up', modules: ['content', 'reader'] });
    }
    if (pathname === '/api/v1/content/subjects/energi') {
      return json(OUTLINE);
    }
    if (pathname === '/api/v1/reader/subjects/energi/sources') {
      return api.library === 'failing' ? json({ type: 'about:blank', title: 'Internal error', status: 500 }, 500) : json(api.library);
    }
    const page = /^\/api\/v1\/reader\/subjects\/energi\/sources\/([^/]+)$/.exec(pathname);
    if (page?.[1] !== undefined) {
      const found = api.pages.get(decodeURIComponent(page[1]));
      return found === undefined ? notFound('No such source') : json(found);
    }
    return notFound('Not found');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function open(path: string, modules = [readerModule]): void {
  window.history.replaceState(null, '', path);
  render(<App modules={modules} />);
}

const rows = (): string[][] =>
  [...document.querySelectorAll<HTMLElement>('.src-row')].map((row) => [within(row).getByRole('heading').textContent ?? '', row.querySelector('.uses')?.textContent ?? '']);

/** The line saying how many sources are shown; the footer's server status is a status too. */
const resultCount = (): string | null | undefined => document.querySelector('.result-count')?.textContent;

const titles = (): string[] => rows().map(([title]) => title ?? '');

describe('the reader’s catalogues', () => {
  it('have every message in every language, with the Swedish placeholders', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
  });
});

describe('the source library', () => {
  it('lists every source, the most used first, with publisher, date read, form and how much rests on it', async () => {
    open('/subjects/energi/reader');

    expect(await screen.findByText('5 källor')).toBeTruthy();
    expect(rows()).toEqual([
      ['BFS 2026:9', '6 lektioner22 frågor'],
      ['Beräkning av Etal', '4 lektioner13 frågor'],
      ['Graddagar', '2 lektioner9 frågor'],
      ['Livscykelkostnad', '1 lektion7 frågor'],
      ['Teoridel', 'Inte citerad'],
    ]);
    const first = screen.getAllByRole('listitem')[0];
    expect(first?.querySelector('.origin-line')?.textContent).toBe('Boverketboverket.exampleLäst 20 november 2026Sammanfattning');
    expect(within(screen.getByRole('navigation', { name: 'Ämnet' })).getByRole('link', { name: 'Material' }).getAttribute('aria-current')).toBe('page');
  });

  it('orders by title, or by the date read with the newest first', async () => {
    open('/subjects/energi/reader');
    const order = await screen.findByRole('combobox', { name: 'Ordning' });

    await userEvent.selectOptions(order, 'title');
    // Swedish collation reads "Be" before "BF": case does not decide.
    expect(titles()).toEqual(['Beräkning av Etal', 'BFS 2026:9', 'Graddagar', 'Livscykelkostnad', 'Teoridel']);

    await userEvent.selectOptions(order, 'read');
    expect(titles()).toEqual(['Graddagar', 'BFS 2026:9', 'Livscykelkostnad', 'Beräkning av Etal', 'Teoridel']);
  });

  it('finds a word at its start in titles, publishers and text, never inside a word, and marks it', async () => {
    open('/subjects/energi/reader');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Sök i källorna' }), 'etal');

    // "återbetalningstid" in Livscykelkostnad holds "etal" only inside the word.
    expect(titles()).toEqual(['BFS 2026:9', 'Beräkning av Etal']);
    expect(resultCount()).toBe('2 av 5 källor innehåller ”etal”');
    expect([...document.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Etal', 'Etal']);
    expect(screen.getAllByRole('listitem')[0]?.querySelector('.snippet')?.textContent).toBe('Etal Energiprestandatal (Etal) per m² Atemp.');
  });

  it('says when nothing matches, and shows every source again on request', async () => {
    open('/subjects/energi/reader');
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Sök i källorna' }), 'radon');

    expect(resultCount()).toBe('Inga källor innehåller ”radon”.');
    expect(screen.queryByRole('list')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Visa alla källor' }));

    expect(titles()).toHaveLength(5);
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: 'Sök i källorna' }).value).toBe('');
  });

  it('narrows to one publisher, and back', async () => {
    open('/subjects/energi/reader');
    const publishers = await screen.findByRole('group', { name: 'Utgivare' });
    expect(within(publishers).getAllByRole('button').map((button) => button.textContent)).toEqual(['Alla5', 'Boverket2', 'Energimyndigheten1', 'LTH1', 'SMHI1']);

    await userEvent.click(within(publishers).getByRole('button', { name: 'Boverket2' }));

    expect(titles()).toEqual(['BFS 2026:9', 'Beräkning av Etal']);
    expect(resultCount()).toBe('2 källor från Boverket');

    await userEvent.click(within(publishers).getByRole('button', { name: 'Alla5' }));

    expect(titles()).toHaveLength(5);
  });

  it('goes to the search box on “/”', async () => {
    open('/subjects/energi/reader');
    const search = await screen.findByRole('searchbox', { name: 'Sök i källorna' });

    await userEvent.keyboard('/');

    expect(document.activeElement).toBe(search);
    expect((search as HTMLInputElement).value).toBe('');
  });

  it('says so when the subject has no sources', async () => {
    api.library = { subjectId: 'energi', sources: [] };
    open('/subjects/energi/reader');

    expect((await screen.findByRole('heading', { name: 'Inga källor i det här ämnet' })).closest('.state')?.textContent).toContain('sources/');
  });

  it('says so when the sources cannot be read, and shows them once a retry gets through', async () => {
    api.library = 'failing';
    open('/subjects/energi/reader');

    expect((await screen.findByRole('alert')).textContent).toContain('Källorna går inte att läsa just nu');
    api.library = LIBRARY;
    await userEvent.click(screen.getByRole('button', { name: 'Försök igen' }));

    expect(await screen.findByText('5 källor')).toBeTruthy();
  });

  it('speaks English when the interface does', async () => {
    window.localStorage.setItem('skill-issue.language', 'en');
    open('/subjects/energi/reader');

    expect(await screen.findByText('5 sources')).toBeTruthy();
    expect(rows()[0]).toEqual(['BFS 2026:9', '6 lessons22 questions']);
  });
});

describe('one source', () => {
  it('opens from the library at its own address, with its origin, its material and what rests on it', async () => {
    open('/subjects/energi/reader');
    await userEvent.click(await screen.findByRole('link', { name: 'BFS 2026:9' }));

    expect(window.location.pathname).toBe('/subjects/energi/reader/bfs');
    const origin = await screen.findByRole('region', { name: 'Ursprung' });
    expect([...origin.querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling?.textContent])).toEqual([
      ['Utgivare', 'Boverket'],
      ['Källa', 'rinfo.boverket.seöppnas i ny flik ↗'],
      ['Läst', `20 november 2026${origin.querySelector('dd:nth-of-type(3) .hint')?.textContent ?? ''}`],
      ['Form', 'Sammanfattning'],
      ['Licens', 'Okänd'],
    ]);
    const link = within(origin).getByRole('link', { name: 'rinfo.boverket.se' });
    expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual(['https://rinfo.boverket.se/BFS2026-9.pdf', '_blank', 'noopener noreferrer']);
    expect(screen.getByRole('table').textContent?.replace(/\s+/g, '')).toBe('BärareFaktorEl1,8');
    expect(screen.getByText(/Sammanfattning med egna ord/)).toBeTruthy();

    const rests = screen.getByRole('complementary', { name: 'Det här vilar på källan' });
    expect(rests.querySelector('p')?.textContent).toBe('2 lektioner, 7 frågor och 1 begrepp.');
    expect(within(rests).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Grunder', 'Energiberäkning', 'Begrepp']);
    expect(within(rests).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Energiprestandatal6 frågor', 'Säkerhetsmarginaler1 fråga']);
    expect(rests.querySelector('dl')?.textContent).toBe('FgeoGeografisk justeringsfaktor.');
  });

  it('links each citing lesson and shows its state, when modules give lessons an address and marks', async () => {
    const lessons: WebModule = {
      id: 'lessons',
      lessonLink: (subjectId, lessonId) => `/subjects/${subjectId}/lessons/${lessonId}`,
      lessonMarks: async () => new Map([['etal', { state: 'in-progress' as const, detail: 'steg 4 av 7' }]]),
    };
    open('/subjects/energi/reader/bfs', [readerModule, lessons]);

    const rests = await screen.findByRole('complementary', { name: 'Det här vilar på källan' });
    await vi.waitFor(() =>
      expect(within(rests).getAllByRole('listitem').map((item) => [within(item).getByRole('link').getAttribute('href'), item.querySelector('.sub')?.textContent, item.getAttribute('data-state')])).toEqual([
        ['/subjects/energi/lessons/etal', 'Pågår, steg 4 av 7 · 6 frågor', 'in-progress'],
        ['/subjects/energi/lessons/marginaler', 'Inte påbörjad · 1 fråga', 'not-started'],
      ]),
    );
  });

  it('gives other modules the address of a source', () => {
    expect(readerModule.sourceLink?.('energi', 'bfs')).toBe('/subjects/energi/reader/bfs');
  });

  it('leads back to the library', async () => {
    open('/subjects/energi/reader/bfs');
    await userEvent.click(await screen.findByRole('link', { name: '← Alla källor' }));

    expect(window.location.pathname).toBe('/subjects/energi/reader');
    expect(await screen.findByText('5 källor')).toBeTruthy();
  });

  it('says plainly when nothing rests on the source, and when it has no link', async () => {
    const { url: _none, ...withoutLink } = CURRENT.source;
    api.pages.set('lth', { status: 'current', source: { ...withoutLink, id: 'lth', title: 'Teoridel' }, areas: [], terms: [] });
    open('/subjects/energi/reader/lth');

    expect((await screen.findByRole('complementary')).textContent).toBe('Det här vilar på källanIngenting än. Ingen lektion, fråga eller begrepp i ämnet citerar den.');
    expect(screen.getByRole('region', { name: 'Ursprung' }).textContent).toContain('Ingen länkMaterialet finns inte på webben.');
  });

  it('shows a source the subject no longer holds as it last stood, saying when it was taken out', async () => {
    api.pages.set('bbr', { status: 'retired', retiredAt: '2026-11-21T09:30:00.000Z', source: { ...CURRENT.source, id: 'bbr', title: 'BBR 29' }, history: { questions: 0, answers: 0 } });
    open('/subjects/energi/reader/bbr');

    expect((await screen.findByRole('note')).textContent).toBe(
      'Finns inte längre i ämnet. Källan togs bort när ämnet laddades in igen 21 november 2026. Här visas den som den såg ut sist, så att svar som vilade på den fortfarande har sitt ursprung.',
    );
    expect(screen.getByRole('complementary').textContent).toBe('Det här vilade på källanIngen lektion eller fråga i ämnet som det ser ut nu citerar den.');
    expect(screen.getByRole('heading', { name: 'BBR 29' })).toBeTruthy();
  });

  it('names, on a retired source, the questions the learner answered on its strength', async () => {
    api.pages.set('bbr', { status: 'retired', retiredAt: '2026-11-21T09:30:00.000Z', source: { ...CURRENT.source, id: 'bbr', title: 'BBR 29' }, history: { questions: 2, answers: 5 } });
    open('/subjects/energi/reader/bbr');

    expect((await screen.findByRole('complementary')).textContent).toBe(
      'Det här vilade på källanIngen lektion eller fråga i ämnet som det ser ut nu citerar den.I din historik2 frågor du har svarat påSvaren finns kvar; de gällde frågorna som de såg ut då.',
    );
  });

  it('of an unknown id says there is none, naming it, and leads back', async () => {
    open('/subjects/energi/reader/no-such-source');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Ämnet har ingen källa med id:t no-such-source.');
    await userEvent.click(within(alert).getByRole('link', { name: 'Till alla källor' }));

    expect(window.location.pathname).toBe('/subjects/energi/reader');
  });

  it('answers an address deeper than a source as no such source, without asking the server', async () => {
    open('/subjects/energi/reader/bfs/extra');

    expect((await screen.findByRole('alert')).textContent).toContain('bfs/extra');
    expect(api.requested.filter((path) => path.startsWith('/api/v1/reader/'))).toEqual([]);
  });
});

describe('the reader on the subject home', () => {
  it('puts a side block naming how many sources there are and from whom, leading to the library', async () => {
    open('/subjects/energi');

    const block = await screen.findByText(/5 källor, från/);
    expect(block.textContent).toBe('5 källor, från Boverket, Energimyndigheten och 2 andra.');
    expect(block.closest('aside')).not.toBeNull();
    expect(within(block.closest('.sheet') as HTMLElement).getByRole('link', { name: 'Öppna källorna' }).getAttribute('href')).toBe('/subjects/energi/reader');
  });

  it('is gone with the module: no tab, no block, no page', async () => {
    open('/subjects/energi', []);

    const tabs = await screen.findByRole('navigation', { name: 'Ämnet' });
    expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Översikt']);
    expect(screen.queryByText(/källor/)).toBeNull();
    expect(api.requested.filter((path) => path.startsWith('/api/v1/reader/'))).toEqual([]);
  });
});
