import type { AskedQuestion, LessonView, SubjectOutline, SubjectSummary } from '@skill-issue/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { assessmentModule } from '../modules/assessment/index.js';
import { lessonsModule } from '../modules/lessons/index.js';
import { readerModule } from '../modules/reader/index.js';

/**
 * The content language: a subject written in several languages offers the
 * choice on its home, remembered for that subject on the device, and every
 * module reads the subject's material in it — separately from the interface
 * language, which only the header's switch changes.
 */

const SUBJECT: SubjectSummary = { id: 'example-subject', defaultLanguage: 'sv', languages: ['en', 'sv'], title: 'Exempelämne', summary: 'Energi och effekt.' };

const outlineIn = (language: string): SubjectOutline =>
  language === 'en'
    ? {
        ...SUBJECT,
        language: 'en',
        title: 'Example subject',
        summary: 'Energy and power.',
        areas: [
          {
            id: 'grunder',
            language: 'en',
            title: 'Basics',
            summary: 'The quantities.',
            requires: [],
            lessons: [
              { id: 'energi-och-effekt', language: 'en', title: 'Energy and power', summary: 'kWh and kW.' },
              // Not translated: shown in Swedish, and marked so.
              { id: 'enhetsprefix', language: 'sv', title: 'Enhetsprefix', summary: 'Kilo och mega.' },
            ],
          },
        ],
      }
    : {
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
        ],
      };

const QUESTION: Readonly<Record<string, AskedQuestion>> = {
  sv: { language: 'sv', id: 'effekt-ar-takt', prompt: 'Effekt anger hur fort energi används.', type: 'true-false' },
  en: { language: 'en', id: 'effekt-ar-takt', prompt: 'Power states how fast energy is used.', type: 'true-false' },
};

const lessonIn = (language: string): LessonView => ({
  lesson: {
    subjectId: 'example-subject',
    id: 'energi-och-effekt',
    language,
    revision: 1,
    title: language === 'en' ? 'Energy and power' : 'Energi och effekt',
    summary: 'kWh.',
    area: { id: 'grunder', language, title: language === 'en' ? 'Basics' : 'Grunder' },
    steps: [{ type: 'check', questions: ['effekt-ar-takt'] }],
    sources: [],
  },
  position: null,
  resumeAt: 0,
  changedSince: false,
  checks: { answeredAfter: 0, again: [] },
});

const api: { subjects: SubjectSummary[]; requested: string[] } = { subjects: [SUBJECT], requested: [] };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  api.subjects = [SUBJECT];
  api.requested = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    api.requested.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    // The server falls back to the default language for one it does not hold.
    const asked = url.searchParams.get('language') === 'en' ? 'en' : 'sv';
    if (init?.method === 'PUT') {
      return json({ step: 0, steps: 1, revision: 1, startedAt: '2026-11-22T10:00:00Z', updatedAt: '2026-11-22T10:00:00Z', finishedAt: null });
    }
    switch (url.pathname) {
      case '/api/v1/health':
        return json({ status: 'ok', version: 'test', database: 'up', modules: ['content', 'lessons', 'assessment'] });
      case '/api/v1/content/subjects':
        return json(api.subjects);
      case '/api/v1/content/subjects/example-subject': {
        const subject = api.subjects[0];
        const outline = outlineIn(asked);
        return json(subject?.languages.length === 1 ? { ...outlineIn('sv'), languages: ['sv'] } : outline);
      }
      case '/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt':
        return json(lessonIn(asked));
      case '/api/v1/lessons/subjects/example-subject/positions':
        return json({ subjectId: 'example-subject', lessons: {} });
      case '/api/v1/assessment/subjects/example-subject/questions':
        return json({ subjectId: 'example-subject', questions: [QUESTION[asked]] });
      case '/api/v1/assessment/subjects/example-subject/answers':
        return json({ subjectId: 'example-subject', answers: [] });
      case '/api/v1/assessment/subjects/example-subject/passed':
        return json({ subjectId: 'example-subject', lessons: [], areas: [] });
      default:
        return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404);
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function open(path: string): ReturnType<typeof render> {
  window.history.replaceState(null, '', path);
  return render(<App modules={[lessonsModule, assessmentModule]} />);
}

const outlinesAsked = (): string[] => api.requested.filter((request) => request.startsWith('GET /api/v1/content/subjects/example-subject'));
const picker = (): HTMLSelectElement => screen.getByRole('combobox', { name: 'Innehållets språk' });

describe('choosing the language a subject is read in', () => {
  it('offers the subject’s languages, each in its own name, starting at the default', async () => {
    open('/subjects/example-subject');

    await screen.findByRole('heading', { name: 'Grunder' });
    expect(within(picker()).getAllByRole('option').map((option) => option.textContent)).toEqual(['English', 'Svenska']);
    expect(picker().value).toBe('sv');
  });

  it('reads the path in the language chosen, marks what is not translated, and keeps the interface in its own language', async () => {
    open('/subjects/example-subject');
    await screen.findByRole('heading', { name: 'Grunder' });

    await userEvent.selectOptions(picker(), 'en');

    expect(await screen.findByRole('heading', { name: 'Basics' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Example subject');
    expect(outlinesAsked().at(-1)).toBe('GET /api/v1/content/subjects/example-subject?language=en');
    const area = screen.getByRole('region', { name: 'Basics' });
    expect(within(area).getByText('Enhetsprefix').closest('li')?.textContent).toContain('på svenska');
    expect(within(area).getByText('Energy and power').closest('li')?.textContent).not.toContain('på svenska');
    // The interface stays Swedish.
    expect(screen.getByRole('link', { name: 'Översikt' })).toBeTruthy();
  });

  it('has every module read the subject in the language chosen: the material block asks for the sources in it', async () => {
    window.history.replaceState(null, '', '/subjects/example-subject');
    render(<App modules={[readerModule, lessonsModule]} />);
    await screen.findByRole('heading', { name: 'Grunder' });
    expect(api.requested).toContain('GET /api/v1/reader/subjects/example-subject/sources?language=sv');

    await userEvent.selectOptions(picker(), 'en');

    await screen.findByRole('heading', { name: 'Basics' });
    expect(api.requested).toContain('GET /api/v1/reader/subjects/example-subject/sources?language=en');
  });

  it('is remembered for the subject on the device', async () => {
    const first = open('/subjects/example-subject');
    await screen.findByRole('heading', { name: 'Grunder' });
    await userEvent.selectOptions(picker(), 'en');
    await screen.findByRole('heading', { name: 'Basics' });
    first.unmount();

    api.requested = [];
    open('/subjects/example-subject');

    expect(await screen.findByRole('heading', { name: 'Basics' })).toBeTruthy();
    expect(outlinesAsked()).toEqual(['GET /api/v1/content/subjects/example-subject?language=en']);
    expect(picker().value).toBe('en');
  });

  it('shows the default language, and says so in the picker, for a remembered language the subject no longer offers', async () => {
    window.localStorage.setItem('skill-issue.content-language', JSON.stringify({ 'example-subject': 'de' }));
    open('/subjects/example-subject');

    expect(await screen.findByRole('heading', { name: 'Grunder' })).toBeTruthy();
    expect(picker().value).toBe('sv');
  });

  it('offers no choice for a subject written in one language', async () => {
    api.subjects = [{ ...SUBJECT, languages: ['sv'] }];
    open('/subjects/example-subject');

    await screen.findByRole('heading', { name: 'Grunder' });
    expect(screen.queryByRole('combobox', { name: 'Innehållets språk' })).toBeNull();
  });
});

describe('a lesson check in the subject’s language while the interface is in another', () => {
  it('asks in Swedish under an English interface', async () => {
    window.localStorage.setItem('skill-issue.language', 'en');
    open('/subjects/example-subject/lessons/energi-och-effekt');

    const question = await screen.findByRole('region', { name: 'Effekt anger hur fort energi används.' });
    expect(within(question).getByRole('button', { name: 'Answer' })).toBeTruthy();
    expect(api.requested.some((request) => request.startsWith('GET /api/v1/assessment/subjects/example-subject/questions?ids=effekt-ar-takt&language=sv'))).toBe(true);
  });

  it('asks in English under a Swedish interface, once the subject is read in English', async () => {
    window.localStorage.setItem('skill-issue.content-language', JSON.stringify({ 'example-subject': 'en' }));
    open('/subjects/example-subject/lessons/energi-och-effekt');

    const question = await screen.findByRole('region', { name: 'Power states how fast energy is used.' });
    expect(within(question).getByRole('button', { name: 'Svara' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Energy and power', level: 1 })).toBeTruthy();
  });
});
