import type { LessonView, NotebookSection, SubjectOutline, SubjectSummary } from '@skill-issue/contract';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import type { WebModule } from '../../shell/contract.js';
import { catalogueFaults } from '../../shell/messages.js';
import { lessonsModule } from '../lessons/index.js';
import { notesModule } from './index.js';
import { catalogues } from './messages.js';

const SUBJECT: SubjectSummary = { id: 'example-subject', defaultLanguage: 'sv', languages: ['sv'], title: 'Exempelämne', summary: 'Energi och effekt.' };

const OUTLINE: SubjectOutline = {
  ...SUBJECT,
  language: 'sv',
  areas: [
    {
      id: 'grunder',
      language: 'sv',
      title: 'Grunder',
      summary: 'Storheterna.',
      requires: [],
      lessons: [
        { id: 'energi-och-effekt', language: 'sv', title: 'Energi och effekt', summary: 'kWh och kW.' },
        { id: 'enhetsprefix', language: 'sv', title: 'Enhetsprefix', summary: 'Kilo och mega.' },
      ],
    },
    {
      id: 'fordjupning',
      language: 'sv',
      title: 'Fördjupning',
      summary: 'Balansen.',
      requires: [],
      lessons: [{ id: 'energibalans', language: 'sv', title: 'Energibalans', summary: 'In och ut.' }],
    },
  ],
};

const VIEW: LessonView = {
  lesson: {
    subjectId: 'example-subject',
    id: 'energi-och-effekt',
    language: 'sv',
    revision: 1,
    title: 'Energi och effekt',
    summary: 'Skillnaden mellan kWh och kW.',
    area: { id: 'grunder', language: 'sv', title: 'Grunder' },
    steps: [
      { type: 'text', body: '**Effekt** är hur fort energi används.' },
      { type: 'example', body: 'En värmefläkt på 2 kW i 3 timmar.' },
      { type: 'text', body: 'Energi är effekt gånger tid.' },
    ],
    sources: [],
  },
  position: null,
  resumeAt: 0,
  changedSince: false,
  checks: { answeredAfter: 0, again: [] },
};

const section = (kind: 'area' | 'lesson', itemId: string, body: string, updatedAt = '2026-11-21T10:00:00Z'): NotebookSection => ({
  subjectId: 'example-subject',
  kind,
  itemId,
  body,
  createdAt: '2026-11-20T09:00:00Z',
  updatedAt,
});

interface FakeApi {
  /** What the server holds, the most recently written first. */
  sections: NotebookSection[];
  /** Status of each coming section write, in order; 200 once they run out. */
  writeAnswers: number[];
  listFails: boolean;
  /** Held until released: the next write waits on it before the server answers. */
  hold: Promise<void> | undefined;
  readonly writes: { readonly path: string; readonly body: unknown }[];
  readonly images: unknown[];
  readonly lists: string[];
}

let api: FakeApi;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const BASE = '/api/v1/notes/subjects/example-subject';

beforeEach(() => {
  api = { sections: [], writeAnswers: [], listFails: false, hold: undefined, writes: [], images: [], lists: [] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    const path = url.pathname;
    if (init?.method === 'PUT' && path.startsWith(`${BASE}/notebook/`)) {
      const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : '');
      api.writes.push({ path, body });
      const held = api.hold;
      api.hold = undefined;
      await held;
      const status = api.writeAnswers.shift() ?? 200;
      const [, plural, itemId] = /\/notebook\/(areas|lessons)\/([^/]+)$/.exec(path) ?? [];
      const text = typeof body === 'object' && body !== null && 'body' in body && typeof body.body === 'string' ? body.body : '';
      if (status !== 200) {
        return json({ type: 'about:blank', title: 'Down', status }, status);
      }
      return text.trim() === '' ? new Response(null, { status: 204 }) : json(section(plural === 'areas' ? 'area' : 'lesson', itemId ?? '', text));
    }
    if (init?.method === 'POST' && path === `${BASE}/notebook/images`) {
      api.images.push(JSON.parse(typeof init.body === 'string' ? init.body : ''));
      return json({ name: `bild-${api.images.length}.png`, mediaType: 'image/png' }, 201);
    }
    if (init?.method === 'PUT') {
      return json({ step: 0, steps: 3, revision: 1, startedAt: '2026-11-21T10:00:00Z', updatedAt: '2026-11-21T10:00:00Z', finishedAt: null });
    }
    if (path === `${BASE}/notebook`) {
      api.lists.push(url.search);
      if (api.listFails) {
        return json({ type: 'about:blank', title: 'Down', status: 503 }, 503);
      }
      const q = url.searchParams.get('q')?.toLowerCase();
      return json({ subjectId: 'example-subject', sections: api.sections.filter((each) => q === undefined || each.body.toLowerCase().includes(q)) });
    }
    if (path === '/api/v1/notes/notebooks') {
      const last = api.sections[0];
      return json({
        notebooks: [{ subjectId: 'example-subject', written: api.sections.length, areasWritten: [], ...(last === undefined ? {} : { last: { kind: last.kind, itemId: last.itemId, updatedAt: last.updatedAt } }) }],
      });
    }
    if (path === '/api/v1/health') {
      return json({ status: 'ok', version: 'test', database: 'up', modules: ['content', 'lessons', 'notes'] });
    }
    if (path === '/api/v1/content/subjects') {
      return json([SUBJECT]);
    }
    if (path === '/api/v1/content/subjects/example-subject') {
      return json(OUTLINE);
    }
    if (path === '/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt') {
      return json(VIEW);
    }
    if (path === '/api/v1/lessons/subjects/example-subject/positions') {
      return json({ subjectId: 'example-subject', lessons: {} });
    }
    if (path === '/api/v1/lessons/resume') {
      return json({ offer: null, started: [], finished: [] });
    }
    return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function open(path: string, modules: readonly WebModule[] = [lessonsModule, notesModule]): void {
  window.history.replaceState(null, '', path);
  render(<App modules={modules} />);
}

const LESSON_PAGE = '/subjects/example-subject/lessons/energi-och-effekt';
const LESSON_SECTION = `${BASE}/notebook/lessons/energi-och-effekt`;
const spread = (): HTMLElement => screen.getByRole('region', { name: 'Anteckningsboken' });
const field = (): HTMLTextAreaElement => {
  const found = within(spread()).getByRole('textbox');
  if (!(found instanceof HTMLTextAreaElement)) {
    throw new Error('the note field is not a text area');
  }
  return found;
};
const statusLine = (): string | null => spread().querySelector('output')?.textContent ?? null;

async function openSpread(): Promise<void> {
  open(LESSON_PAGE);
  await screen.findByText('Steg 1 av 3');
  await userEvent.keyboard('n');
  await within(spread()).findByRole('textbox');
}

describe('the notebook in a lesson', () => {
  it('opens with its key at the lesson’s own section, with what is written there and the caret at its end', async () => {
    api.sections = [section('lesson', 'energi-och-effekt', 'Effekt är takt.'), section('lesson', 'enhetsprefix', 'Annan lektion.')];
    await openSpread();

    expect(within(spread()).getByRole('heading', { name: 'Energi och effekt' })).toBeTruthy();
    expect(within(spread()).getByText('Grunder › Energi och effekt')).toBeTruthy();
    expect(field().value).toBe('Effekt är takt.');
    expect(field().getAttribute('aria-label')).toBe('Anteckning under Energi och effekt');
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([15, 15]);
  });

  it('starts what is typed at the end on a new line, and saves nothing merely by opening', async () => {
    api.sections = [section('lesson', 'energi-och-effekt', 'Effekt är takt.')];
    await openSpread();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(api.writes).toEqual([]);

    await userEvent.type(field(), 'Ny rad');

    expect(field().value).toBe('Effekt är takt.\nNy rad');
    await vi.waitFor(() => expect(api.writes).toEqual([{ path: LESSON_SECTION, body: { body: 'Effekt är takt.\nNy rad' } }]), { timeout: 2000 });
  });

  it('saves what is typed once typing pauses, under the lesson, and says so', async () => {
    await openSpread();

    await userEvent.type(field(), 'kW är takt');

    expect(statusLine()).toBe('Sparar …');
    await vi.waitFor(() => expect(api.writes).toEqual([{ path: LESSON_SECTION, body: { body: 'kW är takt' } }]), { timeout: 2000 });
    await vi.waitFor(() => expect(statusLine()).toBe('Sparat'));
  });

  it('writes under a lesson in another area from here, and comes back to this lesson’s section', async () => {
    api.sections = [section('lesson', 'energi-och-effekt', 'Här.')];
    await openSpread();
    const contents = within(spread()).getByRole('navigation', { name: 'Innehåll' });
    await userEvent.click(within(contents).getByText('Fördjupning'));

    await userEvent.click(within(contents).getByRole('link', { name: 'Energibalans' }));
    await userEvent.type(field(), 'Om balansen.');

    expect(within(spread()).getByText('Du skriver under en annan lektion.')).toBeTruthy();
    await vi.waitFor(() => expect(api.writes).toEqual([{ path: `${BASE}/notebook/lessons/energibalans`, body: { body: 'Om balansen.' } }]), { timeout: 2000 });
    await userEvent.click(within(spread()).getByRole('button', { name: 'Till denna lektion' }));
    expect(field().value).toBe('Här.');
  });

  it('writes in an area’s own section, filed under the area', async () => {
    await openSpread();
    const contents = within(spread()).getByRole('navigation', { name: 'Innehåll' });

    await userEvent.click(within(contents).getByRole('link', { name: 'Grunder' }));
    await userEvent.type(field(), 'Området.');

    expect(within(spread()).getByRole('heading', { name: 'Om området' })).toBeTruthy();
    await vi.waitFor(() => expect(api.writes).toEqual([{ path: `${BASE}/notebook/areas/grunder`, body: { body: 'Området.' } }]), { timeout: 2000 });
  });

  it('folds the contents by area, the lesson’s own area open', async () => {
    await openSpread();
    const contents = within(spread()).getByRole('navigation', { name: 'Innehåll' });
    const folds = (): boolean[] => [...contents.querySelectorAll('details')].map((fold) => fold.open);

    expect(folds()).toEqual([true, false]);
    await userEvent.click(within(contents).getByRole('button', { name: 'Fäll ut alla' }));
    expect(folds()).toEqual([true, true]);
    await userEvent.click(within(contents).getByRole('button', { name: 'Fäll ihop alla' }));
    expect(folds()).toEqual([false, false]);
  });

  it('reads with Escape, the learner’s own headings drawn below the section’s, and keeps the notebook open', async () => {
    api.sections = [section('lesson', 'energi-och-effekt', '# Min rubrik\n\n**Fet** text.')];
    await openSpread();

    fireEvent.keyDown(field(), { key: 'Escape' });

    expect(screen.getByRole('region', { name: 'Anteckningsboken' })).toBeTruthy();
    expect(within(spread()).queryByRole('textbox')).toBeNull();
    const heading = within(spread()).getByRole('heading', { name: 'Min rubrik' });
    expect(heading.tagName).toBe('H4');
    expect(within(spread()).getByText('Fet').tagName).toBe('STRONG');
  });

  it('writes again with Enter on the note as read, without the lesson taking Enter as “continue”', async () => {
    api.sections = [section('lesson', 'energi-och-effekt', 'Läst.')];
    await openSpread();
    fireEvent.keyDown(field(), { key: 'Escape' });
    const read = within(spread()).getByRole('region', { name: 'Anteckningen läst — Enter eller ett klick skriver i den' });
    expect(document.activeElement).toBe(read);

    fireEvent.keyDown(read, { key: 'Enter' });

    expect(field().value).toBe('Läst.');
    expect(screen.getByText('Steg 1 av 3')).toBeTruthy();
  });

  it('closes with its key outside a field, and with Escape from outside the note', async () => {
    await openSpread();
    await userEvent.type(field(), 'Innan stängning');

    await userEvent.click(within(spread()).getByRole('button', { name: 'Stäng' }));

    expect(screen.queryByRole('region', { name: 'Anteckningsboken' })).toBeNull();
    // Closing saves at once, before any pause could have passed.
    expect(api.writes).toEqual([{ path: LESSON_SECTION, body: { body: 'Innan stängning' } }]);
  });

  it('sends one save at a time, so an earlier text can never arrive after a later one', async () => {
    const gate = Promise.withResolvers<void>();
    api.hold = gate.promise;
    await openSpread();
    await userEvent.type(field(), 'Ett');
    await vi.waitFor(() => expect(api.writes).toHaveLength(1), { timeout: 2000 });

    await userEvent.type(field(), ' två');
    await userEvent.click(within(spread()).getByRole('button', { name: 'Stäng' }));
    expect(api.writes.map(({ body }) => body)).toEqual([{ body: 'Ett' }]);

    gate.resolve();
    await vi.waitFor(() => expect(api.writes.map(({ body }) => body)).toEqual([{ body: 'Ett' }, { body: 'Ett två' }]));
  });

  it('quotes the text selected in the step with its key, and saves the section with the quote', async () => {
    api.sections = [section('lesson', 'energi-och-effekt', 'Min tanke.')];
    await openSpread();
    const word = screen.getByText('Effekt');
    window.getSelection()?.selectAllChildren(word);

    fireEvent.keyDown(word, { key: 'q' });

    expect(field().value).toBe('Min tanke.\n\n> Effekt\n\n');
    await vi.waitFor(() => expect(api.writes).toEqual([{ path: LESSON_SECTION, body: { body: 'Min tanke.\n\n> Effekt\n\n' } }]), { timeout: 2000 });
  });

  it('makes the selection bold from the bar, and the same button takes it off', async () => {
    api.sections = [section('lesson', 'energi-och-effekt', 'Lutningen är förlustfaktorn.')];
    await openSpread();
    field().setSelectionRange(13, 27);

    await userEvent.click(within(spread()).getByRole('button', { name: 'Fet' }));
    expect(field().value).toBe('Lutningen är **förlustfaktorn**.');
    await userEvent.click(within(spread()).getByRole('button', { name: 'Fet' }));

    expect(field().value).toBe('Lutningen är förlustfaktorn.');
    await vi.waitFor(() => expect(api.writes.at(-1)).toEqual({ path: LESSON_SECTION, body: { body: 'Lutningen är förlustfaktorn.' } }), { timeout: 2000 });
  });

  it('formats with ⌘ and a key, never ⌘E, which the browser may own', async () => {
    api.sections = [section('lesson', 'energi-och-effekt', 'ett\ntvå')];
    await openSpread();
    field().setSelectionRange(0, 7);

    fireEvent.keyDown(field(), { key: '7', code: 'Digit7', metaKey: true, shiftKey: true });
    expect(field().value).toBe('1. ett\n2. två');
    const ownedByBrowser = fireEvent.keyDown(field(), { key: 'e', code: 'KeyE', metaKey: true });

    expect(ownedByBrowser).toBe(true);
  });

  it('chooses a heading from its menu, which shows the line’s kind and closes without a change when clicked away from', async () => {
    api.sections = [section('lesson', 'energi-och-effekt', '- Lutningen')];
    await openSpread();
    field().setSelectionRange(4, 4);
    fireEvent.select(field());
    const menuButton = within(spread()).getByRole('button', { name: 'Stycke eller rubrik' });

    await userEvent.click(menuButton);
    expect(within(spread()).getByRole('menuitemradio', { name: 'Brödtext' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.mouseDown(document.body);
    expect(within(spread()).queryByRole('menu')).toBeNull();
    expect(field().value).toBe('- Lutningen');

    await userEvent.click(menuButton);
    await userEvent.click(within(spread()).getByRole('menuitemradio', { name: 'Rubrik' }));

    expect(field().value).toBe('# Lutningen');
    expect(within(spread()).queryByRole('menu')).toBeNull();
  });

  it('sends a pasted image to the notebook and links it where the caret is, drawn from the notebook when read', async () => {
    await openSpread();
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'skärm.png', { type: 'image/png' });

    fireEvent.paste(field(), { clipboardData: { items: [{ type: 'image/png', getAsFile: () => png }] } });

    await vi.waitFor(() => expect(field().value).toBe('\n![Inklistrad bild](bilder/bild-1.png)\n'));
    expect(api.images).toEqual([{ mediaType: 'image/png', data: 'iVBORw==' }]);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(within(spread()).getByRole('img', { name: 'Inklistrad bild' }).getAttribute('src')).toBe(`${BASE}/notebook/images/bild-1.png`);
  });

  it('refuses a pasted image of a kind it does not keep, saying which kinds it does, and sends nothing', async () => {
    await openSpread();
    const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' });

    fireEvent.paste(field(), { clipboardData: { items: [{ type: 'image/svg+xml', getAsFile: () => svg }] } });

    await vi.waitFor(() => expect(statusLine()).toBe('Bara PNG, JPEG, GIF och WebP kan läggas till.'));
    expect(api.images).toEqual([]);
    expect(field().value).toBe('');
  });

  it('draws no image a note links to outside the notebook', async () => {
    api.sections = [section('lesson', 'energi-och-effekt', '![utanför](https://example.com/x.png) ![pack](assets/x.png)')];
    await openSpread();

    fireEvent.keyDown(field(), { key: 'Escape' });

    expect(within(spread()).queryByRole('img')).toBeNull();
  });

  it('keeps the text and says so when a save fails, and saves on the next change', async () => {
    api.writeAnswers = [503];
    await openSpread();
    await userEvent.type(field(), 'Ett');
    await vi.waitFor(() => expect(statusLine()).toBe('Kunde inte spara. Texten ligger kvar här och sparas vid nästa ändring.'), { timeout: 2000 });

    await userEvent.type(field(), '!');

    await vi.waitFor(() => expect(api.writes.map(({ body }) => body)).toEqual([{ body: 'Ett' }, { body: 'Ett!' }]), { timeout: 2000 });
    await vi.waitFor(() => expect(statusLine()).toBe('Sparat'));
  });

  it('offers no field to write in while the notebook cannot be read, so an unread section is never written over', async () => {
    api.listFails = true;
    open(LESSON_PAGE);
    await screen.findByText('Steg 1 av 3');

    await userEvent.keyboard('n');

    expect(await within(spread()).findByText(/går inte att läsa just nu/)).toBeTruthy();
    expect(within(spread()).queryByRole('textbox')).toBeNull();
  });

  it('lists its keys in a map behind a button, each drawn as a chord', async () => {
    await openSpread();

    await userEvent.click(within(spread()).getByRole('button', { name: /Kortkommandon/ }));

    const map = within(spread()).getByRole('region', { name: 'Kortkommandon' });
    const row = within(map).getByText('Genomstruken').closest('.keymap-row');
    expect([...(row?.querySelectorAll('kbd') ?? [])].map((key) => key.textContent)).toEqual(['⌘', '⇧', 'X']);
  });
});

describe('the Notes tab', () => {
  it('reads the notebook as one document in the order of the path, the area’s own section first, with what is written', async () => {
    api.sections = [section('lesson', 'energibalans', 'Senast.'), section('area', 'grunder', 'Om grunderna.'), section('lesson', 'energi-och-effekt', 'Tidigare.')];
    open('/subjects/example-subject/notes');

    const document = await screen.findByRole('article');
    const order = [...document.querySelectorAll('[data-section]')].map((each) => each.getAttribute('data-section'));
    expect(order).toEqual(['area/grunder', 'lesson/energi-och-effekt', 'lesson/enhetsprefix', 'area/fordjupning', 'lesson/energibalans']);
    expect(within(document).getByText('Om grunderna.')).toBeTruthy();
    expect(within(document).getByRole('link', { name: 'Energi och effekt' }).getAttribute('href')).toBe('/subjects/example-subject/lessons/energi-och-effekt');
  });

  it('shows only written sections when asked', async () => {
    api.sections = [section('lesson', 'energibalans', 'Bara den.')];
    open('/subjects/example-subject/notes');
    await screen.findByRole('article');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Bara skrivna avsnitt' }));

    expect([...screen.getByRole('article').querySelectorAll('[data-section]')].map((each) => each.getAttribute('data-section'))).toEqual(['lesson/energibalans']);
  });

  it('writes in a section where it stands, and saves it under its lesson', async () => {
    open('/subjects/example-subject/notes');
    const document = await screen.findByRole('article');
    const enhet = document.querySelector('[data-section="lesson/enhetsprefix"]');
    if (!(enhet instanceof HTMLElement)) {
      throw new Error('no section for enhetsprefix');
    }

    await userEvent.click(within(enhet).getByRole('button', { name: 'Skriv' }));
    await userEvent.type(within(enhet).getByRole('textbox'), 'Kilo är tusen.');

    await vi.waitFor(() => expect(api.writes).toEqual([{ path: `${BASE}/notebook/lessons/enhetsprefix`, body: { body: 'Kilo är tusen.' } }]), { timeout: 2000 });
  });

  it('asks the server to search once typing pauses, and keeps to the sections it names', async () => {
    api.sections = [section('lesson', 'energibalans', 'Värmeförluster.'), section('lesson', 'energi-och-effekt', 'Kilowatt.')];
    open('/subjects/example-subject/notes');
    await screen.findByRole('article');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Sök i anteckningsboken' }), 'värme');

    await vi.waitFor(() => expect(api.lists).toContain('?q=v%C3%A4rme'));
    await vi.waitFor(() => expect([...screen.getByRole('article').querySelectorAll('[data-section]')].map((each) => each.getAttribute('data-section'))).toEqual(['lesson/energibalans']));
  });

  it('exports the notebook as a zip, its headings in the interface language and its titles in the content language', async () => {
    open('/subjects/example-subject/notes');
    await screen.findByRole('article');

    await userEvent.click(screen.getByRole('button', { name: 'Exportera …' }));

    const link = within(screen.getByRole('dialog', { hidden: true })).getByRole('link', { name: 'Exportera', hidden: true });
    expect([link.getAttribute('href'), link.hasAttribute('download')]).toEqual([`${BASE}/notebook.zip?language=sv&interface=sv`, true]);
  });

  it('makes a PDF through the browser’s printing', async () => {
    const print = vi.fn<() => void>();
    vi.stubGlobal('print', print);
    open('/subjects/example-subject/notes');
    await screen.findByRole('article');
    await userEvent.click(screen.getByRole('button', { name: 'Exportera …' }));
    const dialog = screen.getByRole('dialog', { hidden: true });

    await userEvent.click(within(dialog).getByRole('radio', { name: /PDF/, hidden: true }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Exportera', hidden: true }));

    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());
  });

  it('says how a notebook is written when nothing is', async () => {
    open('/subjects/example-subject/notes');

    expect(await screen.findByRole('heading', { name: 'Inga anteckningar än' })).toBeTruthy();
    expect(screen.getByText(/Tryck N i en lektion/)).toBeTruthy();
  });
});

describe('the notebook on the subject home', () => {
  it('counts the written sections, names where the latest was written, and leads to the notebook', async () => {
    api.sections = [section('lesson', 'energibalans', 'Senast.'), section('area', 'grunder', 'Tidigare.')];
    open('/subjects/example-subject');

    expect(await screen.findByText('2 avsnitt skrivna, senast i Energibalans.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Öppna anteckningsboken' }).getAttribute('href')).toBe('/subjects/example-subject/notes');
  });
});

describe('every notebook from the start screen', () => {
  it('is reached from a line on the start screen', async () => {
    open('/');

    const link = await screen.findByRole('link', { name: 'Anteckningsböcker' });
    expect(link.getAttribute('href')).toBe('/notes');
  });

  it('lists each subject’s notebook with how much is written and where last, leading to it', async () => {
    api.sections = [section('lesson', 'energibalans', 'Senast.')];
    open('/notes');

    const book = (await screen.findByRole('heading', { name: 'Exempelämne' })).closest('li');
    if (book === null) {
      throw new Error('no entry for the subject');
    }
    expect(within(book).getByText('1 avsnitt skrivet · senast i Energibalans')).toBeTruthy();
    expect(within(book).getByRole('link', { name: 'Öppna' }).getAttribute('href')).toBe('/subjects/example-subject/notes');
  });
});

describe('without the notes module', () => {
  it('the subject has no Notes tab and no notebook block', async () => {
    open('/subjects/example-subject', [lessonsModule]);

    const tabs = await screen.findByRole('navigation', { name: 'Ämnet' });
    expect(within(tabs).queryByRole('link', { name: 'Anteckningar' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Anteckningsboken' })).toBeNull();
    expect(api.lists).toEqual([]);
  });

  it('a lesson has no notebook button, and its key opens nothing', async () => {
    open(LESSON_PAGE, [lessonsModule]);
    await screen.findByText('Steg 1 av 3');

    await userEvent.keyboard('n');

    expect(screen.queryByRole('button', { name: /Anteckningsboken/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Anteckningsboken' })).toBeNull();
  });
});

describe('the notes module’s text', () => {
  it('has every message in both languages, with the same placeholders', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
  });
});
