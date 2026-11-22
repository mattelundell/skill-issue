import {
  API_PREFIX,
  AskedQuestionsSchema,
  DueCountsSchema,
  DueSchema,
  GradedSchema,
  minutesFor,
  minutesForAll,
  requeue,
  type AskedQuestion,
  type ExpectedAnswer,
  type GivenAnswer,
  type Graded,
} from '@skill-issue/contract';
import type { Outcome } from './pack.js';

/** What a session needs of the terminal: to print, and to read one line, which is undefined once the input has ended. */
export interface Terminal {
  write(text: string): void;
  read(prompt: string): Promise<string | undefined>;
}

export interface ReviewDependencies {
  readonly terminal: Terminal;
  readonly fetch: typeof fetch;
  /** Milliseconds, for how long each answer took. */
  readonly now: () => number;
  /** The learner's time zone, which decides what "today" is. */
  readonly timeZone: string;
}

type Parsed = { readonly ok: true; readonly value: GivenAnswer } | { readonly ok: false; readonly error: string };

const parsed = (value: GivenAnswer): Parsed => ({ ok: true, value });
const refused = (error: string): Parsed => ({ ok: false, error });

/** Whole numbers from 1 to `count`, in the order typed, separated by spaces or commas; undefined if anything else is typed. */
function numbers(typed: string, count: number): number[] | undefined {
  const words = typed.split(/[\s,]+/).filter((word) => word !== '');
  const values = words.map((word) => (/^\d+$/.test(word) ? Number(word) : Number.NaN));
  return values.every((value) => value >= 1 && value <= count) ? values : undefined;
}

const letter = (index: number): string => String.fromCodePoint(97 + index);

/** The answer a line typed in the terminal gives to a question, or what to type instead. */
export function parseAnswer(question: AskedQuestion, typed: string): Parsed {
  const text = typed.trim();
  switch (question.type) {
    case 'single-choice': {
      const chosen = numbers(text, question.options.length);
      const option = chosen?.length === 1 ? question.options[(chosen[0] ?? 0) - 1] : undefined;
      return option === undefined ? refused(`Type the number of an option, 1 to ${question.options.length}.`) : parsed({ type: 'single-choice', option: option.id });
    }
    case 'multiple-choice': {
      const count = question.options.length;
      const chosen = numbers(text, count);
      if (chosen === undefined || chosen.length === 0) {
        return refused(`Type the numbers of the options you choose, 1 to ${count}.`);
      }
      if (new Set(chosen).size !== chosen.length) {
        return refused(`Type each option’s number once, 1 to ${count}.`);
      }
      return parsed({ type: 'multiple-choice', options: chosen.map((n) => question.options[n - 1]?.id ?? '') });
    }
    case 'true-false': {
      const word = text.toLowerCase();
      if (['1', 't', 'true', 's', 'sant', 'y', 'j'].includes(word)) {
        return parsed({ type: 'true-false', value: true });
      }
      if (['2', 'f', 'false', 'falskt', 'n'].includes(word)) {
        return parsed({ type: 'true-false', value: false });
      }
      return refused('Type 1 for true or 2 for false.');
    }
    case 'numeric': {
      const normal = text.replaceAll(/[\s ]/g, '').replace(',', '.');
      const value = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(normal) ? Number(normal) : Number.NaN;
      return Number.isFinite(value) ? parsed({ type: 'numeric', value }) : refused('Type a number; a decimal comma or point is fine.');
    }
    case 'short-text':
      return text === '' ? refused('Type an answer.') : parsed({ type: 'short-text', text });
    case 'ordering': {
      const count = question.items.length;
      const order = numbers(text, count);
      if (order?.length !== count || new Set(order).size !== count) {
        return refused(`Type every item’s number once, in the order you put them: 1 to ${count}.`);
      }
      return parsed({ type: 'ordering', items: order.map((n) => question.items[n - 1] ?? '') });
    }
    case 'matching': {
      const { lefts, rights } = question;
      const letters = text.toLowerCase().replaceAll(/[\s,]/g, '').split('');
      const indexes = letters.map((l) => l.codePointAt(0) ?? 0).map((code) => code - 97);
      const valid = indexes.length === lefts.length && new Set(indexes).size === indexes.length && indexes.every((i) => i >= 0 && i < rights.length);
      if (!valid) {
        return refused(`Type one letter for each of the ${lefts.length} on the left, each letter once: a to ${letter(rights.length - 1)}.`);
      }
      return parsed({ type: 'matching', pairs: lefts.map((left, i) => ({ left, right: rights[indexes[i] ?? 0] ?? '' })) });
    }
    case 'free-recall': {
      const word = text.toLowerCase();
      if (['y', 'yes', 'j', 'ja'].includes(word)) {
        return parsed({ type: 'free-recall', knew: true });
      }
      if (['n', 'no', 'nej'].includes(word)) {
        return parsed({ type: 'free-recall', knew: false });
      }
      return refused('Type y if you knew it, n if not.');
    }
    default: {
      const unhandled: never = question;
      return unhandled;
    }
  }
}

/** The question as printed: its prompt, and what there is to choose from. */
function drawn(question: AskedQuestion): string {
  const lines = [question.prompt];
  switch (question.type) {
    case 'single-choice':
    case 'multiple-choice':
      question.options.forEach((option, i) => lines.push(`  ${i + 1}  ${option.text}`));
      break;
    case 'true-false':
      lines.push('  1  true', '  2  false');
      break;
    case 'ordering':
      question.items.forEach((item, i) => lines.push(`  ${i + 1}  ${item}`));
      break;
    case 'matching':
      question.lefts.forEach((left, i) => lines.push(`  ${i + 1}  ${left}`));
      lines.push('');
      question.rights.forEach((right, i) => lines.push(`  ${letter(i)}  ${right}`));
      break;
    case 'numeric':
    case 'short-text':
    case 'free-recall':
      break;
    default: {
      const unhandled: never = question;
      return unhandled;
    }
  }
  return `${lines.join('\n')}\n`;
}

function promptFor(question: AskedQuestion): string {
  switch (question.type) {
    case 'single-choice':
    case 'true-false':
      return 'Number: ';
    case 'multiple-choice':
      return 'Numbers, separated by spaces: ';
    case 'numeric':
      return question.unit === '' ? 'Number: ' : `Number, in ${question.unit}: `;
    case 'short-text':
      return 'Answer: ';
    case 'ordering':
      return 'Numbers, in order: ';
    case 'matching':
      return `A letter for each of 1–${question.lefts.length}, in order: `;
    case 'free-recall':
      return 'Did you know it? (y/n) ';
    default: {
      const unhandled: never = question;
      return unhandled;
    }
  }
}

/** The right answer in words, using the question's own option texts. */
function expectedInWords(question: AskedQuestion, expected: ExpectedAnswer): string {
  const optionText = (id: string): string => (question.type === 'single-choice' || question.type === 'multiple-choice' ? (question.options.find((o) => o.id === id)?.text ?? id) : id);
  switch (expected.type) {
    case 'single-choice':
      return optionText(expected.option);
    case 'multiple-choice':
      return expected.options.map(optionText).join('; ');
    case 'true-false':
      return expected.value ? 'true' : 'false';
    case 'numeric': {
      // Written as the question's language writes a number: 0,71 under a Swedish question.
      const format = new Intl.NumberFormat(question.language, { maximumFractionDigits: 10, useGrouping: false });
      const value = `${format.format(expected.value)}${expected.unit === '' ? '' : ` ${expected.unit}`}`;
      return expected.tolerance > 0 ? `${value} (± ${format.format(expected.tolerance)})` : value;
    }
    case 'short-text':
      return expected.accepted.join(' or ');
    case 'ordering':
      return expected.items.join(' → ');
    case 'matching':
      return expected.pairs.map(({ left, right }) => `${left} → ${right}`).join('; ');
    case 'free-recall':
      return expected.answer;
    default: {
      const unhandled: never = expected;
      return unhandled;
    }
  }
}

const STOP = new Set(['q', 'quit']);

/**
 * Text with every control character taken out but the newline and the tab.
 * Subject material may be written by anyone's assistant, and an escape
 * sequence printed to a terminal can move the cursor, clear the screen or
 * rename the window.
 */
export const printable = (text: string): string => text.replaceAll(/[^]/gu, (char) => (isControl(char.codePointAt(0) ?? 0) ? '' : char));

/** C0 and C1 controls and DEL, but not the tab (9) or the newline (10). */
function isControl(code: number): boolean {
  return (code <= 0x1f && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
}

interface Due {
  readonly subjectId: string;
  readonly questionId: string;
}

type Step<T> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'failed'; readonly outcome: Outcome };

const failed = (text: string): Step<never> => ({ kind: 'failed', outcome: { text, exitCode: 1 } });

async function getJson(fetchImpl: typeof fetch, url: string, path: string): Promise<Step<{ readonly status: number; readonly body: unknown }>> {
  try {
    const response = await fetchImpl(new URL(`${API_PREFIX}${path}`, url), { signal: AbortSignal.timeout(30_000) });
    return { kind: 'ok', value: { status: response.status, body: await response.json().catch(() => undefined) } };
  } catch {
    // Not propagated: refused or timed out, the advice is the same.
    return failed(`Nothing answers at ${url}. Is the application started?`);
  }
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
const about = (minutes: number | undefined): string => (minutes === undefined ? '' : `, about ${plural(minutes, 'minute', 'minutes')}`);

/** What is due today, the most overdue first, and the line that introduces it. */
async function whatIsDue(subject: string | undefined, url: string, deps: ReviewDependencies): Promise<Step<{ readonly due: readonly Due[]; readonly heading: string; readonly nothing: string }>> {
  const zone = `timeZone=${encodeURIComponent(deps.timeZone)}`;
  if (subject !== undefined) {
    const answered = await getJson(deps.fetch, url, `/review/subjects/${encodeURIComponent(subject)}/due?${zone}`);
    if (answered.kind === 'failed') {
      return answered;
    }
    if (answered.value.status === 404) {
      return failed(`There is no subject ${subject}.`);
    }
    const due = DueSchema.safeParse(answered.value.body);
    if (!due.success) {
      return failed(`Something answers at ${url}, but it is not Skill Issue with review.`);
    }
    const { questions, next, typicalAnswerMs } = due.data;
    return {
      kind: 'ok',
      value: {
        due: questions.map((questionId) => ({ subjectId: subject, questionId })),
        heading: `${plural(questions.length, 'question is', 'questions are')} due in ${subject}${about(minutesFor(questions.length, typicalAnswerMs))}.`,
        nothing: `Nothing is due in ${subject} today.${next === null ? '' : ` Next: ${plural(next.questions, 'question', 'questions')} on ${next.day}.`}`,
      },
    };
  }
  const answered = await getJson(deps.fetch, url, `/review/due?${zone}`);
  if (answered.kind === 'failed') {
    return answered;
  }
  const counts = DueCountsSchema.safeParse(answered.value.body);
  if (!counts.success) {
    return failed(`Something answers at ${url}, but it is not Skill Issue with review.`);
  }
  const { subjects, questions } = counts.data;
  const holding = Object.values(subjects).filter((s) => s.due > 0).length;
  return {
    kind: 'ok',
    value: {
      due: questions,
      heading: `${plural(questions.length, 'question is', 'questions are')} due in ${plural(holding, 'subject', 'subjects')}${about(minutesForAll(Object.values(subjects)))}.`,
      nothing: 'Nothing is due today in any subject.',
    },
  };
}

/** Each due question as it is asked, fetched a subject at a time; a question the subject no longer asks is left out. */
async function askedQuestions(due: readonly Due[], url: string, deps: ReviewDependencies): Promise<Step<ReadonlyMap<string, AskedQuestion>>> {
  const asked = new Map<string, AskedQuestion>();
  const bySubject = Map.groupBy(due, (d) => d.subjectId);
  for (const [subjectId, inSubject] of bySubject) {
    const ids = inSubject.map((d) => d.questionId);
    // A few dozen ids a request keeps the address well within what any server accepts.
    for (let at = 0; at < ids.length; at += 40) {
      const answered = await getJson(deps.fetch, url, `/assessment/subjects/${encodeURIComponent(subjectId)}/questions?ids=${ids.slice(at, at + 40).map(encodeURIComponent).join(',')}`);
      if (answered.kind === 'failed') {
        return answered;
      }
      const questions = AskedQuestionsSchema.safeParse(answered.value.body);
      if (!questions.success) {
        return failed(`Something answers at ${url}, but it is not Skill Issue with assessment.`);
      }
      for (const question of questions.data.questions) {
        asked.set(`${subjectId}/${question.id}`, question);
      }
    }
  }
  return { kind: 'ok', value: asked };
}

async function sendAnswer(due: Due, answer: GivenAnswer, durationMs: number, url: string, deps: ReviewDependencies): Promise<Step<Graded>> {
  let response: Response;
  try {
    response = await deps.fetch(new URL(`${API_PREFIX}/assessment/subjects/${encodeURIComponent(due.subjectId)}/questions/${encodeURIComponent(due.questionId)}/answers`, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer, durationMs, timeZone: deps.timeZone, setting: 'review' }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // Not propagated: refused or timed out, the advice is the same.
    return failed(`Nothing answers at ${url}. Is the application started? The answer to ${due.questionId} was not sent.`);
  }
  const graded = GradedSchema.safeParse(await response.json().catch(() => undefined));
  return graded.success ? { kind: 'ok', value: graded.data } : failed(`The application answered ${response.status} to the answer to ${due.questionId}, without grading it.`);
}

/** Reads an answer to one question, asking again until what is typed is one; undefined when the learner stops. */
async function readAnswer(question: AskedQuestion, terminal: Terminal): Promise<GivenAnswer | undefined> {
  if (question.type === 'free-recall') {
    const shown = await terminal.read('Press Enter to see the answer. ');
    if (shown === undefined || STOP.has(shown.trim().toLowerCase())) {
      return undefined;
    }
    terminal.write(`Answer: ${question.answer}\n`);
  }
  for (;;) {
    const typed = await terminal.read(promptFor(question));
    if (typed === undefined || STOP.has(typed.trim().toLowerCase())) {
      return undefined;
    }
    const answer = parseAnswer(question, typed);
    if (answer.ok) {
      return answer.value;
    }
    terminal.write(`${answer.error}\n`);
  }
}

/**
 * A review session in the terminal: what was due when it opened, asked one
 * question at a time, a wrong answer asked again later in the session by the
 * same rule as in the browser, until every question has been answered right
 * once or the learner stops with q or by ending the input. Each answer is sent
 * as it is given, so stopping loses nothing.
 */
export async function review(command: { readonly subject: string | undefined; readonly url: string }, deps: ReviewDependencies): Promise<Outcome> {
  // Everything the session prints passes through here, so no line of subject material reaches the terminal unfiltered.
  const terminal: Terminal = { write: (text) => deps.terminal.write(printable(text)), read: (prompt) => deps.terminal.read(printable(prompt)) };
  const found = await whatIsDue(command.subject, command.url, deps);
  if (found.kind === 'failed') {
    return found.outcome;
  }
  if (found.value.due.length === 0) {
    return { text: found.value.nothing, exitCode: 0 };
  }
  const asked = await askedQuestions(found.value.due, command.url, deps);
  if (asked.kind === 'failed') {
    return asked.outcome;
  }
  const keyOf = (d: Due): string => `${d.subjectId}/${d.questionId}`;
  let queue: readonly Due[] = found.value.due.filter((d) => asked.value.has(keyOf(d)));
  const total = queue.length;
  terminal.write(`${found.value.heading} Type q to stop; what you have answered is kept.\n`);

  const rightFirstTime = new Set<string>();
  const missed = new Set<string>();
  // Questions are numbered as they are first met; one asked again says so instead, so it does not read as progress.
  const met = new Set<string>();
  for (;;) {
    const [current, ...rest] = queue;
    if (current === undefined) {
      break;
    }
    const question = asked.value.get(keyOf(current));
    if (question === undefined) {
      queue = rest;
      continue;
    }
    const again = met.has(keyOf(current));
    met.add(keyOf(current));
    terminal.write(`\n[${again ? 'again' : `${met.size}/${total}`}] ${current.subjectId}\n${drawn(question)}`);
    const shownAt = deps.now();
    const answer = await readAnswer(question, terminal);
    if (answer === undefined) {
      break;
    }
    const graded = await sendAnswer(current, answer, Math.max(0, Math.round(deps.now() - shownAt)), command.url, deps);
    if (graded.kind === 'failed') {
      return graded.outcome;
    }
    const sources = graded.value.sources.map((s) => `${s.title} (${s.publisher})`).join('; ');
    const why = [graded.value.explanation === '' ? undefined : `  ${graded.value.explanation}`, sources === '' ? undefined : `  Source: ${sources}`].filter((line) => line !== undefined);
    if (graded.value.correct) {
      if (!missed.has(keyOf(current))) {
        rightFirstTime.add(keyOf(current));
      }
      terminal.write(`${['✓ Right.', ...why].join('\n')}\n`);
      queue = rest;
    } else {
      missed.add(keyOf(current));
      terminal.write(`${[`✗ Wrong. The answer: ${expectedInWords(question, graded.value.expected)}`, ...why, '  It comes back later in this session.'].join('\n')}\n`);
      queue = requeue(rest, current);
    }
  }

  const left = new Set(queue.map(keyOf)).size;
  if (left > 0) {
    return { text: `Stopped: ${total - left} of ${plural(total, 'question', 'questions')} answered right; ${left} ${left === 1 ? 'stays' : 'stay'} due.`, exitCode: 0 };
  }
  const firstTime = rightFirstTime.size === total ? 'every one' : String(rightFirstTime.size);
  return { text: `Done: ${plural(total, 'question', 'questions')}, ${firstTime} right the first time. Nothing is left due.`, exitCode: 0 };
}
