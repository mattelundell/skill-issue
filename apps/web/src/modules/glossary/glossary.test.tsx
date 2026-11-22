import type { Glossary, LessonView, SubjectOutline, SubjectSummary } from '@skill-issue/contract';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import type { WebModule } from '../../shell/contract.js';
import { catalogueFaults } from '../../shell/messages.js';
import { lessonsModule } from '../lessons/index.js';
import { readerModule } from '../reader/index.js';
import { glossaryModule } from './index.js';
import { catalogues } from './messages.js';

const SUBJECT: SubjectSummary = { id: 'example-subject', defaultLanguage: 'sv', languages: ['sv', 'en'], title: 'Exempelämne', summary: 'Energi och effekt.' };

const OUTLINE: SubjectOutline = {
  ...SUBJECT,
  language: 'sv',
  areas: [{ id: 'grunder', language: 'sv', title: 'Grunder', summary: 'Storheterna.', requires: [], lessons: [{ id: 'energi-och-effekt', language: 'sv', title: 'Energi och effekt', summary: 'kWh och kW.' }] }],
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
      { type: 'text', body: '## Effekt och energi\n\n**Effekten** är hur fort energi används. Effekt mäts i watt.' },
      { type: 'example', body: 'En värmefläkt med effekten 2 kW använder energi.' },
      { type: 'text', body: 'Mer om effekt: den kallas power på engelska.' },
    ],
    sources: [{ id: 'exempelkalla', title: 'Exempelkälla', publisher: 'Exempelförlaget' }],
  },
  position: null,
  resumeAt: 0,
  changedSince: false,
  checks: { answeredAfter: 0, again: [] },
};

const GLOSSARY: Glossary = {
  subjectId: 'example-subject',
  terms: [
    {
      id: 'effekt',
      language: 'sv',
      term: 'Effekt',
      definition: 'Energi per **tidsenhet**. Mäts i watt (W).',
      alsoKnownAs: ['power'],
      sources: [
        { id: 'exempelkalla', language: 'sv', title: 'Exempelkälla om energi och effekt' },
        { id: 'matmetoder', language: 'sv', title: 'Mätmetoder' },
      ],
    },
    { id: 'energi', language: 'sv', term: 'Energi', definition: 'Förmågan att uträtta arbete.', alsoKnownAs: [], sources: [{ id: 'exempelkalla', language: 'sv', title: 'Exempelkälla om energi och effekt' }] },
  ],
};

let requested: string[];
let glossaryStatus: number;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  requested = [];
  glossaryStatus = 200;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    requested.push(`${url.pathname}${url.search}`);
    if (init?.method === 'PUT') {
      return json({ step: 0, steps: 3, revision: 1, startedAt: '2026-11-22T10:00:00Z', updatedAt: '2026-11-22T10:00:00Z', finishedAt: null });
    }
    switch (url.pathname) {
      case '/api/v1/health':
        return json({ status: 'ok', version: 'test', database: 'up', modules: ['content', 'lessons', 'glossary'] });
      case '/api/v1/content/subjects':
        return json([SUBJECT]);
      case '/api/v1/content/subjects/example-subject':
        return json(OUTLINE);
      case '/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt':
        return json(VIEW);
      case '/api/v1/glossary/subjects/example-subject/terms':
        return glossaryStatus === 200 ? json(GLOSSARY) : json({ type: 'about:blank', title: 'Down', status: glossaryStatus }, glossaryStatus);
      default:
        return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404);
    }
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const LESSON_PAGE = '/subjects/example-subject/lessons/energi-och-effekt';

function open(modules: readonly WebModule[] = [readerModule, lessonsModule, glossaryModule]): void {
  window.history.replaceState(null, '', LESSON_PAGE);
  render(<App modules={modules} />);
}

/** The step on screen. Its text is drawn again once the marks arrive, so it is found by the article that stays, not by a word that is replaced. */
const step = async (): Promise<HTMLElement> => {
  await screen.findByText('Effekten');
  return screen.getByRole('article');
};
const marksIn = (element: HTMLElement): readonly string[] => [...element.querySelectorAll('button.term')].map((mark) => mark.textContent ?? '');
const next = async (): Promise<void> => userEvent.click(screen.getByRole('button', { name: 'Fortsätt' }));

describe('glossary terms in a lesson', () => {
  it('marks each term the first time a text step names it, in any form, and not in the heading', async () => {
    open();

    const article = await step();
    await vi.waitFor(() => expect(marksIn(article)).toEqual(['Effekten', 'energi']));
    expect(within(article).getByRole('heading', { name: 'Effekt och energi' }).querySelector('button')).toBeNull();
    // Asked in the language the subject is shown in.
    expect(requested).toContain('/api/v1/glossary/subjects/example-subject/terms?language=sv');
  });

  it('shows a term’s definition, drawn as Markdown, and links each source it rests on to the source’s page', async () => {
    open();
    const article = await step();
    await vi.waitFor(() => expect(marksIn(article)).toContain('Effekten'));

    // On the workbench, the lesson's default way of reading, a term's card stands beside the text, in the step's terms.
    const card = await vi.waitFor(() => {
      const entry = document.getElementById('term-effekt');
      expect(entry).not.toBeNull();
      return entry as HTMLElement;
    });
    expect(within(card).getByText('Effekt', { selector: 'dfn' })).toBeTruthy();
    expect(within(card).getByText('tidsenhet', { selector: 'strong' })).toBeTruthy();
    expect(within(card).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Exempelkälla om energi och effekt', '/subjects/example-subject/reader/exempelkalla'],
      ['Mätmetoder', '/subjects/example-subject/reader/matmetoder'],
    ]);
    expect(within(card).getByText('Kallas också power')).toBeTruthy();
  });

  it('marks nothing in an example step, and marks a term again on a later text step, found by another of its names', async () => {
    open();
    await step();

    await next();
    await screen.findByText(/värmefläkt/);
    const example = screen.getByRole('article');
    expect(marksIn(example)).toEqual([]);

    await next();
    await screen.findByText(/Mer om/);
    const later = screen.getByRole('article');
    await vi.waitFor(() => expect(marksIn(later)).toEqual(['effekt']));
  });

  it('names sources without linking them when no module shows sources', async () => {
    open([lessonsModule, glossaryModule]);
    const article = await step();
    await vi.waitFor(() => expect(marksIn(article)).toContain('Effekten'));

    // On the workbench, the lesson's default way of reading, a term's card stands beside the text, in the step's terms.
    const card = await vi.waitFor(() => {
      const entry = document.getElementById('term-effekt');
      expect(entry).not.toBeNull();
      return entry as HTMLElement;
    });
    expect(within(card).queryAllByRole('link')).toEqual([]);
    expect(card.textContent).toContain('Exempelkälla om energi och effekt');
    expect(card.textContent).toContain('Mätmetoder');
  });

  it('draws the text as written when the glossary cannot be read, saying nothing of it', async () => {
    glossaryStatus = 503;
    open();
    const article = await step();

    await vi.waitFor(() => expect(requested).toContain('/api/v1/glossary/subjects/example-subject/terms?language=sv'));
    expect(marksIn(article)).toEqual([]);
    expect(article.textContent).toContain('Effekten är hur fort energi används. Effekt mäts i watt.');
  });

  it('marks nothing and asks for no glossary without the module, leaving the text as written', async () => {
    open([readerModule, lessonsModule]);
    const article = await step();

    expect(marksIn(article)).toEqual([]);
    expect(article.textContent).toContain('Effekten är hur fort energi används. Effekt mäts i watt.');
    expect(requested.some((path) => path.startsWith('/api/v1/glossary'))).toBe(false);
  });
});

describe('the glossary module’s text', () => {
  it('has every message in every interface language', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
  });
});
