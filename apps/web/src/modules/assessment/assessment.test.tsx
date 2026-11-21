import type { AskedQuestion, ExamResult, Graded, LessonView, Sitting, SubjectOutline, SubjectSummary } from '@skill-issue/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { catalogueFaults } from '../../shell/messages.js';
import { lessonsModule } from '../lessons/index.js';
import { assessmentModule } from './index.js';
import { parseNumber } from './inputs.js';
import { catalogues } from './messages.js';

const SUBJECT: SubjectSummary = { id: 'example-subject', defaultLanguage: 'sv', languages: ['sv'], title: 'Exempelämne', summary: 'Energi.' };
const OUTLINE: SubjectOutline = {
  ...SUBJECT,
  language: 'sv',
  areas: [{ id: 'grunder', language: 'sv', title: 'Grunder', summary: 'Storheterna.', requires: [], lessons: [{ id: 'energi-och-effekt', language: 'sv', title: 'Energi och effekt', summary: 'kWh och kW.' }] }],
};

const base = { language: 'sv' };
/** One question of every type, as the server asks it. */
const ASKED: Readonly<Record<AskedQuestion['type'], AskedQuestion>> = {
  'single-choice': { ...base, id: 'kwh-eller-kw', prompt: 'Vilken enhet anger effekt?', type: 'single-choice', options: [{ id: 'a', text: 'kWh' }, { id: 'b', text: 'kW' }] },
  'multiple-choice': { ...base, id: 'vagar-ut', prompt: 'Vilka vägar?', type: 'multiple-choice', options: [{ id: 'a', text: 'Fönster' }, { id: 'b', text: 'Ventilation' }, { id: 'c', text: 'Elmätaren' }] },
  'true-false': { ...base, id: 'effekt-ar-takt', prompt: 'Effekt är en takt.', type: 'true-false' },
  numeric: { ...base, id: 'berakna-energi', prompt: '2 kW i 3 timmar?', type: 'numeric', unit: 'kWh' },
  'short-text': { ...base, id: 'kilo-betyder', prompt: 'Prefixet för kilo?', type: 'short-text' },
  ordering: { ...base, id: 'prefix-ordning', prompt: 'Ordna.', type: 'ordering', items: ['MWh', 'kWh', 'GWh'] },
  matching: { ...base, id: 'prefix-par', prompt: 'Para ihop.', type: 'matching', lefts: ['mega', 'kilo'], rights: ['tusen', 'miljon'] },
  'free-recall': { ...base, id: 'forklara-balans', prompt: 'Förklara energibalans.', type: 'free-recall', answer: 'Tillförd energi är lika med bortförd.' },
};

const SOURCE = { id: 'exempelkalla', title: 'Exempelkälla', publisher: 'Exempelförlaget' };

const lessonView = (questions: readonly string[]): LessonView => ({
  lesson: {
    subjectId: 'example-subject',
    id: 'energi-och-effekt',
    language: 'sv',
    revision: 1,
    title: 'Energi och effekt',
    summary: 'kWh och kW.',
    area: { id: 'grunder', language: 'sv', title: 'Grunder' },
    steps: [{ type: 'check', questions: [...questions] }],
    sources: [SOURCE],
  },
  position: null,
  resumeAt: 0,
  changedSince: false,
});

interface FakeApi {
  questions: AskedQuestion[];
  graded: (questionId: string, answer: unknown) => Graded;
  sitting: Sitting | undefined;
  result: ExamResult | undefined;
  passed: { lessons: string[]; areas: string[] };
  readonly posted: { readonly path: string; readonly body: unknown }[];
}

let api: FakeApi;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  api = {
    questions: [],
    graded: (questionId) => ({ questionId, correct: true, expected: { type: 'true-false', value: true }, explanation: 'Därför.', sources: [SOURCE] }),
    sitting: undefined,
    result: undefined,
    passed: { lessons: [], areas: [] },
    posted: [],
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    const path = url.pathname;
    if (init?.method === 'POST' || init?.method === 'PUT') {
      const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
      api.posted.push({ path, body });
      if (init.method === 'PUT') {
        return json({ step: 0, steps: 1, revision: 1, startedAt: '2026-11-21T10:00:00Z', updatedAt: '2026-11-21T10:00:00Z', finishedAt: null });
      }
      const answering = /\/questions\/([^/]+)\/answers$/.exec(path);
      if (answering !== null) {
        return json(api.graded(answering[1] ?? '', body));
      }
      if (path.endsWith('/exams')) {
        return api.sitting === undefined ? json({ title: 'down' }, 500) : json(api.sitting, 201);
      }
      return api.result === undefined ? json({ title: 'down' }, 500) : json(api.result);
    }
    if (path === '/api/v1/health') {
      return json({ status: 'ok', version: 'test', database: 'up', modules: ['content', 'lessons', 'assessment'] });
    }
    if (path === '/api/v1/content/subjects') {
      return json([SUBJECT]);
    }
    if (path === '/api/v1/content/subjects/example-subject') {
      return json(OUTLINE);
    }
    if (path === '/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt') {
      return json(lessonView(api.questions.map((question) => question.id)));
    }
    if (path === '/api/v1/lessons/subjects/example-subject/positions') {
      return json({ subjectId: 'example-subject', lessons: {} });
    }
    if (path === '/api/v1/lessons/resume') {
      return json({ offer: null, started: [] });
    }
    if (path === '/api/v1/assessment/subjects/example-subject/questions') {
      const ids = (url.searchParams.get('ids') ?? '').split(',');
      return json({ subjectId: 'example-subject', questions: api.questions.filter((question) => ids.includes(question.id)) });
    }
    if (path === '/api/v1/assessment/subjects/example-subject/passed') {
      return json({ subjectId: 'example-subject', ...api.passed });
    }
    return json({ title: 'Not found', status: 404 }, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string): void {
  window.history.replaceState(null, '', path);
  render(<App modules={[lessonsModule, assessmentModule]} />);
}

const LESSON = '/subjects/example-subject/lessons/energi-och-effekt';
const answersPosted = (): unknown[] => api.posted.filter(({ path }) => path.endsWith('/answers')).map(({ body }) => body);

describe('a check inside a lesson', () => {
  it('asks its question, grades the answer at once, and lets the learner on only then', async () => {
    api.questions = [ASKED['single-choice']];
    api.graded = (questionId) => ({ questionId, correct: false, expected: { type: 'single-choice', option: 'b' }, explanation: 'Effekt mäts i **watt**.', sources: [SOURCE] });
    open(LESSON);

    const question = await screen.findByRole('region', { name: 'Vilken enhet anger effekt?' });
    expect(screen.getByRole('button', { name: 'Avsluta lektionen' })).toHaveProperty('disabled', true);
    await userEvent.click(within(question).getByRole('radio', { name: /kWh/ }));
    await userEvent.click(within(question).getByRole('button', { name: 'Svara' }));

    const feedback = await within(question).findByRole('status');
    expect(feedback.textContent?.replace(/\s*\n\s*/g, '')).toBe('Inte rätt.Rätt svar: kWEffekt mäts i watt.Källa: Exempelkälla (Exempelförlaget)');
    expect(answersPosted()).toEqual([{ answer: { type: 'single-choice', option: 'a' } }]);
    // Locked once graded: the fieldset disables every option in it.
    expect(within(question).getByRole('radio', { name: /kWh/ }).matches(':disabled')).toBe(true);
  });

  it('brings a wrong answer back once, after the last step, and then ends', async () => {
    api.questions = [ASKED['true-false']];
    let right = false;
    api.graded = (questionId) => ({ questionId, correct: right, expected: { type: 'true-false', value: true }, explanation: 'Ja.', sources: [] });
    open(LESSON);

    const first = await screen.findByRole('region', { name: 'Effekt är en takt.' });
    await userEvent.click(within(first).getByRole('radio', { name: /Falskt/ }));
    await userEvent.click(within(first).getByRole('button', { name: 'Svara' }));
    await within(first).findByText('Inte rätt.');
    await userEvent.click(screen.getByRole('button', { name: 'Avsluta lektionen' }));

    expect(screen.getByText('Igen')).toBeTruthy();
    right = true;
    const again = await screen.findByRole('region', { name: 'Effekt är en takt.' });
    await userEvent.click(within(again).getByRole('radio', { name: /Sant/ }));
    await userEvent.click(within(again).getByRole('button', { name: 'Svara' }));
    await within(again).findByText('Rätt.');
    await userEvent.click(screen.getByRole('button', { name: 'Avsluta lektionen' }));

    expect(screen.getByRole('heading', { name: 'Lektionen är genomgången' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Skriv provet nu' }).getAttribute('href')).toBe('/subjects/example-subject/assessment/lesson/energi-och-effekt');
  });
});

/** Opens a lesson whose check asks one question of `type`, lets `act` answer it, and returns the answer sent. */
async function answered(type: AskedQuestion['type'], act: (question: HTMLElement) => Promise<void>): Promise<unknown> {
  api.questions = [ASKED[type]];
  open(LESSON);
  const question = await screen.findByRole('region', { name: ASKED[type].prompt });
  const send = within(question).getByRole('button', { name: 'Svara' });
  // Every input but ordering starts without a whole answer; an ordering's shown order is one.
  expect(send).toHaveProperty('disabled', type !== 'ordering');
  await act(question);
  await userEvent.click(send);
  await vi.waitFor(() => expect(answersPosted()).toHaveLength(1));
  return answersPosted()[0];
}

describe('every question type’s input', () => {
  it('single choice sends the option chosen', async () => {
    expect(await answered('single-choice', async (q) => userEvent.click(within(q).getByRole('radio', { name: /kW$/ })))).toEqual({ answer: { type: 'single-choice', option: 'b' } });
  });

  it('multiple choice sends every option ticked, and not one unticked again', async () => {
    const sent = await answered('multiple-choice', async (q) => {
      await userEvent.click(within(q).getByRole('checkbox', { name: /Fönster/ }));
      await userEvent.click(within(q).getByRole('checkbox', { name: /Elmätaren/ }));
      await userEvent.click(within(q).getByRole('checkbox', { name: /Ventilation/ }));
      await userEvent.click(within(q).getByRole('checkbox', { name: /Elmätaren/ }));
    });
    expect(sent).toEqual({ answer: { type: 'multiple-choice', options: ['a', 'b'] } });
  });

  it('true or false sends the value chosen', async () => {
    expect(await answered('true-false', async (q) => userEvent.click(within(q).getByRole('radio', { name: /Sant/ })))).toEqual({ answer: { type: 'true-false', value: true } });
  });

  it('numeric sends the number typed, with a decimal comma', async () => {
    expect(await answered('numeric', async (q) => userEvent.type(within(q).getByRole('textbox', { name: 'Svar i kWh' }), '6,5'))).toEqual({ answer: { type: 'numeric', value: 6.5 } });
  });

  it('short text sends the words typed', async () => {
    expect(await answered('short-text', async (q) => userEvent.type(within(q).getByRole('textbox', { name: 'Ditt svar' }), 'k'))).toEqual({ answer: { type: 'short-text', text: 'k' } });
  });

  it('ordering sends the order the learner made', async () => {
    const sent = await answered('ordering', async (q) => userEvent.click(within(q).getByRole('button', { name: 'Flytta upp: kWh' })));
    expect(sent).toEqual({ answer: { type: 'ordering', items: ['kWh', 'MWh', 'GWh'] } });
  });

  it('ordering can be answered as shown, since every order is a whole answer', async () => {
    expect(await answered('ordering', async () => undefined)).toEqual({ answer: { type: 'ordering', items: ['MWh', 'kWh', 'GWh'] } });
  });

  it('matching waits for every pair, then sends them', async () => {
    const sent = await answered('matching', async (q) => {
      await userEvent.selectOptions(within(q).getByRole('combobox', { name: 'mega' }), 'miljon');
      expect(within(q).getByRole('button', { name: 'Svara' })).toHaveProperty('disabled', true);
      await userEvent.selectOptions(within(q).getByRole('combobox', { name: 'kilo' }), 'tusen');
    });
    expect(sent).toEqual({ answer: { type: 'matching', pairs: [{ left: 'mega', right: 'miljon' }, { left: 'kilo', right: 'tusen' }] } });
  });

  it('free recall shows the answer on request, and sends whether the learner knew it', async () => {
    const sent = await answered('free-recall', async (q) => {
      expect(within(q).queryByText('Tillförd energi är lika med bortförd.')).toBeNull();
      await userEvent.click(within(q).getByRole('button', { name: 'Visa svaret' }));
      expect(within(q).getByText('Tillförd energi är lika med bortförd.')).toBeTruthy();
      await userEvent.click(within(q).getByRole('radio', { name: 'Jag kunde det inte' }));
    });
    expect(sent).toEqual({ answer: { type: 'free-recall', knew: false } });
  });

  it('reads numbers as a Swede or an Englishman types them, and nothing else', () => {
    expect(['6', '6,5', '6.5', ' 1 000 ', '-2', '6,', 'sex', '6 kWh'].map(parseNumber)).toEqual([6, 6.5, 6.5, 1000, -2, undefined, undefined, undefined]);
  });
});

describe('an exam', () => {
  const sitting: Sitting = {
    id: '3f1c1a52-9c55-4d3f-9a3e-0e6f2a7c1b11',
    subjectId: 'example-subject',
    scope: { kind: 'lesson', id: 'energi-och-effekt' },
    title: 'Energi och effekt',
    passMark: 0.5,
    questions: [ASKED['single-choice'], ASKED['true-false']],
    startedAt: '2026-11-21T10:00:00Z',
  };

  it('asks one question at a time without grading, hands in what was answered, and shows the mark with every answer reviewed', async () => {
    api.sitting = sitting;
    api.result = {
      sittingId: sitting.id,
      scope: sitting.scope,
      title: sitting.title,
      correct: 1,
      total: 2,
      passMark: 0.5,
      passed: true,
      review: [
        { questionId: 'kwh-eller-kw', correct: true, expected: { type: 'single-choice', option: 'b' }, explanation: 'Watt.', sources: [], question: ASKED['single-choice'], given: { type: 'single-choice', option: 'b' } },
        { questionId: 'effekt-ar-takt', correct: false, expected: { type: 'true-false', value: true }, explanation: 'En takt.', sources: [], question: ASKED['true-false'], given: null },
      ],
    };
    open('/subjects/example-subject/assessment/lesson/energi-och-effekt');

    await userEvent.click(await screen.findByRole('button', { name: 'Börja provet' }));
    expect(await screen.findByText('Fråga 1 av 2', { selector: '.stepcount' })).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: /kW$/ }));
    // No feedback until the end.
    expect(document.querySelector('.feedback')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Nästa fråga' }));
    expect(screen.getByText('1 fråga är obesvarad och räknas som fel.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Lämna in' }));

    expect(await screen.findByRole('heading', { name: 'Godkänt' })).toBeTruthy();
    expect(screen.getByText('1 av 2 rätt. Godkänt vid 50 %.')).toBeTruthy();
    expect(api.posted.find(({ path }) => path.endsWith(sitting.id))?.body).toEqual({ answers: [{ questionId: 'kwh-eller-kw', answer: { type: 'single-choice', option: 'b' } }] });
    const review = [...document.querySelectorAll('.review li')].map((item) => item.querySelector('.given')?.textContent);
    expect(review).toEqual(['Ditt svar: kW', 'Inget svar']);
  });

  it('takes an ordering question as shown, without asking the page to draw itself over and over', async () => {
    api.sitting = { ...sitting, questions: [ASKED.ordering] };
    // React reports a render loop driven by an effect as a console error rather than by throwing.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    open('/subjects/example-subject/assessment/lesson/energi-och-effekt');

    await userEvent.click(await screen.findByRole('button', { name: 'Börja provet' }));
    await screen.findByRole('button', { name: 'Flytta upp: kWh' });

    expect(screen.queryByText(/obesvarad/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Lämna in' })).toHaveProperty('disabled', false);
    await new Promise((settle) => setTimeout(settle, 50));
    expect(errors.mock.calls.map((call) => String(call[0])).filter((message) => /Maximum update depth/.test(message))).toEqual([]);
    errors.mockRestore();
  });

  it('says so when it cannot be started, and can be tried again', async () => {
    open('/subjects/example-subject/assessment/lesson/energi-och-effekt');

    await userEvent.click(await screen.findByRole('button', { name: 'Börja provet' }));

    expect(await screen.findByText('Provet kunde inte startas just nu.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Börja provet' })).toHaveProperty('disabled', false);
  });

  it('answers an address naming no lesson or area with “no such exam”', async () => {
    open('/subjects/example-subject/assessment/lesson/finns-inte');

    expect(await screen.findByRole('heading', { name: 'Provet finns inte' })).toBeTruthy();
  });
});

describe('the path with assessment', () => {
  it('offers each area’s exam, marks a lesson whose exam is passed, and says the area exam was passed', async () => {
    api.passed = { lessons: ['energi-och-effekt'], areas: ['grunder'] };
    open('/subjects/example-subject');

    const area = await screen.findByRole('region', { name: 'Grunder' });
    expect(within(area).getByRole('link', { name: 'Skriv områdesprovet' }).getAttribute('href')).toBe('/subjects/example-subject/assessment/area/grunder');
    await vi.waitFor(() => expect(area.querySelector('li[data-lesson="energi-och-effekt"]')?.getAttribute('data-state')).toBe('passed'));
    expect(within(area).getByText('Godkänt tidigare')).toBeTruthy();
  });
});

describe('the assessment module’s text', () => {
  it('has every message in both languages, with the same placeholders', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
  });
});

