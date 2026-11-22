import { ExamResultSchema, SittingSchema, type ExamResult, type ExamScope, type GivenAnswer } from '@skill-issue/contract';
import { drawn, expectedInWords, filtered, givenInWords, plural, postJson, readAnswer, SKIP, type SessionDependencies, type Terminal } from './asking.js';
import type { Outcome } from './pack.js';

export interface ExamCommand {
  readonly subject: string;
  readonly scope: ExamScope;
  readonly url: string;
  /** The language to ask the subject in; the subject's own when undefined. */
  readonly language: string | undefined;
}

/** A pass mark as the browser's result page writes it: a whole percentage. */
const percent = (share: number): string => `${Math.round(share * 100)} %`;

const STOPPED: Outcome = { text: 'Stopped: the exam was not handed in, so nothing was graded or added to your learning record.', exitCode: 0 };

/** The title of a problem the application answered with, if it sent one. */
const titleOf = (body: unknown): string | undefined =>
  typeof body === 'object' && body !== null && 'title' in body && typeof body.title === 'string' ? body.title : undefined;

/** Each answered question's entry in the hand-in; one left unanswered is left out, and the server counts it wrong. */
interface Given {
  readonly questionId: string;
  readonly answer: GivenAnswer;
  readonly durationMs: number;
}

/** Every answer reviewed, in the order asked: what was given, the right answer where it was wrong, why, and the source. */
function reviewed(result: ExamResult, terminal: Terminal): void {
  result.review.forEach((entry, index) => {
    const sources = entry.sources.map((s) => `${s.title} (${s.publisher})`).join('; ');
    const lines = [
      `[${index + 1}] ${entry.correct ? '✓' : '✗'} ${entry.question.prompt}`,
      entry.given === null ? '  No answer' : `  Your answer: ${givenInWords(entry.question, entry.given)}`,
      entry.correct ? undefined : `  The answer: ${expectedInWords(entry.question, entry.expected)}`,
      entry.explanation === '' ? undefined : `  ${entry.explanation}`,
      sources === '' ? undefined : `  Source: ${sources}`,
    ].filter((line) => line !== undefined);
    terminal.write(`\n${lines.join('\n')}\n`);
  });
}

/**
 * Sits a lesson or area exam in the terminal, as the browser's exam page does:
 * a sitting drawn afresh, every question asked with nothing graded, then the
 * hand-in, the mark against the pass mark and every answer reviewed. A question
 * may be left unanswered with -, and counts as wrong. Stopping with q, or the
 * input ending, before the hand-in leaves the sitting unsubmitted, so nothing
 * reaches the learning record.
 */
export async function exam(command: ExamCommand, deps: SessionDependencies): Promise<Outcome> {
  // Everything the session prints passes through here, so no line of subject material reaches the terminal unfiltered.
  const terminal = filtered(deps.terminal);
  const subjectPath = `/assessment/subjects/${encodeURIComponent(command.subject)}/exams`;
  const started = await postJson(deps.fetch, command.url, `${subjectPath}${command.language === undefined ? '' : `?language=${encodeURIComponent(command.language)}`}`, { scope: command.scope });
  if (started.kind === 'failed') {
    return started.outcome;
  }
  if (started.value.status === 404) {
    return titleOf(started.value.body) === 'No such subject'
      ? { text: `There is no subject ${command.subject}.`, exitCode: 1 }
      : { text: `${command.subject} has no ${command.scope.kind} ${command.scope.id}.`, exitCode: 1 };
  }
  const sitting = SittingSchema.safeParse(started.value.body);
  if (started.value.status !== 201 || !sitting.success) {
    return { text: `The application answered ${started.value.status} to starting the exam${titleOf(started.value.body) === undefined ? '' : ` (${titleOf(started.value.body)})`}.`, exitCode: 1 };
  }
  const { questions, title, passMark, id } = sitting.data;
  const total = questions.length;
  terminal.write(
    `${title}: ${plural(total, 'question', 'questions')}, passed at ${percent(passMark)} right. Nothing is graded until you hand in. Type ${SKIP} to leave a question unanswered, q to stop without handing in.\n`,
  );

  const given: Given[] = [];
  for (const [index, question] of questions.entries()) {
    terminal.write(`\n[${index + 1}/${total}]\n${drawn(question)}`);
    const shownAt = deps.now();
    const answer = await readAnswer(question, terminal, { skippable: true });
    if (answer === undefined) {
      return STOPPED;
    }
    if (answer !== null) {
      given.push({ questionId: question.id, answer, durationMs: Math.max(0, Math.round(deps.now() - shownAt)) });
    }
  }

  const unanswered = total - given.length;
  if (unanswered > 0) {
    terminal.write(`\n${unanswered} of ${plural(total, 'question', 'questions')} ${unanswered === 1 ? 'is unanswered; it counts' : 'are unanswered; they count'} as wrong.\n`);
  }
  const confirm = await terminal.read('\nPress Enter to hand in, or q to stop without handing in. ');
  if (confirm === undefined || ['q', 'quit'].includes(confirm.trim().toLowerCase())) {
    return STOPPED;
  }

  const handed = await postJson(deps.fetch, command.url, `${subjectPath}/${encodeURIComponent(id)}`, { answers: given, timeZone: deps.timeZone });
  if (handed.kind === 'failed') {
    return { text: `${handed.outcome.text} The exam was not handed in.`, exitCode: 1 };
  }
  const result = ExamResultSchema.safeParse(handed.value.body);
  if (handed.value.status !== 200 || !result.success) {
    const why = titleOf(handed.value.body);
    return { text: `The application answered ${handed.value.status} to the hand-in${why === undefined ? '' : ` (${why})`}; nothing was graded.`, exitCode: 1 };
  }
  reviewed(result.data, terminal);
  const { correct, passed } = result.data;
  return { text: `${passed ? 'Passed' : 'Not passed'}: ${correct} of ${result.data.total} right; the pass mark is ${percent(result.data.passMark)}.`, exitCode: 0 };
}
