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
  type GivenAnswer,
  type Graded,
} from '@skill-issue/contract';
import { drawn, expectedInWords, failed, filtered, getJson, plural, readAnswer, type Step, type Terminal } from './asking.js';
import type { Outcome } from './pack.js';

export interface ReviewDependencies {
  readonly terminal: Terminal;
  readonly fetch: typeof fetch;
  /** Milliseconds, for how long each answer took. */
  readonly now: () => number;
  /** The learner's time zone, which decides what "today" is. */
  readonly timeZone: string;
}

interface Due {
  readonly subjectId: string;
  readonly questionId: string;
}

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

/**
 * A review session in the terminal: what was due when it opened, asked one
 * question at a time, a wrong answer asked again later in the session by the
 * same rule as in the browser, until every question has been answered right
 * once or the learner stops with q or by ending the input. Each answer is sent
 * as it is given, so stopping loses nothing.
 */
export async function review(command: { readonly subject: string | undefined; readonly url: string }, deps: ReviewDependencies): Promise<Outcome> {
  // Everything the session prints passes through here, so no line of subject material reaches the terminal unfiltered.
  const terminal = filtered(deps.terminal);
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
