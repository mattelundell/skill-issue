import type { LessonPosition, LessonView, Resume, SubjectOutline, SubjectSummary } from '@skill-issue/contract';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import type { WebModule } from '../../shell/contract.js';
import { catalogueFaults } from '../../shell/messages.js';
import { lessonsModule } from './index.js';
import { catalogues } from './messages.js';
import { marksFrom, suggestionFor } from './progress.js';

const SUBJECT: SubjectSummary = { id: 'example-subject', defaultLanguage: 'sv', languages: ['sv'], title: 'Exempelämne', summary: 'Energi och effekt.' };
const OTHER: SubjectSummary = { id: 'statistik', defaultLanguage: 'sv', languages: ['sv'], title: 'Statistik för mätdata', summary: 'Medelvärden.' };

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
  ],
};

const view = (resumeAt: number, extra: Partial<LessonView> = {}): LessonView => ({
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
      { type: 'example', body: 'En värmefläkt på 2 kW i 3 timmar.\n\n![Energiflöde](assets/energiflode.png "Ett dygn")' },
      { type: 'check', questions: ['kwh-eller-kw', 'berakna-energi'] },
    ],
    sources: [{ id: 'exempelkalla', title: 'Exempelkälla', publisher: 'Exempelförlaget' }],
  },
  position: resumeAt === 0 ? null : { step: resumeAt, steps: 3, revision: 1, startedAt: '2026-11-20T10:00:00Z', updatedAt: '2026-11-20T10:05:00Z', finishedAt: null },
  resumeAt,
  changedSince: false,
  ...extra,
});

const at = (step: number, updatedAt: string, finishedAt: string | null = null): LessonPosition => ({ step, steps: 3, revision: 1, startedAt: '2026-11-20T10:00:00Z', updatedAt, finishedAt });

interface FakeApi {
  views: LessonView[];
  positions: Record<string, LessonPosition>;
  resume: Resume;
  /** Status of each coming save, in order; 200 once they run out. */
  saveAnswers: number[];
  readonly saved: { readonly path: string; readonly body: unknown }[];
  readonly requested: string[];
}

let api: FakeApi;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  api = { views: [view(0)], positions: {}, resume: { offer: null, started: [] }, saveAnswers: [], saved: [], requested: [] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    const path = url.pathname;
    api.requested.push(`${path}${url.search}`);
    if (init?.method === 'PUT') {
      api.saved.push({ path, body: JSON.parse(typeof init.body === 'string' ? init.body : '') });
      const status = api.saveAnswers.shift() ?? 200;
      return status === 200 ? json(at(0, '2026-11-21T10:00:00Z')) : json({ type: 'about:blank', title: 'The lesson has changed', status }, status);
    }
    if (path === '/api/v1/health') {
      return json({ status: 'ok', version: 'test', database: 'up', modules: ['content', 'lessons'] });
    }
    if (path === '/api/v1/content/subjects') {
      return json([SUBJECT, OTHER]);
    }
    if (path === '/api/v1/content/subjects/example-subject') {
      return json(OUTLINE);
    }
    if (path === '/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt') {
      return json(api.views.length > 1 ? api.views.shift() : api.views[0]);
    }
    if (path === '/api/v1/lessons/subjects/example-subject/positions') {
      return json({ subjectId: 'example-subject', lessons: api.positions });
    }
    if (path === '/api/v1/lessons/resume') {
      return json(api.resume);
    }
    return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function open(path: string, modules: readonly WebModule[] = [lessonsModule]): void {
  window.history.replaceState(null, '', path);
  render(<App modules={modules} />);
}

/** Where the app keeps the interface language between visits. */
const LANGUAGE_KEY = 'skill-issue.language';
const LESSON_PAGE = '/subjects/example-subject/lessons/energi-och-effekt';
const POSITION = '/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt/position';
const continueButton = (): HTMLElement => screen.getByRole('button', { name: /^(Fortsätt|Avsluta lektionen)$/ });

describe('a lesson', () => {
  it('opens at its first step, records it as begun, and goes on step by step, saving each', async () => {
    open(LESSON_PAGE);

    expect(await screen.findByText('Effekt')).toBeTruthy();
    expect(screen.getByText('Steg 1 av 3')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
    await vi.waitFor(() => expect(api.saved).toEqual([{ path: POSITION, body: { step: 0, revision: 1, timeZone: 'Europe/Stockholm' } }]));

    await userEvent.click(continueButton());

    expect(screen.getByText('Steg 2 av 3')).toBeTruthy();
    expect(screen.getByText('Exempel')).toBeTruthy();
    await vi.waitFor(() => expect(api.saved.at(-1)).toEqual({ path: POSITION, body: { step: 1, revision: 1, timeZone: 'Europe/Stockholm' } }));
  });

  it('opens a lesson left midway at that step and says so once', async () => {
    api.views = [view(1)];
    open(LESSON_PAGE);

    expect(await screen.findByRole('note')).toHaveProperty('textContent', 'Välkommen tillbaka. Du fortsätter där du slutade, på steg 2 av 3.Börja från början');
    expect(screen.getByText('Steg 2 av 3')).toBeTruthy();

    await userEvent.click(continueButton());

    expect(screen.queryByRole('note')).toBeNull();
  });

  it('goes back to a step already passed from the bar, and to the first from the welcome', async () => {
    api.views = [view(2)];
    open(LESSON_PAGE);
    const bar = await screen.findByRole('list', { name: 'Lektionens steg' });

    await userEvent.click(within(bar).getByRole('button', { name: 'Gå tillbaka till steg 2' }));
    expect(screen.getByText('Steg 2 av 3')).toBeTruthy();

    await userEvent.click(within(bar).getByRole('button', { name: 'Gå tillbaka till steg 1' }));
    expect(screen.getByText('Steg 1 av 3')).toBeTruthy();
    await vi.waitFor(() => expect(api.saved.at(-1)).toEqual({ path: POSITION, body: { step: 0, revision: 1, timeZone: 'Europe/Stockholm' } }));
  });

  it('draws an example’s image from the subject’s files', async () => {
    api.views = [view(1)];
    open(LESSON_PAGE);

    const image = await screen.findByRole('img', { name: 'Energiflöde' });
    expect(image.getAttribute('src')).toBe('/api/v1/content/subjects/example-subject/assets/energiflode.png');
  });

  it('without a module that draws checks, says a check is there and lets the learner on', async () => {
    api.views = [view(2)];
    open(LESSON_PAGE);

    expect(await screen.findByText(/Här finns en kontroll med 2 frågor/)).toBeTruthy();
    expect(continueButton()).toHaveProperty('disabled', false);
  });

  it('with a module that draws checks, holds the learner until it says the questions are answered', async () => {
    api.views = [view(2)];
    let settle: ((done: boolean) => void) | undefined;
    const grading: WebModule = {
      id: 'grading',
      steps: {
        check: ({ questions, onSettled }) => {
          settle = onSettled;
          return <p>Frågor: {questions.join(', ')}</p>;
        },
      },
    };
    open(LESSON_PAGE, [lessonsModule, grading]);

    expect(await screen.findByText('Frågor: kwh-eller-kw, berakna-energi')).toBeTruthy();
    expect(continueButton()).toHaveProperty('disabled', true);

    act(() => settle?.(true));

    expect(continueButton()).toHaveProperty('disabled', false);
  });

  it('asks a question answered wrong again after the last step, before the end', async () => {
    api.views = [view(2)];
    const answered: { onAnswered?: (id: string, correct: boolean) => void; onSettled?: (done: boolean) => void; asked: string[][] } = { asked: [] };
    const grading: WebModule = {
      id: 'grading',
      steps: {
        check: ({ questions, onSettled, onAnswered }) => {
          answered.onAnswered = onAnswered;
          answered.onSettled = onSettled;
          answered.asked.push([...questions]);
          return <p>Frågor: {questions.join(', ')}</p>;
        },
      },
    };
    open(LESSON_PAGE, [lessonsModule, grading]);
    expect(await screen.findByText('Frågor: kwh-eller-kw, berakna-energi')).toBeTruthy();

    act(() => {
      answered.onAnswered?.('kwh-eller-kw', false);
      // Wrong, then right on a second try within the same check: not asked again.
      answered.onAnswered?.('berakna-energi', false);
      answered.onAnswered?.('berakna-energi', true);
      answered.onSettled?.(true);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Avsluta lektionen' }));

    expect(screen.getByText('Igen')).toBeTruthy();
    expect(screen.getByText('Frågor: kwh-eller-kw')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Lektionen är genomgången' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Avsluta lektionen' })).toHaveProperty('disabled', true);

    act(() => {
      answered.onAnswered?.('kwh-eller-kw', true);
      answered.onSettled?.(true);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Avsluta lektionen' }));

    expect(screen.getByRole('heading', { name: 'Lektionen är genomgången' })).toBeTruthy();
    await vi.waitFor(() => expect(api.saved.at(-1)).toEqual({ path: POSITION, body: { step: 3, revision: 1, timeZone: 'Europe/Stockholm' } }));
  });

  it('goes straight to the end when every question was answered right', async () => {
    api.views = [view(2)];
    let settle: { onAnswered?: (id: string, correct: boolean) => void; onSettled?: (done: boolean) => void } = {};
    const grading: WebModule = { id: 'grading', steps: { check: ({ onSettled, onAnswered }) => ((settle = { onSettled, onAnswered }), <p>Frågor</p>) } };
    open(LESSON_PAGE, [lessonsModule, grading]);
    await screen.findByText('Frågor');

    act(() => {
      settle.onAnswered?.('kwh-eller-kw', true);
      settle.onSettled?.(true);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Avsluta lektionen' }));

    expect(screen.getByRole('heading', { name: 'Lektionen är genomgången' })).toBeTruthy();
  });

  it('puts what other modules give at the lesson’s end', async () => {
    api.views = [view(2)];
    const offering: WebModule = { id: 'offering', LessonEnd: ({ lessonId }) => <p>Provet för {lessonId}</p> };
    open(LESSON_PAGE, [lessonsModule, offering]);
    await screen.findByText(/Här finns en kontroll/);

    await userEvent.click(screen.getByRole('button', { name: 'Avsluta lektionen' }));

    expect(screen.getByText('Provet för energi-och-effekt')).toBeTruthy();
  });

  it('after the last step reaches its end, saved as gone through, and offers the next lesson on the path', async () => {
    api.views = [view(2)];
    open(LESSON_PAGE);
    await screen.findByText(/Här finns en kontroll/);

    await userEvent.click(screen.getByRole('button', { name: 'Avsluta lektionen' }));

    expect(screen.getByRole('heading', { name: 'Lektionen är genomgången' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Nästa lektion: Enhetsprefix' }).getAttribute('href')).toBe('/subjects/example-subject/lessons/enhetsprefix');
    await vi.waitFor(() => expect(api.saved.at(-1)).toEqual({ path: POSITION, body: { step: 3, revision: 1, timeZone: 'Europe/Stockholm' } }));
  });

  it('goes on with Enter', async () => {
    open(LESSON_PAGE);
    await screen.findByText('Steg 1 av 3');

    await userEvent.keyboard('{Enter}');

    expect(screen.getByText('Steg 2 av 3')).toBeTruthy();
  });

  it('when the subject changed underneath, fetches the lesson again and says it changed', async () => {
    api.views = [view(0), view(1, { lesson: { ...view(0).lesson, revision: 2 }, changedSince: true })];
    api.saveAnswers = [409];
    open(LESSON_PAGE);

    await vi.waitFor(() => expect(screen.getByRole('note').textContent).toContain('Lektionen har ändrats sedan du var här. Du fortsätter på steg 2'));
    expect(api.requested.filter((path) => path.startsWith('/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt?'))).toHaveLength(2);
    await vi.waitFor(() => expect(api.saved.map(({ body }) => body)).toEqual([{ step: 0, revision: 1, timeZone: 'Europe/Stockholm' }, { step: 1, revision: 2, timeZone: 'Europe/Stockholm' }]));
  });

  it('when the server keeps refusing a save as stale, fetches the lesson again only once and says the save failed', async () => {
    api.views = [view(0)];
    api.saveAnswers = [409, 409, 409, 409];
    open(LESSON_PAGE);

    expect((await screen.findByText(/kunde inte sparas/)).textContent).toBe('Var du är i lektionen kunde inte sparas. Du kan fortsätta; det sparas när servern svarar igen.');
    expect(api.requested.filter((path) => path.startsWith('/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt?'))).toHaveLength(2);
  });

  it('names its sources, linked when a module shows sources', async () => {
    const showing: WebModule = { id: 'showing', sourceLink: (subjectId, sourceId) => `/subjects/${subjectId}/showing/${sourceId}` };
    open(LESSON_PAGE, [lessonsModule, showing]);

    const link = await screen.findByRole('link', { name: 'Exempelkälla (Exempelförlaget)' });
    expect(link.getAttribute('href')).toBe('/subjects/example-subject/showing/exempelkalla');
  });

  it('names its sources without links when no module shows sources', async () => {
    open(LESSON_PAGE);

    expect((await screen.findByText(/Lektionen bygger på/)).textContent).toBe('Lektionen bygger på Exempelkälla (Exempelförlaget).');
    expect(screen.queryByRole('link', { name: /Exempelkälla/ })).toBeNull();
  });

  it('asks for the lesson in the language the subject is shown in, not the interface’s, and speaks the interface’s', async () => {
    window.localStorage.setItem(LANGUAGE_KEY, 'en');
    open(LESSON_PAGE);

    expect(await screen.findByText('Step 1 of 3')).toBeTruthy();
    expect(api.requested).toContain('/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt?language=sv');
    expect(api.requested.filter((path) => path.includes('language=en'))).toEqual([]);
  });

  it('answers an address naming no lesson with “no such lesson”', async () => {
    open('/subjects/example-subject/lessons/finns-inte');

    expect(await screen.findByRole('heading', { name: 'Lektionen finns inte' })).toBeTruthy();
  });
});

describe('the start screen with lessons', () => {
  it('offers to continue the lesson left midway, and lists the other subjects compact under their heading', async () => {
    api.resume = {
      offer: { kind: 'continue', subjectId: 'example-subject', lessonId: 'energi-och-effekt', language: 'sv', title: 'Energi och effekt', areaTitle: 'Grunder', step: 1, steps: 3 },
      started: ['example-subject'],
    };
    open('/');

    const panel = await screen.findByRole('region', { name: 'Exempelämne' });
    expect(within(panel).getByText('Fortsätt där du slutade')).toBeTruthy();
    expect(within(panel).getByText('Grunder: Energi och effekt, steg 2 av 3')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Fortsätt' }).getAttribute('href')).toBe(LESSON_PAGE);
    const others = await screen.findByRole('region', { name: 'Dina andra ämnen' });
    expect(within(others).getAllByRole('link').map((link) => link.textContent)).toEqual(['Statistik för mätdata', 'Börja']);
  });

  it('after the last lesson was gone through, offers the next one', async () => {
    api.resume = { offer: { kind: 'next', subjectId: 'example-subject', lessonId: 'enhetsprefix', language: 'sv', title: 'Enhetsprefix', areaTitle: 'Grunder' }, started: ['example-subject'] };
    open('/');

    const panel = await screen.findByRole('region', { name: 'Exempelämne' });
    expect(within(panel).getByText('Nästa lektion')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Börja' }).getAttribute('href')).toBe('/subjects/example-subject/lessons/enhetsprefix');
  });

  it('with nothing begun shows no panel, and every subject at full size to begin', async () => {
    open('/');

    await vi.waitFor(() => expect(screen.getAllByRole('link', { name: /^Börja: / }).map((link) => link.getAttribute('aria-label'))).toEqual(['Börja: Exempelämne', 'Börja: Statistik för mätdata']));
    expect(screen.queryByRole('region', { name: 'Dina andra ämnen' })).toBeNull();
  });
});

describe('the subject home with lessons', () => {
  it('marks each lesson begun with where it stands, links every lesson, and suggests where to carry on', async () => {
    api.positions = { 'energi-och-effekt': at(1, '2026-11-21T09:00:00Z') };
    open('/subjects/example-subject');

    const area = await screen.findByRole('region', { name: 'Grunder' });
    await vi.waitFor(() => expect(within(area).getByText('Pågår, steg 2 av 3')).toBeTruthy());
    expect(within(area).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([LESSON_PAGE, '/subjects/example-subject/lessons/enhetsprefix']);
    expect(await screen.findByRole('heading', { name: 'Fortsätt: Energi och effekt' })).toBeTruthy();
    expect(screen.getByText('Grunder, steg 2 av 3.')).toBeTruthy();
  });

  it('before anything is begun suggests the first lesson', async () => {
    open('/subjects/example-subject');

    expect(await screen.findByRole('heading', { name: 'Börja med Energi och effekt' })).toBeTruthy();
  });
});

describe('what lessons say about a lesson', () => {
  it('says “in progress” with the step for one left midway, “all steps gone through” for one finished, and marks the latest as where the learner stopped', () => {
    const marks = marksFrom({ 'energi-och-effekt': at(3, '2026-11-21T08:00:00Z', '2026-11-21T08:00:00Z'), enhetsprefix: at(1, '2026-11-21T09:00:00Z') }, 'sv');

    expect(Object.fromEntries(marks)).toEqual({
      'energi-och-effekt': { state: 'in-progress', detail: 'alla steg genomgångna' },
      enhetsprefix: { state: 'in-progress', detail: 'steg 2 av 3', here: true },
    });
  });

  it('speaks the interface language', () => {
    expect(marksFrom({ enhetsprefix: at(1, '2026-11-21T09:00:00Z') }, 'en').get('enhetsprefix')?.detail).toBe('step 2 of 3');
  });

  it('suggests the lesson left midway first, then the first one on the path not gone through', () => {
    expect(suggestionFor(OUTLINE, { enhetsprefix: at(1, '2026-11-21T09:00:00Z') })).toMatchObject({ kind: 'continue', lesson: { id: 'enhetsprefix' }, step: 2 });
    expect(suggestionFor(OUTLINE, { 'energi-och-effekt': at(3, '2026-11-21T09:00:00Z', '2026-11-21T09:00:00Z') })).toMatchObject({ kind: 'next', lesson: { id: 'enhetsprefix' } });
    expect(
      suggestionFor(OUTLINE, { 'energi-och-effekt': at(3, '2026-11-21T09:00:00Z', '2026-11-21T09:00:00Z'), enhetsprefix: at(3, '2026-11-21T10:00:00Z', '2026-11-21T10:00:00Z') }),
    ).toBeUndefined();
  });
});

describe('the lessons module’s text', () => {
  it('has every message in both languages, with the same placeholders', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
  });
});
