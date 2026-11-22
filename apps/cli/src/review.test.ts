import type { AskedQuestion, GivenAnswer, Graded } from '@skill-issue/contract';
import { describe, expect, it } from 'vitest';
import type { Terminal } from './asking.js';
import { review } from './review.js';

const APP_URL = 'http://127.0.0.1:4747';
const ZONE = 'Europe/Stockholm';

const single: AskedQuestion = {
  id: 'kwh-eller-kw',
  language: 'sv',
  type: 'single-choice',
  prompt: 'Vilken enhet anger effekt?',
  options: [
    { id: 'a', text: 'kWh' },
    { id: 'b', text: 'kW' },
    { id: 'c', text: 'J' },
  ],
};
const recall: AskedQuestion = { id: 'forklara-balans', language: 'sv', type: 'free-recall', prompt: 'Förklara energibalans.', answer: 'In = ut.' };
const truth: AskedQuestion = { id: 'effekt-ar-takt', language: 'sv', type: 'true-false', prompt: 'Effekt är en takt.' };
const median: AskedQuestion = { id: 'median', language: 'en', type: 'numeric', prompt: 'The median of 1, 2, 9?', unit: '' };

/** A terminal that types the given lines in turn, then ends as a closed input does. */
function scriptedTerminal(...lines: readonly string[]): Terminal & { readonly shown: () => string; readonly prompts: string[] } {
  const queue = [...lines];
  let out = '';
  const prompts: string[] = [];
  return {
    write: (text) => {
      out += text;
    },
    read: async (prompt) => {
      prompts.push(prompt);
      out += prompt;
      const line = queue.shift();
      if (line !== undefined) {
        out += `${line}\n`;
      }
      return line;
    },
    shown: () => out,
    prompts,
  };
}

const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

/** An application that knows no subject of the name asked for. */
const noSubject: typeof fetch = async () => new Response(JSON.stringify({ type: 'about:blank', title: 'No such subject', status: 404 }), { status: 404 });

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** The application as review sees it: what is due, the questions as asked, and a grade for each answer by a given rule. */
function fakeApplication(due: unknown, questions: Readonly<Record<string, readonly AskedQuestion[]>>, grade: (questionId: string, given: GivenAnswer) => Graded): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    sent.push({ method: init?.method ?? 'GET', path: `${url.pathname}${url.search}`, body });
    if (url.pathname.endsWith('/due')) {
      return json(due);
    }
    const asked = /^\/api\/v1\/assessment\/subjects\/([^/]+)\/questions$/.exec(url.pathname);
    if (asked !== null) {
      const subjectId = asked[1] ?? '';
      const ids = (url.searchParams.get('ids') ?? '').split(',');
      return json({ subjectId, questions: (questions[subjectId] ?? []).filter((q) => ids.includes(q.id)) });
    }
    const answered = /^\/api\/v1\/assessment\/subjects\/[^/]+\/questions\/([^/]+)\/answers$/.exec(url.pathname);
    if (answered !== null && body !== null && typeof body === 'object' && 'answer' in body) {
      return json(grade(answered[1] ?? '', (body as { answer: GivenAnswer }).answer));
    }
    return new Response('{}', { status: 404 });
  };
  return { fetch: fake, sent };
}

const source = { id: 'exempelkalla', title: 'Exempelkälla', publisher: 'Exempelutgivaren' };
const RIGHT: Readonly<Record<string, GivenAnswer>> = {
  'kwh-eller-kw': { type: 'single-choice', option: 'b' },
  'effekt-ar-takt': { type: 'true-false', value: true },
  'forklara-balans': { type: 'free-recall', knew: true },
  median: { type: 'numeric', value: 2 },
};
const EXPECTED: Readonly<Record<string, Graded['expected']>> = {
  'kwh-eller-kw': { type: 'single-choice', option: 'b' },
  'effekt-ar-takt': { type: 'true-false', value: true },
  'forklara-balans': { type: 'free-recall', answer: 'In = ut.' },
  median: { type: 'numeric', value: 2, unit: '', tolerance: 0 },
};
const gradeByKey = (questionId: string, given: GivenAnswer): Graded => ({
  questionId,
  correct: JSON.stringify(given) === JSON.stringify(RIGHT[questionId]),
  expected: EXPECTED[questionId] ?? { type: 'free-recall', answer: '' },
  explanation: `Varför ${questionId}.`,
  sources: [source],
});

/** A clock that moves 1.5 seconds each time it is read. */
function steppingClock(): () => number {
  let now = 0;
  return () => (now += 1500);
}

const answersSent = (sent: readonly Sent[]) => sent.filter((s) => s.method === 'POST').map((s) => [s.path, s.body]);

describe('a review session in the terminal', () => {
  it('asks what is due in every subject, the most overdue first, and sends each answer as a review with how long it took', async () => {
    const app = fakeApplication(
      { subjects: { energi: { due: 1, typicalAnswerMs: 4000 }, statistik: { due: 1, typicalAnswerMs: 4000 } }, questions: [{ subjectId: 'statistik', questionId: 'median' }, { subjectId: 'energi', questionId: 'kwh-eller-kw' }] },
      { energi: [single], statistik: [median] },
      gradeByKey,
    );
    const terminal = scriptedTerminal('2', '2');

    const outcome = await review({ subject: undefined, url: APP_URL }, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(app.sent.filter((s) => s.method === 'GET').map((s) => s.path)).toEqual([
      `/api/v1/review/due?timeZone=${encodeURIComponent(ZONE)}`,
      '/api/v1/assessment/subjects/statistik/questions?ids=median',
      '/api/v1/assessment/subjects/energi/questions?ids=kwh-eller-kw',
    ]);
    expect(answersSent(app.sent)).toEqual([
      ['/api/v1/assessment/subjects/statistik/questions/median/answers', { answer: { type: 'numeric', value: 2 }, durationMs: 1500, timeZone: ZONE, setting: 'review' }],
      ['/api/v1/assessment/subjects/energi/questions/kwh-eller-kw/answers', { answer: { type: 'single-choice', option: 'b' }, durationMs: 1500, timeZone: ZONE, setting: 'review' }],
    ]);
    expect(outcome).toEqual({ text: 'Done: 2 questions, every one right the first time. Nothing is left due.', exitCode: 0 });
    const shown = terminal.shown();
    expect(shown).toContain('2 questions are due in 2 subjects, about 1 minute.');
    expect(shown).toContain('[1/2] statistik\nThe median of 1, 2, 9?\n');
    expect(shown).toContain('[2/2] energi\nVilken enhet anger effekt?\n  1  kWh\n  2  kW\n  3  J\n');
  });

  it('asks a wrong answer again behind the next three, showing the right answer, why, and where that comes from', async () => {
    const app = fakeApplication({ subjectId: 'energi', questions: ['kwh-eller-kw', 'effekt-ar-takt'], scheduled: 2, next: null, typicalAnswerMs: null }, { energi: [single, truth] }, gradeByKey);
    // Wrong, then right on the second question, then right when the first comes back.
    const terminal = scriptedTerminal('1', '1', '2');

    const outcome = await review({ subject: 'energi', url: APP_URL }, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(answersSent(app.sent).map(([path, body]) => [path, (body as { answer: GivenAnswer }).answer])).toEqual([
      ['/api/v1/assessment/subjects/energi/questions/kwh-eller-kw/answers', { type: 'single-choice', option: 'a' }],
      ['/api/v1/assessment/subjects/energi/questions/effekt-ar-takt/answers', { type: 'true-false', value: true }],
      ['/api/v1/assessment/subjects/energi/questions/kwh-eller-kw/answers', { type: 'single-choice', option: 'b' }],
    ]);
    expect(terminal.shown()).toContain('✗ Wrong. The answer: kW\n  Varför kwh-eller-kw.\n  Source: Exempelkälla (Exempelutgivaren)\n  It comes back later in this session.\n');
    // Numbered as the questions it holds, so a question asked again does not read as progress.
    expect(terminal.shown().match(/^\[[^\]]+\] energi$/gm)).toEqual(['[1/2] energi', '[2/2] energi', '[again] energi']);
    expect(outcome).toEqual({ text: 'Done: 2 questions, 1 right the first time. Nothing is left due.', exitCode: 0 });
  });

  it('gives a number in the right answer as the question’s language writes it', async () => {
    const swedish: AskedQuestion = { id: 'faktor', language: 'sv', type: 'numeric', prompt: 'Vilken faktor?', unit: '' };
    const app = fakeApplication({ subjectId: 'energi', questions: ['faktor'], scheduled: 1, next: null, typicalAnswerMs: null }, { energi: [swedish] }, (questionId) => ({
      questionId,
      correct: false,
      expected: { type: 'numeric', value: 0.71, unit: 'kWh/m²', tolerance: 0.005 },
      explanation: '',
      sources: [],
    }));

    const terminal = scriptedTerminal('0,5');

    await review({ subject: 'energi', url: APP_URL }, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(terminal.shown()).toContain('✗ Wrong. The answer: 0,71 kWh/m² (± 0,005)\n');
  });

  it('prints no control character from the subject’s material, so a pack cannot move the cursor, clear the screen or retitle the terminal', async () => {
    const hostile: AskedQuestion = { ...single, prompt: 'Vilken enhet?\u001b[2J\u001b]0;pwned\u0007', options: [{ id: 'a', text: 'kWh\u009b31m' }, { id: 'b', text: 'kW\r' }] };
    const app = fakeApplication({ subjectId: 'energi', questions: ['kwh-eller-kw'], scheduled: 1, next: null, typicalAnswerMs: null }, { energi: [hostile] }, (questionId) => ({
      ...gradeByKey(questionId, { type: 'single-choice', option: 'a' }),
      explanation: 'Därför.\u001b[1A',
    }));
    const terminal = scriptedTerminal('1');

    await review({ subject: 'energi', url: APP_URL }, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(terminal.shown()).toContain('Vilken enhet?[2J]0;pwned\n  1  kWh31m\n  2  kW\n');
    expect(terminal.shown()).toContain('  Därför.[1A\n');
    const controls = Array.from(terminal.shown().matchAll(/[^]/gu), ([char]) => char.codePointAt(0) ?? 0).filter((code) => (code <= 0x1f && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f));
    expect(controls).toEqual([]);
  });

  it('asks again, without sending anything, when what is typed is not an answer', async () => {
    const app = fakeApplication({ subjectId: 'energi', questions: ['kwh-eller-kw'], scheduled: 1, next: null, typicalAnswerMs: null }, { energi: [single] }, gradeByKey);
    const terminal = scriptedTerminal('kW', '2');

    await review({ subject: 'energi', url: APP_URL }, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(answersSent(app.sent)).toHaveLength(1);
    expect(terminal.shown()).toContain('Type the number of an option, 1 to 3.\n');
  });

  it('shows free recall’s answer on Enter, then asks whether it was known', async () => {
    const app = fakeApplication({ subjectId: 'energi', questions: ['forklara-balans'], scheduled: 1, next: null, typicalAnswerMs: null }, { energi: [recall] }, gradeByKey);
    const terminal = scriptedTerminal('', 'y');

    await review({ subject: 'energi', url: APP_URL }, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(answersSent(app.sent).map(([, body]) => (body as { answer: GivenAnswer }).answer)).toEqual([{ type: 'free-recall', knew: true }]);
    expect(terminal.shown()).toContain('Answer: In = ut.\n');
    expect(terminal.prompts).toEqual(['Press Enter to see the answer. ', 'Did you know it? (y/n) ']);
  });

  it('stops on q, or when the input ends, and says what stays due', async () => {
    // After q comes an answer that would be sent if q did not stop the session.
    for (const ending of [['2', 'q', '1'], ['2']]) {
      const app = fakeApplication({ subjectId: 'energi', questions: ['kwh-eller-kw', 'effekt-ar-takt'], scheduled: 2, next: null, typicalAnswerMs: null }, { energi: [single, truth] }, gradeByKey);

      const outcome = await review({ subject: 'energi', url: APP_URL }, { terminal: scriptedTerminal(...ending), fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

      expect({ ending, outcome }).toEqual({ ending, outcome: { text: 'Stopped: 1 of 2 questions answered right; 1 stays due.', exitCode: 0 } });
      expect(answersSent(app.sent)).toHaveLength(1);
    }
  });

  it('says when nothing is due, and when more falls due', async () => {
    const app = fakeApplication({ subjectId: 'energi', questions: [], scheduled: 12, next: { day: '2026-11-25', questions: 4 }, typicalAnswerMs: 4000 }, {}, gradeByKey);

    const outcome = await review({ subject: 'energi', url: APP_URL }, { terminal: scriptedTerminal(), fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(outcome).toEqual({ text: 'Nothing is due in energi today. Next: 4 questions on 2026-11-25.', exitCode: 0 });
    expect(app.sent.map((s) => s.path)).toEqual([`/api/v1/review/subjects/energi/due?timeZone=${encodeURIComponent(ZONE)}`]);
  });

  it('says there is no such subject', async () => {
    expect(await review({ subject: 'finns-inte', url: APP_URL }, { terminal: scriptedTerminal(), fetch: noSubject, now: steppingClock(), timeZone: ZONE })).toEqual({ text: 'There is no subject finns-inte.', exitCode: 1 });
  });
});
