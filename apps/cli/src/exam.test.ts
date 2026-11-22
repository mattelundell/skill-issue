import type { AskedQuestion, ExamResult, GivenAnswer, Graded } from '@skill-issue/contract';
import { describe, expect, it } from 'vitest';
import type { Terminal } from './asking.js';
import { exam } from './exam.js';

const APP_URL = 'http://127.0.0.1:4747';
const ZONE = 'Europe/Stockholm';
const SITTING = '0b5c4a52-6f1e-4c7e-9d0a-3a1f2b7c9e11';

const single: AskedQuestion = {
  id: 'kwh-eller-kw',
  language: 'sv',
  type: 'single-choice',
  prompt: 'Vilken enhet anger effekt?',
  options: [
    { id: 'a', text: 'kWh' },
    { id: 'b', text: 'kW' },
  ],
};
const truth: AskedQuestion = { id: 'effekt-ar-takt', language: 'sv', type: 'true-false', prompt: 'Effekt är en takt.' };
const factor: AskedQuestion = { id: 'verkningsgrad', language: 'sv', type: 'numeric', prompt: 'Verkningsgraden?', unit: '' };
const recall: AskedQuestion = { id: 'forklara-balans', language: 'sv', type: 'free-recall', prompt: 'Förklara energibalans.', answer: 'In = ut.' };

const RIGHT: Readonly<Record<string, GivenAnswer>> = {
  'kwh-eller-kw': { type: 'single-choice', option: 'b' },
  'effekt-ar-takt': { type: 'true-false', value: true },
  verkningsgrad: { type: 'numeric', value: 0.71 },
  'forklara-balans': { type: 'free-recall', knew: true },
};
const EXPECTED: Readonly<Record<string, Graded['expected']>> = {
  'kwh-eller-kw': { type: 'single-choice', option: 'b' },
  'effekt-ar-takt': { type: 'true-false', value: true },
  verkningsgrad: { type: 'numeric', value: 0.71, unit: '', tolerance: 0 },
  'forklara-balans': { type: 'free-recall', answer: 'In = ut.' },
};
const source = { id: 'exempelkalla', title: 'Exempelkälla', publisher: 'Exempelutgivaren' };

/** A terminal that types the given lines in turn, then ends as a closed input does. */
function scriptedTerminal(...lines: readonly string[]): Terminal & { readonly shown: () => string } {
  const queue = [...lines];
  let out = '';
  return {
    write: (text) => {
      out += text;
    },
    read: async (prompt) => {
      out += prompt;
      const line = queue.shift();
      if (line !== undefined) {
        out += `${line}\n`;
      }
      return line;
    },
    shown: () => out,
  };
}

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/**
 * The application as an exam sees it: a sitting of the given questions, and a
 * hand-in graded the way the server grades one — every question asked is in the
 * review, an unanswered one wrong, the mark against the pass mark.
 */
function fakeApplication(questions: readonly AskedQuestion[], options: { readonly passMark?: number; readonly explanation?: string; readonly handIn?: Response } = {}): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const passMark = options.passMark ?? 0.7;
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    sent.push({ method: init?.method ?? 'GET', path: `${url.pathname}${url.search}`, body });
    if (url.pathname === '/api/v1/assessment/subjects/energi/exams') {
      return json({ id: SITTING, subjectId: 'energi', scope: (body as { scope: unknown }).scope, title: 'Effekt och energi', passMark, questions, startedAt: '2026-11-22T10:00:00+01:00' }, 201);
    }
    if (url.pathname === `/api/v1/assessment/subjects/energi/exams/${SITTING}`) {
      if (options.handIn !== undefined) {
        return options.handIn;
      }
      const given = new Map((body as { answers: { questionId: string; answer: GivenAnswer }[] }).answers.map((a) => [a.questionId, a.answer]));
      const review = questions.map((question) => {
        const answer = given.get(question.id);
        const correct = answer !== undefined && JSON.stringify(answer) === JSON.stringify(RIGHT[question.id]);
        return { questionId: question.id, correct, expected: EXPECTED[question.id] ?? { type: 'free-recall', answer: '' }, explanation: options.explanation ?? `Varför ${question.id}.`, sources: [source], question, given: answer ?? null };
      });
      const correct = review.filter((r) => r.correct).length;
      const result: ExamResult = { sittingId: SITTING, scope: { kind: 'lesson', id: 'effekt-och-energi' }, title: 'Effekt och energi', correct, total: review.length, passMark, passed: correct / review.length >= passMark, review };
      return json(result);
    }
    return json({ type: 'about:blank', title: 'No such subject', status: 404 }, 404);
  };
  return { fetch: fake, sent };
}

/** An application that is not running. */
const refused: typeof fetch = async () => {
  throw new TypeError('fetch failed');
};

/** A clock that moves 1.5 seconds each time it is read. */
function steppingClock(): () => number {
  let now = 0;
  return () => (now += 1500);
}

const lesson = { subject: 'energi', scope: { kind: 'lesson', id: 'effekt-och-energi' }, url: APP_URL, language: undefined } as const;
const handIns = (sent: readonly Sent[]) => sent.filter((s) => s.path === `/api/v1/assessment/subjects/energi/exams/${SITTING}`);

describe('sitting an exam in the terminal', () => {
  it('starts a sitting of the lesson, asks every question with nothing graded, then hands in each answer with how long it took', async () => {
    const app = fakeApplication([single, truth, factor]);
    const terminal = scriptedTerminal('2', '1', '0,7', '');

    const outcome = await exam(lesson, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(app.sent[0]).toEqual({ method: 'POST', path: '/api/v1/assessment/subjects/energi/exams', body: { scope: { kind: 'lesson', id: 'effekt-och-energi' } } });
    // Nothing but the start and the one hand-in: no answer is sent, or graded, before the end.
    expect(app.sent.map((s) => s.path)).toEqual(['/api/v1/assessment/subjects/energi/exams', `/api/v1/assessment/subjects/energi/exams/${SITTING}`]);
    expect(handIns(app.sent)[0]?.body).toEqual({
      answers: [
        { questionId: 'kwh-eller-kw', answer: { type: 'single-choice', option: 'b' }, durationMs: 1500 },
        { questionId: 'effekt-ar-takt', answer: { type: 'true-false', value: true }, durationMs: 1500 },
        { questionId: 'verkningsgrad', answer: { type: 'numeric', value: 0.7 }, durationMs: 1500 },
      ],
      timeZone: ZONE,
    });
    const shown = terminal.shown();
    expect(shown).toContain('Effekt och energi: 3 questions, passed at 70 % right. Nothing is graded until you hand in.');
    expect(shown).toContain('[1/3]\nVilken enhet anger effekt?\n  1  kWh\n  2  kW\n');
    expect(shown).toContain('[3/3]\nVerkningsgraden?\n');
    expect(shown.indexOf('✓')).toBeGreaterThan(shown.indexOf('Press Enter to hand in'));
    expect(outcome).toEqual({ text: 'Not passed: 2 of 3 right; the pass mark is 70 %.', exitCode: 0 });
  });

  it('reviews every answer after the hand-in: what was given, the right answer where it was wrong, why, and the source', async () => {
    const app = fakeApplication([single, factor]);
    const terminal = scriptedTerminal('2', '0,7', '');

    await exam(lesson, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    const shown = terminal.shown();
    expect(shown).toContain('[1] ✓ Vilken enhet anger effekt?\n  Your answer: kW\n  Varför kwh-eller-kw.\n  Source: Exempelkälla (Exempelutgivaren)\n');
    // A number given and a number expected, each as the question's language writes it.
    expect(shown).toContain('[2] ✗ Verkningsgraden?\n  Your answer: 0,7\n  The answer: 0,71\n  Varför verkningsgrad.\n');
  });

  it('says when an exam is passed', async () => {
    const app = fakeApplication([single, truth]);
    const outcome = await exam(lesson, { terminal: scriptedTerminal('2', '1', ''), fetch: app.fetch, now: steppingClock(), timeZone: ZONE });
    expect(outcome).toEqual({ text: 'Passed: 2 of 2 right; the pass mark is 70 %.', exitCode: 0 });
  });

  it('leaves a question unanswered on -, hands it in without it, and says it counts as wrong', async () => {
    const app = fakeApplication([single, truth, recall]);
    const terminal = scriptedTerminal('-', '1', '-', '');

    await exam(lesson, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(handIns(app.sent)[0]?.body).toEqual({ answers: [{ questionId: 'effekt-ar-takt', answer: { type: 'true-false', value: true }, durationMs: 1500 }], timeZone: ZONE });
    const shown = terminal.shown();
    expect(shown).toContain('2 of 3 questions are unanswered; they count as wrong.');
    expect(shown).toContain('[1] ✗ Vilken enhet anger effekt?\n  No answer\n  The answer: kW\n');
  });

  it('asks free recall the way review does: the answer on Enter, then whether it was known', async () => {
    const app = fakeApplication([recall]);
    const terminal = scriptedTerminal('', 'y', '');

    await exam(lesson, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(handIns(app.sent)[0]?.body).toMatchObject({ answers: [{ questionId: 'forklara-balans', answer: { type: 'free-recall', knew: true } }] });
    expect(terminal.shown()).toContain('Answer: In = ut.\nDid you know it? (y/n) y\n');
    expect(terminal.shown()).toContain('[1] ✓ Förklara energibalans.\n  Your answer: knew it\n');
  });

  it('asks again, without moving on, when what is typed is not an answer', async () => {
    const app = fakeApplication([single]);
    const terminal = scriptedTerminal('kW', '2', '');

    await exam(lesson, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(terminal.shown()).toContain('Number: kW\nType the number of an option, 1 to 2.\nNumber: 2\n');
    expect(handIns(app.sent)[0]?.body).toMatchObject({ answers: [{ questionId: 'kwh-eller-kw', answer: { type: 'single-choice', option: 'b' } }] });
  });

  it.each([
    ['q at a question', ['2', 'q']],
    ['q at the hand-in', ['2', '1', 'q']],
    ['the input ending at a question', ['2']],
    ['the input ending at the hand-in', ['2', '1']],
  ])('does not hand in on %s', async (_case, lines) => {
    const app = fakeApplication([single, truth]);

    const outcome = await exam(lesson, { terminal: scriptedTerminal(...lines), fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(handIns(app.sent)).toEqual([]);
    expect(outcome).toEqual({ text: 'Stopped: the exam was not handed in, so nothing was graded or added to your learning record.', exitCode: 0 });
  });

  it('asks for the subject in the language given', async () => {
    const app = fakeApplication([single]);
    await exam({ ...lesson, scope: { kind: 'area', id: 'grunder' }, language: 'en' }, { terminal: scriptedTerminal('q'), fetch: app.fetch, now: steppingClock(), timeZone: ZONE });
    expect(app.sent[0]).toEqual({ method: 'POST', path: '/api/v1/assessment/subjects/energi/exams?language=en', body: { scope: { kind: 'area', id: 'grunder' } } });
  });

  it('prints no control character from the subject’s material, before or after the hand-in', async () => {
    const app = fakeApplication([{ ...single, prompt: 'Vilken enhet\u001B[2J anger effekt?' }], { explanation: 'Därför\u001B]0;owned\u0007.' });
    const terminal = scriptedTerminal('2', '');

    await exam(lesson, { terminal, fetch: app.fetch, now: steppingClock(), timeZone: ZONE });

    expect(terminal.shown().includes('\u001B') || terminal.shown().includes('\u0007')).toBe(false);
    expect(terminal.shown()).toContain('Vilken enhet[2J anger effekt?');
    expect(terminal.shown()).toContain('Därför]0;owned.');
  });

  it.each([
    ['subject', { type: 'about:blank', title: 'No such subject', status: 404 }, 'There is no subject energi.'],
    ['lesson', { type: 'about:blank', title: 'No such lesson', status: 404 }, 'energi has no lesson effekt-och-energi.'],
  ])('says there is no such %s', async (_case, problem, text) => {
    const fake: typeof fetch = async () => json(problem, 404);
    const outcome = await exam(lesson, { terminal: scriptedTerminal(), fetch: fake, now: steppingClock(), timeZone: ZONE });
    expect(outcome).toEqual({ text, exitCode: 1 });
  });

  it('says when the hand-in is refused, and that the answers were not graded', async () => {
    const app = fakeApplication([single], { handIn: json({ type: 'about:blank', title: 'The sitting has been handed in', status: 409 }, 409) });
    const outcome = await exam(lesson, { terminal: scriptedTerminal('2', ''), fetch: app.fetch, now: steppingClock(), timeZone: ZONE });
    expect(outcome).toEqual({ text: 'The application answered 409 to the hand-in (The sitting has been handed in); nothing was graded.', exitCode: 1 });
  });

  it('says when nothing answers', async () => {
    const outcome = await exam(lesson, { terminal: scriptedTerminal(), fetch: refused, now: steppingClock(), timeZone: ZONE });
    expect(outcome).toEqual({ text: `Nothing answers at ${APP_URL}. Is the application started?`, exitCode: 1 });
  });
});
