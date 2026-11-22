import type { Glossary, LessonView, SubjectOutline, SubjectSummary } from '@skill-issue/contract';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import type { WebModule } from '../../shell/contract.js';
import { glossaryModule } from '../glossary/index.js';
import { notesModule } from '../notes/index.js';
import { readerModule } from '../reader/index.js';
import { lessonsModule } from './index.js';

/**
 * The lesson page's two ways of reading: the workbench, with the lesson's steps
 * and sources on the left and notes and the step's terms on the right, and
 * focus mode, one column with nothing beside the text.
 */

const SUBJECT: SubjectSummary = { id: 'example-subject', defaultLanguage: 'sv', languages: ['sv'], title: 'Exempelämne', summary: 'Energi och effekt.' };

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
      { type: 'text', body: '## Hur fort och hur mycket\n\n**Effekt** är hur fort energi används.' },
      { type: 'example', body: '## En värmefläkt\n\nEn värmefläkt på 2 kW i 3 timmar.' },
      { type: 'text', body: 'Mer om effekt, utan rubrik.' },
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
    { id: 'effekt', language: 'sv', term: 'Effekt', definition: 'Energi per tidsenhet.', alsoKnownAs: [], sources: [{ id: 'exempelkalla', language: 'sv', title: 'Exempelkälla' }] },
    { id: 'energi', language: 'sv', term: 'Energi', definition: 'Förmågan att uträtta arbete.', alsoKnownAs: [], sources: [{ id: 'exempelkalla', language: 'sv', title: 'Exempelkälla' }] },
  ],
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    if (init?.method === 'PUT') {
      const written = /\/notes\/subjects\/example-subject\/lessons\/([^/]+)\/steps\/(\d+)$/.exec(url.pathname);
      const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : '{}');
      const text = typeof body === 'object' && body !== null && 'body' in body && typeof body.body === 'string' ? body.body : '';
      return written !== null
        ? json({ subjectId: 'example-subject', lessonId: written[1], step: Number(written[2]), body: text, createdAt: '2026-11-22T10:00:00Z', updatedAt: '2026-11-22T10:00:00Z' })
        : json({ step: 0, steps: 3, revision: 1, startedAt: '2026-11-22T10:00:00Z', updatedAt: '2026-11-22T10:00:00Z', finishedAt: null });
    }
    switch (url.pathname) {
      case '/api/v1/health':
        return json({ status: 'ok', version: 'test', database: 'up', modules: ['content', 'lessons', 'glossary', 'notes'] });
      case '/api/v1/content/subjects':
        return json([SUBJECT]);
      case '/api/v1/content/subjects/example-subject':
        return json(OUTLINE);
      case '/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt':
        return json(VIEW);
      case '/api/v1/glossary/subjects/example-subject/terms':
        return json(GLOSSARY);
      case '/api/v1/notes/subjects/example-subject/notes':
        return json({ subjectId: 'example-subject', notes: [] });
      default:
        return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404);
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const LESSON_PAGE = '/subjects/example-subject/lessons/energi-och-effekt';
/** Where the lesson page keeps the way of reading between visits. */
const READING_KEY = 'skill-issue.lessons.reading';

function open(modules: readonly WebModule[] = [readerModule, lessonsModule, glossaryModule, notesModule]): void {
  window.history.replaceState(null, '', LESSON_PAGE);
  render(<App modules={modules} />);
}

const lesson = async (): Promise<HTMLElement> => {
  await screen.findByRole('heading', { name: 'Hur fort och hur mycket' });
  return document.querySelector('.lesson') as HTMLElement;
};
const outline = (): HTMLElement => screen.getByRole('navigation', { name: 'Lektionens steg' });
const terms = (): HTMLElement => screen.getByRole('region', { name: 'Begrepp i steget' });
const modeSwitch = (): HTMLElement => screen.getByRole('button', { name: 'Fokusläge' });

describe('the workbench, the default way of reading a lesson', () => {
  it('lists the lesson’s steps beside it by their headings, the one on screen marked, and passed steps as a way back', async () => {
    open();
    const page = await lesson();
    expect(page.dataset['reading']).toBe('bench');

    const steps = within(outline()).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual(['Hur fort och hur mycket', 'En värmefläkt', 'Text']);
    expect(steps[0]?.getAttribute('aria-current')).toBe('step');
    expect(within(outline()).queryAllByRole('button')).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Fortsätt' }));
    await screen.findByRole('heading', { name: 'En värmefläkt' });

    expect(within(outline()).getAllByRole('listitem')[1]?.getAttribute('aria-current')).toBe('step');
    await userEvent.click(within(outline()).getByRole('button', { name: 'Hur fort och hur mycket' }));
    await screen.findByRole('heading', { name: 'Hur fort och hur mycket', level: 2 });
  });

  it('names the sources the lesson rests on beside it, linked to their pages', async () => {
    open();
    await lesson();

    const rail = outline().closest('.lesson-rail') as HTMLElement;
    expect(within(rail).getByRole('link', { name: 'Exempelkälla' }).getAttribute('href')).toBe('/subjects/example-subject/reader/exempelkalla');
  });

  it('gives the step’s terms beside the text, not over it, and lights a term’s entry while its mark is pointed at', async () => {
    open();
    const page = await lesson();
    await vi.waitFor(() => expect(within(terms()).getAllByRole('definition').map((entry) => entry.textContent?.trim())).toEqual(['Energi per tidsenhet.', 'Förmågan att uträtta arbete.']));

    const mark = within(page.querySelector('article.step') as HTMLElement).getByRole('button', { name: 'Effekt' });
    fireEvent.pointerOver(mark);

    expect(document.querySelector('.term-card')).toBeNull();
    expect(within(terms()).getByText('Energi per tidsenhet.').closest('.step-term')?.classList.contains('lit')).toBe(true);
    expect(within(terms()).getByText('Förmågan att uträtta arbete.').closest('.step-term')?.classList.contains('lit')).toBe(false);
  });

  it('shows no terms beside a step that names none', async () => {
    open();
    await lesson();
    await vi.waitFor(() => expect(terms()).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Fortsätt' }));
    await screen.findByRole('heading', { name: 'En värmefläkt' });

    expect(screen.queryByRole('region', { name: 'Begrepp i steget' })).toBeNull();
  });
});

describe('focus mode', () => {
  it('is switched on and off from the lesson’s header, drops what stands beside the text, and opens a term’s card where it is', async () => {
    open();
    const page = await lesson();
    await vi.waitFor(() => expect(terms()).toBeTruthy());

    await userEvent.click(modeSwitch());

    expect(page.dataset['reading']).toBe('focus');
    expect(modeSwitch().getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('navigation', { name: 'Lektionens steg' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Begrepp i steget' })).toBeNull();
    fireEvent.pointerOver(within(page.querySelector('article.step') as HTMLElement).getByRole('button', { name: 'Effekt' }));
    expect(document.querySelector('.term-card')?.textContent).toContain('Energi per tidsenhet.');

    await userEvent.click(modeSwitch());
    expect(page.dataset['reading']).toBe('bench');
    expect(outline()).toBeTruthy();
  });

  it('is switched with F, but not while typing in a field', async () => {
    open();
    const page = await lesson();

    await userEvent.keyboard('f');
    expect(page.dataset['reading']).toBe('focus');

    await userEvent.keyboard('n');
    const note = await screen.findByRole('textbox', { name: /Anteckning vid steg 1/ });
    await userEvent.type(note, 'fff');
    expect(page.dataset['reading']).toBe('focus');
    expect((note as HTMLTextAreaElement).value).toBe('fff');
  });

  it('keeps the step and an open note, with what was written in it, through a switch either way', async () => {
    open();
    await lesson();
    await userEvent.click(screen.getByRole('button', { name: 'Fortsätt' }));
    await screen.findByRole('heading', { name: 'En värmefläkt' });
    await userEvent.click(screen.getByRole('button', { name: 'Anteckna' }));
    const note = await screen.findByRole('textbox', { name: /Anteckning vid steg 2/ });
    await userEvent.type(note, 'Två kW i tre timmar.');

    await userEvent.click(modeSwitch());
    expect(screen.getByRole('heading', { name: 'En värmefläkt' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Anteckning vid steg 2/ })).toBe(note);
    expect((note as HTMLTextAreaElement).value).toBe('Två kW i tre timmar.');

    await userEvent.click(modeSwitch());
    expect(screen.getByRole('textbox', { name: /Anteckning vid steg 2/ })).toBe(note);
  });

  it('is remembered on the device', async () => {
    window.localStorage.setItem(READING_KEY, 'focus');
    open();
    expect((await lesson()).dataset['reading']).toBe('focus');

    await userEvent.click(modeSwitch());
    expect(window.localStorage.getItem(READING_KEY)).toBe('bench');
  });

  it('falls back to the workbench for a stored value it does not know', async () => {
    window.localStorage.setItem(READING_KEY, 'sideways');
    open();
    expect((await lesson()).dataset['reading']).toBe('bench');
  });
});
