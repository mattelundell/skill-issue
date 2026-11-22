import type { AskedQuestion, Due, DueCounts, SubjectOutline, SubjectSummary } from '@skill-issue/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import type { WebModule } from '../../shell/contract.js';
import { catalogueFaults } from '../../shell/messages.js';
import { assessmentModule } from '../assessment/index.js';
import { minutesFor } from './api.js';
import { reviewModule } from './index.js';
import { catalogues } from './messages.js';

const SUBJECT: SubjectSummary = { id: 'example-subject', defaultLanguage: 'sv', languages: ['sv'], title: 'Exempelämne', summary: 'Energi.' };
const OUTLINE: SubjectOutline = {
  ...SUBJECT,
  language: 'sv',
  areas: [{ id: 'grunder', language: 'sv', title: 'Grunder', summary: 'Storheterna.', requires: [], lessons: [{ id: 'energi-och-effekt', language: 'sv', title: 'Energi och effekt', summary: 'kWh och kW.' }] }],
};

const OTHER: SubjectSummary = { id: 'statistik', defaultLanguage: 'sv', languages: ['sv'], title: 'Statistik för mätdata', summary: 'Medelvärden.' };
const OTHER_OUTLINE: SubjectOutline = {
  ...OTHER,
  language: 'sv',
  areas: [{ id: 'lagesmatt', language: 'sv', title: 'Lägesmått', summary: 'Medelvärde och median.', requires: [], lessons: [{ id: 'medelvarde', language: 'sv', title: 'Medelvärde', summary: 'Summan delad med antalet.' }] }],
};
const OTHER_QUESTIONS: readonly AskedQuestion[] = [{ language: 'sv', id: 'medel-ar-kvot', prompt: 'Medelvärdet är summan delad med antalet.', type: 'true-false' }];

const QUESTIONS: readonly AskedQuestion[] = [
  { language: 'sv', id: 'effekt-ar-takt', prompt: 'Effekt är en takt.', type: 'true-false' },
  { language: 'sv', id: 'berakna-energi', prompt: '2 kW i 3 timmar?', type: 'numeric', unit: 'kWh' },
];
const RIGHT: Readonly<Record<string, unknown>> = {
  'effekt-ar-takt': { type: 'true-false', value: true },
  'berakna-energi': { type: 'numeric', value: 6 },
  'medel-ar-kvot': { type: 'true-false', value: true },
};
const EXPECTED: Readonly<Record<string, unknown>> = {
  'effekt-ar-takt': { type: 'true-false', value: true },
  'berakna-energi': { type: 'numeric', value: 6, unit: 'kWh', tolerance: 0 },
  'medel-ar-kvot': { type: 'true-false', value: true },
};

/** Today and tomorrow in the time zone the tests run in, as the page reckons them. */
const dayAfter = (days: number): string => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86_400_000));

interface FakeApi {
  due: Due;
  /** What every subject has due, as the start screen's line and the session across subjects read it. */
  everywhere: DueCounts;
  subjects: SubjectSummary[];
  readonly posted: { readonly path: string; readonly body: unknown }[];
  readonly requested: string[];
}

let api: FakeApi;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  api = {
    due: { subjectId: 'example-subject', questions: [], scheduled: 0, next: null, typicalAnswerMs: null },
    everywhere: { subjects: {}, questions: [] },
    subjects: [SUBJECT],
    posted: [],
    requested: [],
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    const path = url.pathname;
    api.requested.push(`${path}${url.search}`);
    if (init?.method === 'POST') {
      const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
      api.posted.push({ path, body });
      const questionId = /\/questions\/([^/]+)\/answers$/.exec(path)?.[1] ?? '';
      const given = (body as { answer: unknown }).answer;
      const correct = JSON.stringify(given) === JSON.stringify(RIGHT[questionId]);
      return json({ questionId, correct, expected: EXPECTED[questionId], explanation: 'Därför.', sources: [] });
    }
    if (path === '/api/v1/health') {
      return json({ status: 'ok', version: 'test', database: 'up', modules: ['content', 'assessment', 'review'] });
    }
    if (path === '/api/v1/content/subjects') {
      return json(api.subjects);
    }
    if (path === '/api/v1/content/subjects/example-subject') {
      return json(OUTLINE);
    }
    if (path === '/api/v1/content/subjects/statistik') {
      return json(OTHER_OUTLINE);
    }
    if (path === '/api/v1/review/subjects/example-subject/due') {
      return json(api.due);
    }
    if (path === '/api/v1/review/due') {
      return json(api.everywhere);
    }
    if (path === '/api/v1/assessment/subjects/example-subject/questions') {
      const ids = (url.searchParams.get('ids') ?? '').split(',');
      return json({ subjectId: 'example-subject', questions: QUESTIONS.filter((question) => ids.includes(question.id)) });
    }
    if (path === '/api/v1/assessment/subjects/statistik/questions') {
      const ids = (url.searchParams.get('ids') ?? '').split(',');
      return json({ subjectId: 'statistik', questions: OTHER_QUESTIONS.filter((question) => ids.includes(question.id)) });
    }
    if (path === '/api/v1/assessment/subjects/example-subject/passed') {
      return json({ subjectId: 'example-subject', lessons: [], areas: [] });
    }
    return json({ title: 'Not found', status: 404 }, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function open(path: string, modules: readonly WebModule[] = [assessmentModule, reviewModule]): void {
  window.history.replaceState(null, '', path);
  render(<App modules={modules} />);
}

const answersPosted = () =>
  api.posted
    .filter(({ path }) => path.endsWith('/answers'))
    .map(({ path, body }) => {
      const { answer, setting } = body as { answer: unknown; setting: unknown };
      return { question: /questions\/([^/]+)/.exec(path)?.[1], answer, setting };
    });

/** Which subject each answer was sent to, in order. */
const subjectsAnswered = () => api.posted.filter(({ path }) => path.endsWith('/answers')).map(({ path }) => /assessment\/subjects\/([^/]+)/.exec(path)?.[1]);

async function answerTrueFalseTo(prompt: string, value: 'Sant' | 'Falskt'): Promise<void> {
  const question = await screen.findByRole('region', { name: prompt });
  await userEvent.click(within(question).getByRole('radio', { name: new RegExp(value) }));
  await userEvent.click(within(question).getByRole('button', { name: 'Svara' }));
  await within(question).findByRole('status');
}

async function answerTrueFalse(value: 'Sant' | 'Falskt'): Promise<void> {
  const question = await screen.findByRole('region', { name: 'Effekt är en takt.' });
  await userEvent.click(within(question).getByRole('radio', { name: new RegExp(value) }));
  await userEvent.click(within(question).getByRole('button', { name: 'Svara' }));
  await within(question).findByRole('status');
}

async function answerNumeric(value: string): Promise<void> {
  const question = await screen.findByRole('region', { name: '2 kW i 3 timmar?' });
  await userEvent.type(within(question).getByRole('textbox'), value);
  await userEvent.click(within(question).getByRole('button', { name: 'Svara' }));
  await within(question).findByRole('status');
}

describe('the time a review takes', () => {
  it('is the questions at the learner’s pace, in whole minutes and at least one, and unsaid before there is a pace', () => {
    expect(minutesFor(14, 25_000)).toBe(6);
    expect(minutesFor(2, 20_000)).toBe(1);
    expect(minutesFor(3, null)).toBeUndefined();
    expect(minutesFor(0, 20_000)).toBeUndefined();
  });
});

describe('the review session', () => {
  it('asks what was due one question at a time, sends each as a review, asks a wrong one again, and ends when all are right', async () => {
    api.due = { subjectId: 'example-subject', questions: ['effekt-ar-takt', 'berakna-energi'], scheduled: 5, next: null, typicalAnswerMs: 20_000 };
    open('/subjects/example-subject/review');

    expect(await screen.findByText('2 frågor kvar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nästa fråga' })).toHaveProperty('disabled', true);
    await answerTrueFalse('Falskt');
    expect(screen.getByText('Frågan kommer tillbaka senare i passet.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Nästa fråga' }));

    // The wrong one went behind the one left.
    expect(screen.getByText('2 frågor kvar')).toBeTruthy();
    await answerNumeric('6');
    await userEvent.click(screen.getByRole('button', { name: 'Nästa fråga' }));

    expect(screen.getByText('1 fråga kvar')).toBeTruthy();
    // Asked afresh: no answer is carried over from its first asking.
    expect(within(screen.getByRole('region', { name: 'Effekt är en takt.' })).getByRole('button', { name: 'Svara' })).toBeTruthy();
    await answerTrueFalse('Sant');
    await userEvent.click(screen.getByRole('button', { name: 'Avsluta' }));

    expect(screen.getByRole('heading', { name: 'Klart för i dag' })).toBeTruthy();
    expect(screen.getByText('Du har repeterat 2 frågor.')).toBeTruthy();
    expect(answersPosted()).toEqual([
      { question: 'effekt-ar-takt', answer: { type: 'true-false', value: false }, setting: 'review' },
      { question: 'berakna-energi', answer: { type: 'numeric', value: 6 }, setting: 'review' },
      { question: 'effekt-ar-takt', answer: { type: 'true-false', value: true }, setting: 'review' },
    ]);
    // Today is the learner's own day, so the page says where the learner is.
    expect(api.requested.filter((request) => request.startsWith('/api/v1/review/subjects/example-subject/due'))[0]).toBe('/api/v1/review/subjects/example-subject/due?timeZone=Europe%2FStockholm');
  });

  it('says there is nothing to review, and when the next review is', async () => {
    api.due = { subjectId: 'example-subject', questions: [], scheduled: 4, next: { day: dayAfter(1), questions: 3 }, typicalAnswerMs: 20_000 };
    open('/subjects/example-subject/review');

    expect(await screen.findByRole('heading', { name: 'Inget att repetera i dag' })).toBeTruthy();
    expect(screen.getByText('Nästa repetition i morgon, 3 frågor.')).toBeTruthy();
  });

  it('without the module that asks questions, says where they would be asked', async () => {
    api.due = { subjectId: 'example-subject', questions: ['effekt-ar-takt'], scheduled: 1, next: null, typicalAnswerMs: null };
    open('/subjects/example-subject/review', [reviewModule]);

    expect(await screen.findByText('Här ställs frågorna när modulen för bedömning finns.')).toBeTruthy();
  });
});

describe('on the subject home', () => {
  it('says how many questions are due and about how long they take, and leads into the session', async () => {
    api.due = { subjectId: 'example-subject', questions: ['effekt-ar-takt', 'berakna-energi', 'kwh-eller-kw'], scheduled: 9, next: null, typicalAnswerMs: 25_000 };
    open('/subjects/example-subject');

    const block = await screen.findByRole('heading', { name: '3 frågor att repetera i dag' });
    const sheet = block.closest('.sheet');
    expect(sheet?.textContent).toContain('Ungefär en minut.');
    expect(within(sheet as HTMLElement).getByRole('link', { name: 'Repetera nu' }).getAttribute('href')).toBe('/subjects/example-subject/review');
    expect(screen.getByRole('link', { name: 'Repetition' }).getAttribute('href')).toBe('/subjects/example-subject/review');
  });

  it('with nothing due says so and names the next day, by date when it is not tomorrow', async () => {
    api.due = { subjectId: 'example-subject', questions: [], scheduled: 2, next: { day: '2031-03-04', questions: 2 }, typicalAnswerMs: 25_000 };
    open('/subjects/example-subject');

    expect(await screen.findByRole('heading', { name: 'Inget att repetera i dag' })).toBeTruthy();
    expect(screen.getByText('Nästa repetition tisdag 4 mars.')).toBeTruthy();
  });

  it('says nothing before a question has been met', async () => {
    open('/subjects/example-subject');

    await screen.findByRole('heading', { name: 'Grunder' });
    await vi.waitFor(() => expect(api.requested.some((request) => request.startsWith('/api/v1/review/subjects/example-subject/due'))).toBe(true));
    expect(screen.queryByText(/att repetera/)).toBeNull();
  });

  it('is gone with the module: no block, no tab', async () => {
    api.due = { subjectId: 'example-subject', questions: ['effekt-ar-takt'], scheduled: 1, next: null, typicalAnswerMs: 25_000 };
    open('/subjects/example-subject', [assessmentModule]);

    await screen.findByRole('heading', { name: 'Grunder' });
    expect(screen.queryByText(/att repetera/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Repetition' })).toBeNull();
    expect(api.requested.some((request) => request.startsWith('/api/v1/review'))).toBe(false);
  });
});

describe('on the start screen', () => {
  it('gives each subject how many questions are due and about how long they take', async () => {
    api.due = { subjectId: 'example-subject', questions: ['effekt-ar-takt', 'berakna-energi', 'kwh-eller-kw'], scheduled: 9, next: null, typicalAnswerMs: 40_000 };
    open('/');

    const figure = await screen.findByText('3 att repetera');
    expect(figure.closest('.review-figure')?.textContent).toBe('3 att repetera, ca 2 min');
  });

  it('says nothing is due today once questions have been met and none is due', async () => {
    api.due = { subjectId: 'example-subject', questions: [], scheduled: 3, next: null, typicalAnswerMs: 40_000 };
    open('/');

    expect(await screen.findByText('Inget att repetera i dag')).toBeTruthy();
  });
});

describe('across every subject', () => {
  beforeEach(() => {
    api.subjects = [SUBJECT, OTHER];
  });

  it('says on the start screen how many questions are due in all subjects and about how long they take, and leads into one session', async () => {
    api.everywhere = {
      // 2 × 20 s + 3 × 40 s = 160 s: about three minutes.
      subjects: { 'example-subject': { due: 2, typicalAnswerMs: 20_000 }, statistik: { due: 3, typicalAnswerMs: 40_000 } },
      questions: [],
    };
    open('/');

    const line = await screen.findByText(/att repetera i 2 ämnen/);
    expect(line.textContent).toBe('5 frågor att repetera i 2 ämnen, ca 3 min. Repetera allt');
    expect(within(line).getByRole('link', { name: 'Repetera allt' }).getAttribute('href')).toBe('/review');
  });

  it('names the subject when only one has questions due, so an installation with one subject still sees its figure', async () => {
    api.everywhere = {
      subjects: { 'example-subject': { due: 0, typicalAnswerMs: 20_000 }, statistik: { due: 1, typicalAnswerMs: 30_000 } },
      questions: [],
    };
    open('/');

    const line = await screen.findByText(/att repetera i Statistik/);
    expect(line.textContent).toBe('1 fråga att repetera i Statistik för mätdata, ca 1 min. Repetera nu');
    expect(within(line).getByRole('link', { name: 'Repetera nu' }).getAttribute('href')).toBe('/review');
  });

  it('leaves the minutes out while a subject with questions due has no pace to go by', async () => {
    api.everywhere = { subjects: { 'example-subject': { due: 2, typicalAnswerMs: 20_000 }, statistik: { due: 1, typicalAnswerMs: null } }, questions: [] };
    open('/');

    expect((await screen.findByText(/att repetera i 2 ämnen/)).textContent).toBe('3 frågor att repetera i 2 ämnen. Repetera allt');
  });

  it('says nothing on the start screen when nothing is due anywhere', async () => {
    api.everywhere = { subjects: { 'example-subject': { due: 0, typicalAnswerMs: 20_000 } }, questions: [] };
    open('/');

    await screen.findByRole('link', { name: 'Exempelämne' });
    await vi.waitFor(() => expect(api.requested.some((request) => request.startsWith('/api/v1/review/due'))).toBe(true));
    expect(screen.queryByText(/att repetera i/)).toBeNull();
  });

  it('asks the questions due in every subject in one session, each sent to its own subject as a review, a wrong one asked again', async () => {
    api.everywhere = {
      subjects: { 'example-subject': { due: 1, typicalAnswerMs: 20_000 }, statistik: { due: 1, typicalAnswerMs: 20_000 } },
      questions: [
        { subjectId: 'statistik', questionId: 'medel-ar-kvot' },
        { subjectId: 'example-subject', questionId: 'effekt-ar-takt' },
      ],
    };
    open('/review');

    expect(await screen.findByText('2 frågor kvar')).toBeTruthy();
    // Each question says which subject it comes from.
    expect(screen.getByText('Repetition · Statistik för mätdata')).toBeTruthy();
    await answerTrueFalseTo('Medelvärdet är summan delad med antalet.', 'Falskt');
    await userEvent.click(screen.getByRole('button', { name: 'Nästa fråga' }));

    expect(screen.getByText('Repetition · Exempelämne')).toBeTruthy();
    await answerTrueFalseTo('Effekt är en takt.', 'Sant');
    await userEvent.click(screen.getByRole('button', { name: 'Nästa fråga' }));

    expect(screen.getByText('1 fråga kvar')).toBeTruthy();
    await answerTrueFalseTo('Medelvärdet är summan delad med antalet.', 'Sant');
    await userEvent.click(screen.getByRole('button', { name: 'Avsluta' }));

    expect(screen.getByRole('heading', { name: 'Klart för i dag' })).toBeTruthy();
    expect(screen.getByText('Du har repeterat 2 frågor.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Till dina ämnen' }).getAttribute('href')).toBe('/');
    expect(answersPosted()).toEqual([
      { question: 'medel-ar-kvot', answer: { type: 'true-false', value: false }, setting: 'review' },
      { question: 'effekt-ar-takt', answer: { type: 'true-false', value: true }, setting: 'review' },
      { question: 'medel-ar-kvot', answer: { type: 'true-false', value: true }, setting: 'review' },
    ]);
    expect(subjectsAnswered()).toEqual(['statistik', 'example-subject', 'statistik']);
    expect(api.requested.filter((request) => request.startsWith('/api/v1/review/due'))[0]).toBe('/api/v1/review/due?timeZone=Europe%2FStockholm');
  });

  it('reads each subject in the language the learner chose for it, so its questions are asked in that language', async () => {
    window.localStorage.setItem('skill-issue.content-language', JSON.stringify({ statistik: 'en' }));
    api.everywhere = {
      subjects: { 'example-subject': { due: 1, typicalAnswerMs: 20_000 }, statistik: { due: 1, typicalAnswerMs: 20_000 } },
      questions: [
        { subjectId: 'statistik', questionId: 'medel-ar-kvot' },
        { subjectId: 'example-subject', questionId: 'effekt-ar-takt' },
      ],
    };
    try {
      open('/review');

      expect(await screen.findByText('2 frågor kvar')).toBeTruthy();
      expect(api.requested).toContain('/api/v1/content/subjects/statistik?language=en');
      expect(api.requested).toContain('/api/v1/content/subjects/example-subject');
    } finally {
      window.localStorage.removeItem('skill-issue.content-language');
    }
  });

  it('with nothing due anywhere says so and leads back to the subjects', async () => {
    open('/review');

    expect(await screen.findByRole('heading', { name: 'Inget att repetera i dag' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Till dina ämnen' }).getAttribute('href')).toBe('/');
  });

  it('is gone with the module: no line on the start screen, and the session’s address names nothing', async () => {
    api.everywhere = { subjects: { statistik: { due: 3, typicalAnswerMs: 20_000 } }, questions: [{ subjectId: 'statistik', questionId: 'medel-ar-kvot' }] };
    open('/', [assessmentModule]);

    await screen.findByRole('link', { name: 'Exempelämne' });
    expect(screen.queryByText(/att repetera/)).toBeNull();
    expect(api.requested.some((request) => request.startsWith('/api/v1/review'))).toBe(false);
  });

  it('without the module, the address of the session across subjects is not found', async () => {
    open('/review', [assessmentModule]);

    expect(await screen.findByRole('heading', { name: 'Sidan finns inte' })).toBeTruthy();
    expect(api.requested.some((request) => request.startsWith('/api/v1/review'))).toBe(false);
  });
});

describe('the messages', () => {
  it('has every message in both languages, with the same placeholders', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
  });
});
