import type { SubjectOutline, SubjectSummary } from '@skill-issue/contract';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { checkModules, mergeLessonMarks, type LessonMark, type WebModule } from './shell/contract.js';

const EXAMPLE: SubjectSummary = {
  id: 'example-subject',
  defaultLanguage: 'sv',
  languages: ['en', 'sv'],
  title: 'Exempelämne',
  summary: 'Energi och effekt, enhetsprefix och energibalans.',
};

const ENGLISH_ONLY: SubjectSummary = { id: 'cra', defaultLanguage: 'en', languages: ['en'], title: 'CRA and NIS2', summary: 'EU cyber rules.' };
const SWEDISH_ONLY: SubjectSummary = { id: 'statistik', defaultLanguage: 'sv', languages: ['sv'], title: 'Statistik för mätdata', summary: 'Medelvärden och spridning.' };

const OUTLINE: SubjectOutline = {
  ...EXAMPLE,
  language: 'sv',
  areas: [
    {
      id: 'grunder',
      language: 'sv',
      title: 'Grunder',
      summary: 'Storheterna och enheterna.',
      requires: [],
      lessons: [
        { id: 'energi-och-effekt', language: 'sv', title: 'Energi och effekt', summary: 'kWh och kW.' },
        { id: 'enhetsprefix', language: 'sv', title: 'Enhetsprefix', summary: 'Kilo, mega, giga.' },
      ],
    },
    {
      id: 'fordjupning',
      language: 'sv',
      title: 'Fördjupning',
      summary: 'Vart energin tar vägen.',
      requires: ['grunder'],
      lessons: [{ id: 'energibalans', language: 'sv', title: 'Energibalans', summary: 'In och ut.' }],
    },
  ],
};

/** The API as the browser sees it, with what each test needs it to hold. */
interface FakeApi {
  health: 'ok' | 'database-down' | 'unreachable';
  subjects: SubjectSummary[];
  outlines: Map<string, SubjectOutline>;
  readonly requested: string[];
}

let api: FakeApi;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  api = { health: 'ok', subjects: [], outlines: new Map(), requested: [] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    api.requested.push(url.pathname);
    if (api.health === 'unreachable') {
      throw new TypeError('fetch failed');
    }
    if (url.pathname === '/api/v1/health') {
      return api.health === 'ok'
        ? json({ status: 'ok', version: 'test', database: 'up', modules: ['content'] })
        : json({ status: 'unavailable', version: 'test', database: 'down' }, 503);
    }
    if (api.health === 'database-down') {
      return json({ type: 'about:blank', title: 'Internal error', status: 500 }, 500);
    }
    if (url.pathname === '/api/v1/content/subjects') {
      return json(api.subjects);
    }
    const outline = api.outlines.get(decodeURIComponent(url.pathname.replace('/api/v1/content/subjects/', '')));
    return outline === undefined ? json({ type: 'about:blank', title: 'No such subject', status: 404 }, 404) : json(outline);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string, modules: readonly WebModule[] = []): void {
  window.history.replaceState(null, '', path);
  render(<App modules={modules} />);
}

/** A module that contributes one of everything the shell can show, each naming itself. */
const everything: WebModule = {
  id: 'fixture',
  page: { label: { sv: 'Fixtursida', en: 'Fixture page' }, Page: ({ subject }) => <p>Fixtursidan för {subject.title}</p> },
  homeBlocks: [
    { placement: 'lead', Block: ({ subject }) => <p>Fixturblock överst i {subject.id}</p> },
    { placement: 'side', Block: () => <p>Fixturblock i sidan</p> },
  ],
  StartFigures: ({ subject }) => <span>Fixturfigur för {subject.id}</span>,
  ResumePanel: ({ subjects }) => <section aria-label="Fixturpanel">Fortsätt i {subjects[0]?.title}</section>,
};

describe('the module contract on the subject home', () => {
  beforeEach(() => {
    api.subjects = [EXAMPLE];
    api.outlines.set(EXAMPLE.id, OUTLINE);
  });

  it('shows a module’s tab and blocks, and its page behind the tab', async () => {
    open('/subjects/example-subject', [everything]);

    const tabs = await screen.findByRole('navigation', { name: 'Ämnet' });
    expect(within(tabs).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
      ['Översikt', '/subjects/example-subject', 'page'],
      ['Fixtursida', '/subjects/example-subject/fixture', null],
    ]);
    expect(screen.getByText('Fixturblock överst i example-subject')).toBeTruthy();
    expect(screen.getByText('Fixturblock i sidan').closest('aside')).not.toBeNull();

    await userEvent.click(within(tabs).getByRole('link', { name: 'Fixtursida' }));

    expect(window.location.pathname).toBe('/subjects/example-subject/fixture');
    expect(await screen.findByText('Fixtursidan för Exempelämne')).toBeTruthy();
    expect(within(tabs).getByRole('link', { name: 'Fixtursida' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('heading', { name: 'Vägen genom ämnet' })).toBeNull();
  });

  it('without the module has no tab, no block and no page, and still draws the path', async () => {
    open('/subjects/example-subject');

    const tabs = await screen.findByRole('navigation', { name: 'Ämnet' });
    expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Översikt']);
    expect(screen.queryByText(/Fixtur/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Vägen genom ämnet' })).toBeTruthy();
    expect(document.querySelector('aside')).toBeNull();
  });

  it('answers a page no module contributes with “no such page”, naming it', async () => {
    open('/subjects/example-subject/fixture');

    expect((await screen.findByRole('alert')).textContent).toContain('Ämnet har ingen sida som heter fixture.');
  });
});

describe('the module contract on the start screen', () => {
  beforeEach(() => {
    api.subjects = [EXAMPLE];
  });

  it('shows each module’s figures on every row and its resume panel above them', async () => {
    open('/', [everything]);

    expect(await screen.findByText('Fixturfigur för example-subject')).toBeTruthy();
    const panel = screen.getByRole('region', { name: 'Fixturpanel' });
    expect(panel.textContent).toBe('Fortsätt i Exempelämne');
    expect(panel.compareDocumentPosition(screen.getByText('Fixturfigur för example-subject')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('without the module shows the rows alone', async () => {
    open('/');

    expect(await screen.findByRole('link', { name: 'Exempelämne' })).toBeTruthy();
    expect(screen.queryByText(/Fixtur/)).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });
});

const marking = (id: string, marks: Record<string, LessonMark>): WebModule => ({ id, lessonMarks: async () => new Map(Object.entries(marks)) });

const statesOnPath = (): (string | null)[][] =>
  [...document.querySelectorAll('li[data-lesson]')].map((item) => [
    item.getAttribute('data-lesson'),
    item.getAttribute('data-state'),
    item.querySelector('.state-word')?.textContent ?? null,
  ]);

describe('lesson marks on the path', () => {
  beforeEach(() => {
    api.subjects = [EXAMPLE];
    api.outlines.set(EXAMPLE.id, OUTLINE);
  });

  it('shows the furthest state any module gives, and “not started” where none names the lesson', async () => {
    open('/subjects/example-subject', [
      marking('lessons', { 'energi-och-effekt': { state: 'in-progress', detail: 'steg 2 av 7', here: true } }),
      marking('assessment', { 'energi-och-effekt': { state: 'passed' }, enhetsprefix: { state: 'passed' } }),
      marking('progress', { enhetsprefix: { state: 'mastered' } }),
    ]);

    await screen.findByText('Behärskad');
    expect(statesOnPath()).toEqual([
      ['energi-och-effekt', 'passed', 'Godkänd'],
      ['enhetsprefix', 'mastered', 'Behärskad'],
      ['energibalans', 'not-started', 'Inte påbörjad'],
    ]);
    expect(within(document.querySelector('li[data-lesson="energi-och-effekt"]')!).getByText('Här slutade du')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Så läser du vägen' })).toBeTruthy();
  });

  it('leaves out a module whose marks cannot be read, and keeps the others', async () => {
    open('/subjects/example-subject', [
      { id: 'broken', lessonMarks: async () => Promise.reject(new Error('down')) },
      marking('progress', { enhetsprefix: { state: 'mastered' } }),
    ]);

    await screen.findByText('Behärskad');
    expect(statesOnPath()).toEqual([
      ['energi-och-effekt', 'not-started', 'Inte påbörjad'],
      ['enhetsprefix', 'mastered', 'Behärskad'],
      ['energibalans', 'not-started', 'Inte påbörjad'],
    ]);
  });

  it('without a marking module draws the lessons without any state, and no legend', async () => {
    open('/subjects/example-subject');

    await screen.findByText('Energibalans');
    expect(statesOnPath()).toEqual([
      ['energi-och-effekt', null, null],
      ['enhetsprefix', null, null],
      ['energibalans', null, null],
    ]);
    expect(screen.queryByRole('heading', { name: 'Så läser du vägen' })).toBeNull();
  });
});

describe('mergeLessonMarks', () => {
  it('keeps the furthest state with its own detail, and “you stopped here” from any module', () => {
    const merged = mergeLessonMarks([
      new Map([['a', { state: 'in-progress', detail: 'steg 4 av 9', here: true }]]),
      new Map([['a', { state: 'passed', detail: 'provet klarat' }], ['b', { state: 'not-started' }]]),
      new Map([['a', { state: 'not-started' }]]),
    ]);

    expect(Object.fromEntries(merged)).toEqual({ a: { state: 'passed', detail: 'provet klarat', here: true }, b: { state: 'not-started' } });
  });
});

describe('checkModules', () => {
  it('refuses a module id used twice, and one that is not a module id, naming it', () => {
    expect(checkModules([{ id: 'notes' }, { id: 'review' }, { id: 'notes' }])).toEqual({ kind: 'duplicate-id', id: 'notes' });
    expect(checkModules([{ id: 'Notes' }])).toEqual({ kind: 'invalid-id', id: 'Notes' });
    expect(checkModules([{ id: 'notes' }, { id: 'review' }])).toBeUndefined();
  });
});

describe('the start screen', () => {
  it('on an empty installation welcomes and says how to load a first subject', async () => {
    open('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'Välkommen' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Inga ämnen än' })).toBeTruthy();
    expect(screen.getByText('node apps/cli/dist/main.js load examples/example-subject')).toBeTruthy();
  });

  it('lists each subject with one way in, and names its languages unless it is in the interface’s language alone', async () => {
    api.subjects = [ENGLISH_ONLY, EXAMPLE, SWEDISH_ONLY];
    open('/');

    await screen.findByRole('heading', { level: 1, name: 'Dina ämnen' });
    const rows = [...document.querySelectorAll('.ledger-row')].map((row) => ({
      title: within(row as HTMLElement).getByRole('heading').textContent,
      open: within(row as HTMLElement).getByRole('link', { name: /^Öppna: / }).getAttribute('href'),
      languages: [...row.querySelectorAll('.chip')].map((chip) => chip.textContent),
    }));
    expect(rows).toEqual([
      { title: 'CRA and NIS2', open: '/subjects/cra', languages: ['endast English'] },
      { title: 'Exempelämne', open: '/subjects/example-subject', languages: ['English', 'svenska'] },
      { title: 'Statistik för mätdata', open: '/subjects/statistik', languages: [] },
    ]);
  });

  it('shows a subject loaded while it is open when the tab is next focused, marked as new', async () => {
    api.subjects = [EXAMPLE];
    open('/');
    await screen.findByRole('link', { name: 'Exempelämne' });

    api.subjects = [ENGLISH_ONLY, EXAMPLE];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    const arrived = (await screen.findByRole('link', { name: 'CRA and NIS2' })).closest('.ledger-row')!;
    expect(arrived.classList.contains('arrived')).toBe(true);
    expect(within(arrived as HTMLElement).getByText('Nytt')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Exempelämne' }).closest('.ledger-row')!.textContent).not.toContain('Nytt');
  });

  it('when the server cannot be reached says so, and shows the subjects once a retry gets through', async () => {
    api.health = 'unreachable';
    api.subjects = [EXAMPLE];
    open('/');

    expect((await screen.findByRole('alert')).textContent).toContain('Servern går inte att nå');
    expect(screen.getByText('docker-compose up -d').tagName).toBe('CODE');

    api.health = 'ok';
    await userEvent.click(screen.getByRole('button', { name: 'Försök igen nu' }));

    expect(await screen.findByRole('link', { name: 'Exempelämne' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('when the database is down says that, not that the server is', async () => {
    api.health = 'database-down';
    open('/');

    expect((await screen.findByRole('alert')).textContent).toContain('Databasen går inte att nå');
    expect(screen.getByRole('status').textContent).toBe('Servern svarar, men databasen går inte att nå.');
  });

  it('switches the interface to English and keeps the choice', async () => {
    api.subjects = [EXAMPLE];
    open('/');
    await screen.findByRole('heading', { level: 1, name: 'Dina ämnen' });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Språk' }), 'en');

    expect(screen.getByRole('heading', { level: 1, name: 'Your subjects' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem('skill-issue.language')).toBe('en');
    window.localStorage.clear();
  });
});

describe('the subject home', () => {
  beforeEach(() => {
    api.subjects = [EXAMPLE];
    api.outlines.set(EXAMPLE.id, OUTLINE);
  });

  it('draws the path: areas in order with what each builds on, and each area’s lessons in order', async () => {
    open('/subjects/example-subject');

    expect(await screen.findByRole('heading', { level: 1, name: 'Exempelämne' })).toBeTruthy();
    expect(screen.getByText('2 områden')).toBeTruthy();
    const areas = [...document.querySelectorAll('section[data-area]')].map((area) => ({
      title: area.querySelector('h3')?.textContent,
      requires: area.querySelector('.requires')?.textContent ?? null,
      lessons: [...area.querySelectorAll('li')].map((lesson) => lesson.textContent),
    }));
    expect(areas).toEqual([
      { title: 'Grunder', requires: null, lessons: ['Energi och effekt', 'Enhetsprefix'] },
      { title: 'Fördjupning', requires: 'Bygger på Grunder.', lessons: ['Energibalans'] },
    ]);
    expect(document.title).toBe('Exempelämne · Skill Issue');
  });

  it('marks an item shown in the default language for want of a translation', async () => {
    const [grunder, fordjupning] = OUTLINE.areas;
    api.outlines.set(EXAMPLE.id, {
      ...OUTLINE,
      language: 'en',
      title: 'Example subject',
      areas: [{ ...grunder!, lessons: [{ ...grunder!.lessons[0]!, language: 'en', title: 'Energy and power' }, grunder!.lessons[1]!] }, fordjupning!],
    });
    open('/subjects/example-subject');

    await screen.findByText('Energy and power');
    expect(screen.getByText('Energy and power').closest('li')!.querySelector('.chip')).toBeNull();
    const fallback = screen.getByText('Enhetsprefix');
    expect(fallback.getAttribute('lang')).toBe('sv');
    expect(fallback.closest('li')!.querySelector('.chip')!.textContent).toBe('på svenska');
  });

  it('of an unknown subject says there is none with that id, and leads back', async () => {
    open('/subjects/no-such-subject');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Ämnet finns inte');
    expect(within(alert).getByText('no-such-subject').tagName).toBe('CODE');
    expect(within(alert).getByRole('link', { name: 'Till alla ämnen' }).getAttribute('href')).toBe('/');
  });

  it('is reached from the start screen and leads back to it, without reloading the page', async () => {
    open('/');
    await userEvent.click(await screen.findByRole('link', { name: 'Öppna: Exempelämne' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Exempelämne' })).toBeTruthy();
    expect(window.location.pathname).toBe('/subjects/example-subject');

    await userEvent.click(screen.getByRole('link', { name: 'Alla ämnen' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Dina ämnen' })).toBeTruthy();
  });
});
