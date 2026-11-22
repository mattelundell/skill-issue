import type { LessonView, Note, SubjectOutline, SubjectSummary } from '@skill-issue/contract';
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

const note = (lessonId: string, step: number, body: string, updatedAt = '2026-11-21T10:00:00Z'): Note => ({
  subjectId: 'example-subject',
  lessonId,
  step,
  body,
  createdAt: '2026-11-20T09:00:00Z',
  updatedAt,
});

interface FakeApi {
  /** What the server holds, the most recently written first. */
  notes: Note[];
  /** Status of each coming note write, in order; 200 once they run out. */
  writeAnswers: number[];
  listFails: boolean;
  /** Held until released: the next write waits on it before the server answers. */
  hold: Promise<void> | undefined;
  readonly writes: { readonly path: string; readonly body: unknown }[];
  readonly lists: string[];
}

let api: FakeApi;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NOTES_BASE = '/api/v1/notes/subjects/example-subject';

beforeEach(() => {
  api = { notes: [], writeAnswers: [], listFails: false, hold: undefined, writes: [], lists: [] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    const path = url.pathname;
    if (init?.method === 'PUT' && path.startsWith(`${NOTES_BASE}/lessons/`)) {
      const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : '');
      api.writes.push({ path, body });
      const held = api.hold;
      api.hold = undefined;
      await held;
      const status = api.writeAnswers.shift() ?? 200;
      const [, lessonId, step] = /\/lessons\/([^/]+)\/steps\/(\d+)$/.exec(path) ?? [];
      const text = typeof body === 'object' && body !== null && 'body' in body && typeof body.body === 'string' ? body.body : '';
      if (status !== 200) {
        return json({ type: 'about:blank', title: 'Down', status }, status);
      }
      return text.trim() === '' ? new Response(null, { status: 204 }) : json(note(lessonId ?? '', Number(step), text));
    }
    if (init?.method === 'PUT') {
      return json({ step: 0, steps: 3, revision: 1, startedAt: '2026-11-21T10:00:00Z', updatedAt: '2026-11-21T10:00:00Z', finishedAt: null });
    }
    if (path === `${NOTES_BASE}/notes`) {
      api.lists.push(url.search);
      if (api.listFails) {
        return json({ type: 'about:blank', title: 'Down', status: 503 }, 503);
      }
      const lesson = url.searchParams.get('lesson');
      const q = url.searchParams.get('q')?.toLowerCase();
      const notes = api.notes.filter((each) => (lesson === null || each.lessonId === lesson) && (q === undefined || each.body.toLowerCase().includes(q)));
      return json({ subjectId: 'example-subject', notes: lesson === null ? notes : notes.toSorted((a, b) => a.step - b.step) });
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
      return json({ offer: null, started: [] });
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
const STEP_NOTE = (step: number) => `${NOTES_BASE}/lessons/energi-och-effekt/steps/${step}`;
const pane = (): HTMLElement => screen.getByRole('region', { name: 'Anteckning' });
const field = (): HTMLTextAreaElement => {
  const found = within(pane()).getByRole('textbox');
  if (!(found instanceof HTMLTextAreaElement)) {
    throw new Error('the note field is not a text area');
  }
  return found;
};
const statusLine = (): string | null => pane().querySelector('output')?.textContent ?? null;

async function openPane(): Promise<void> {
  open(LESSON_PAGE);
  await screen.findByText('Steg 1 av 3');
  await userEvent.click(screen.getByRole('button', { name: 'Anteckna' }));
  await within(pane()).findByRole('textbox');
}

describe('the note pane', () => {
  it('shows the note already written at the step on screen, filed under its area and lesson, ready to type into', async () => {
    api.notes = [note('energi-och-effekt', 0, 'Effekt är takt.'), note('energi-och-effekt', 1, 'Ett annat steg.'), note('enhetsprefix', 0, 'Annan lektion.')];
    await openPane();

    expect(api.lists).toEqual(['?lesson=energi-och-effekt']);
    expect(within(pane()).getByText('Energi och effekt · steg 1')).toBeTruthy();
    expect(field().value).toBe('Effekt är takt.');
    expect(field().getAttribute('aria-label')).toBe('Anteckning vid steg 1');
    expect(statusLine()).toBe('Sparad. Hamnar under Grunder › Energi och effekt.');
    expect(document.activeElement).toBe(field());
  });

  it('saves what is typed once typing pauses, at the lesson and the step, and says where it is filed', async () => {
    await openPane();
    expect(statusLine()).toBe('Hamnar under Grunder › Energi och effekt.');

    await userEvent.type(field(), 'kW är takt');

    expect(statusLine()).toBe('Sparar …');
    await vi.waitFor(() => expect(api.writes).toEqual([{ path: STEP_NOTE(0), body: { body: 'kW är takt' } }]), { timeout: 2000 });
    await vi.waitFor(() => expect(statusLine()).toBe('Sparad. Hamnar under Grunder › Energi och effekt.'));
  });

  it('saves at once on leaving the step, then shows the next step’s own note', async () => {
    api.notes = [note('energi-och-effekt', 1, 'Fläkten.')];
    await openPane();
    await userEvent.type(field(), 'Steg ett');

    await userEvent.click(screen.getByRole('button', { name: 'Fortsätt' }));

    // Saved before any pause could have passed.
    expect(api.writes).toEqual([{ path: STEP_NOTE(0), body: { body: 'Steg ett' } }]);
    expect(within(pane()).getByText('Energi och effekt · steg 2')).toBeTruthy();
    expect(field().value).toBe('Fläkten.');

    await userEvent.click(screen.getByRole('button', { name: /Föregående/ }));
    expect(field().value).toBe('Steg ett');
  });

  it('sends one save at a time, so an earlier text can never arrive after a later one', async () => {
    const gate = Promise.withResolvers<void>();
    api.hold = gate.promise;
    await openPane();
    await userEvent.type(field(), 'Ett');
    await vi.waitFor(() => expect(api.writes).toHaveLength(1), { timeout: 2000 });

    await userEvent.type(field(), ' två');
    await userEvent.click(screen.getByRole('button', { name: 'Fortsätt' }));
    // The first is still unanswered, so the second has not been sent.
    expect(api.writes.map(({ body }) => body)).toEqual([{ body: 'Ett' }]);

    gate.resolve();
    await vi.waitFor(() => expect(api.writes.map(({ body }) => body)).toEqual([{ body: 'Ett' }, { body: 'Ett två' }]));
  });

  it('saves at once when the pane is closed', async () => {
    await openPane();
    await userEvent.type(field(), 'Innan stängning');

    await userEvent.click(screen.getByRole('button', { name: 'Stäng anteckningen' }));

    expect(api.writes).toEqual([{ path: STEP_NOTE(0), body: { body: 'Innan stängning' } }]);
  });

  it('quotes the text selected in the step with its key, and saves the note with the quote', async () => {
    api.notes = [note('energi-och-effekt', 0, 'Min tanke.')];
    await openPane();
    const word = screen.getByText('Effekt');
    window.getSelection()?.selectAllChildren(word);

    fireEvent.keyDown(word, { key: 'q' });

    expect(field().value).toBe('Min tanke.\n\n> Effekt\n\n');
    await vi.waitFor(() => expect(api.writes).toEqual([{ path: STEP_NOTE(0), body: { body: 'Min tanke.\n\n> Effekt\n\n' } }]), { timeout: 2000 });
  });

  it('quotes with its key pressed in the note itself while text in the step is selected, as a keyboard user selects', async () => {
    await openPane();
    window.getSelection()?.selectAllChildren(screen.getByText('Effekt'));

    fireEvent.keyDown(field(), { key: 'q' });

    expect(field().value).toBe('> Effekt\n\n');
  });

  it('leaves its key to the note when typing there with nothing in the step selected', async () => {
    await openPane();
    window.getSelection()?.removeAllRanges();

    fireEvent.keyDown(field(), { key: 'q' });

    expect(statusLine()).toBe('Hamnar under Grunder › Energi och effekt.');
    expect(field().value).toBe('');
  });

  it('says what to do when its quote key is pressed with nothing selected in the step', async () => {
    await openPane();
    window.getSelection()?.removeAllRanges();

    fireEvent.keyDown(screen.getByText('Effekt'), { key: 'q' });

    expect(statusLine()).toBe('Markera text i steget först, så citeras den.');
    expect(field().value).toBe('');
    expect(api.writes).toEqual([]);
  });

  it('sends an emptied note so the server removes it', async () => {
    api.notes = [note('energi-och-effekt', 0, 'Bort')];
    await openPane();

    await userEvent.clear(field());

    await vi.waitFor(() => expect(api.writes).toEqual([{ path: STEP_NOTE(0), body: { body: '' } }]), { timeout: 2000 });
    await vi.waitFor(() => expect(statusLine()).toBe('Hamnar under Grunder › Energi och effekt.'));
  });

  it('keeps the text and says so when a save fails, and saves on the next change', async () => {
    api.writeAnswers = [503];
    await openPane();

    await userEvent.type(field(), 'Viktigt');
    await vi.waitFor(() => expect(statusLine()).toBe('Kunde inte sparas. Texten står kvar här och sparas när du skriver igen.'), { timeout: 2000 });
    expect(field().value).toBe('Viktigt');

    await userEvent.type(field(), '!');
    await vi.waitFor(() => expect(api.writes.at(-1)).toEqual({ path: STEP_NOTE(0), body: { body: 'Viktigt!' } }), { timeout: 2000 });
    await vi.waitFor(() => expect(statusLine()).toBe('Sparad. Hamnar under Grunder › Energi och effekt.'));
  });

  it('offers no field to write in while the notes cannot be read, so an unread note is never written over', async () => {
    api.listFails = true;
    open(LESSON_PAGE);
    await screen.findByText('Steg 1 av 3');
    await userEvent.click(screen.getByRole('button', { name: 'Anteckna' }));

    expect((await within(pane()).findByRole('alert')).textContent).toContain('Anteckningarna går inte att läsa just nu');
    expect(within(pane()).queryByRole('textbox')).toBeNull();

    api.listFails = false;
    await userEvent.click(within(pane()).getByRole('button', { name: 'Försök igen' }));
    expect(await within(pane()).findByRole('textbox')).toBeTruthy();
  });
});

describe('the Notes tab', () => {
  it('files every note by area and lesson in the order of the path, each in step order and linking back to its step', async () => {
    api.notes = [
      note('energibalans', 0, 'Balansen.', '2026-11-21T12:00:00Z'),
      note('energi-och-effekt', 2, 'Tredje steget.', '2026-11-21T11:00:00Z'),
      note('borttagen', 0, 'Från en lektion som inte finns.', '2026-11-21T10:30:00Z'),
      note('energi-och-effekt', 0, '**Första** steget.', '2026-11-21T10:00:00Z'),
    ];
    open('/subjects/example-subject/notes');

    expect((await screen.findByText(/anteckningar$/)).textContent).toBe('4 anteckningar');
    const areas = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(areas).toEqual(['Grunder', 'Fördjupning', 'Inte längre i ämnet']);

    const lesson = screen.getByRole('article', { name: 'Energi och effekt' });
    expect(within(lesson).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Steg 1', `${LESSON_PAGE}/1`],
      ['Steg 3', `${LESSON_PAGE}/3`],
    ]);
    expect(within(lesson).getByText('Första').tagName).toBe('STRONG');

    const gone = screen.getByRole('article', { name: 'Lektionen borttagen' });
    expect(within(gone).queryAllByRole('link')).toEqual([]);
    expect(within(gone).getByText('Steg 1')).toBeTruthy();
  });

  it('offers every note in the subject as one Markdown file, its headings in the interface language and its titles in the content language', async () => {
    api.notes = [note('energi-och-effekt', 0, 'Första steget.')];
    open('/subjects/example-subject/notes');

    const link = await screen.findByRole('link', { name: 'Exportera som Markdown' });

    expect([link.getAttribute('href'), link.hasAttribute('download')]).toEqual(['/api/v1/notes/subjects/example-subject/notes.md?language=sv&interface=sv', true]);
  });

  it('asks for the file’s headings in English when the interface is', async () => {
    window.localStorage.setItem('skill-issue.language', 'en');
    api.notes = [note('energi-och-effekt', 0, 'Första steget.')];
    open('/subjects/example-subject/notes');

    const link = await screen.findByRole('link', { name: 'Export as Markdown' });

    expect(link.getAttribute('href')).toBe('/api/v1/notes/subjects/example-subject/notes.md?language=sv&interface=en');
  });

  it('opens the lesson at the note’s step from its link', async () => {
    api.notes = [note('energi-och-effekt', 2, 'Tredje steget.')];
    open('/subjects/example-subject/notes');

    await userEvent.click(await screen.findByRole('link', { name: 'Steg 3' }));

    expect(await screen.findByText('Steg 3 av 3')).toBeTruthy();
    expect(window.location.pathname).toBe(LESSON_PAGE);
  });

  it('names steps without links when no module draws lessons', async () => {
    api.notes = [note('energi-och-effekt', 0, 'Utan lektioner.')];
    open('/subjects/example-subject/notes', [notesModule]);

    const lesson = await screen.findByRole('article', { name: 'Energi och effekt' });
    expect(within(lesson).queryAllByRole('link')).toEqual([]);
    expect(within(lesson).getByText('Steg 1')).toBeTruthy();
  });

  it('asks the server to search once typing pauses, and shows what matched', async () => {
    api.notes = [note('energi-och-effekt', 0, 'Effekt i kW.'), note('enhetsprefix', 0, 'Mega och kilo.')];
    open('/subjects/example-subject/notes');
    await screen.findByText('2 anteckningar');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Sök i anteckningarna' }), 'mega');

    expect(await screen.findByText('1 anteckning innehåller ”mega”')).toBeTruthy();
    expect(api.lists).toEqual(['', '?q=mega']);
    expect(screen.getAllByRole('article').map((article) => article.getAttribute('aria-label'))).toEqual(['Enhetsprefix']);
  });

  it('says when nothing matches, and shows every note again on asking', async () => {
    api.notes = [note('energi-och-effekt', 0, 'Effekt i kW.')];
    open('/subjects/example-subject/notes');
    await screen.findByText('1 anteckning');

    await userEvent.type(screen.getByRole('searchbox'), 'zz');
    expect(await screen.findByText('Inga anteckningar innehåller ”zz”.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Visa alla anteckningar' }));
    expect(await screen.findByText('1 anteckning')).toBeTruthy();
    expect(screen.getByRole('searchbox')).toHaveProperty('value', '');
  });

  it('says how notes are written when there are none', async () => {
    open('/subjects/example-subject/notes');

    expect(await screen.findByRole('heading', { name: 'Inga anteckningar än' })).toBeTruthy();
    expect(screen.getByText(/tryck N i en lektion/)).toBeTruthy();
  });
});

describe('the notes block on the subject home', () => {
  it('counts the notes, names the lesson of the latest, and leads to them all', async () => {
    api.notes = [note('energibalans', 0, 'Senast.'), note('energi-och-effekt', 0, 'Tidigare.')];
    open('/subjects/example-subject');

    expect(await screen.findByText('2 anteckningar, senast i Energibalans.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bläddra' }).getAttribute('href')).toBe('/subjects/example-subject/notes');
  });

  it('with no notes says where they are written, with nothing to browse', async () => {
    open('/subjects/example-subject');

    expect(await screen.findByText('Inga än. Anteckningar skrivs bredvid lektionerna.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Bläddra' })).toBeNull();
  });
});

describe('without the notes module', () => {
  it('the subject has no Notes tab and no notes block', async () => {
    open('/subjects/example-subject', [lessonsModule]);

    const tabs = await screen.findByRole('navigation', { name: 'Ämnet' });
    expect(within(tabs).queryByRole('link', { name: 'Anteckningar' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Anteckningar' })).toBeNull();
    expect(api.lists).toEqual([]);
  });

  it('a lesson has no note button, and its key opens nothing', async () => {
    open(LESSON_PAGE, [lessonsModule]);
    await screen.findByText('Steg 1 av 3');

    await userEvent.keyboard('n');

    expect(screen.queryByRole('button', { name: 'Anteckna' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Anteckning' })).toBeNull();
  });

  it('with it, the subject has the tab and the block', async () => {
    open('/subjects/example-subject');

    const tabs = await screen.findByRole('navigation', { name: 'Ämnet' });
    expect(within(tabs).getByRole('link', { name: 'Anteckningar' }).getAttribute('href')).toBe('/subjects/example-subject/notes');
    expect(await screen.findByRole('heading', { name: 'Anteckningar' })).toBeTruthy();
  });
});

describe('the notes module’s text', () => {
  it('has every message in both languages, with the same placeholders', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
  });
});
