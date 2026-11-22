import { API_PREFIX, type AskedQuestion, type ExpectedAnswer, type GivenAnswer } from '@skill-issue/contract';
import type { Outcome } from './pack.js';

/** What a session needs of the terminal: to print, and to read one line, which is undefined once the input has ended. */
export interface Terminal {
  write(text: string): void;
  read(prompt: string): Promise<string | undefined>;
}

export type Parsed = { readonly ok: true; readonly value: GivenAnswer } | { readonly ok: false; readonly error: string };

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
export function drawn(question: AskedQuestion): string {
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

export function promptFor(question: AskedQuestion): string {
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
export function expectedInWords(question: AskedQuestion, expected: ExpectedAnswer): string {
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

export const STOP = new Set(['q', 'quit']);

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

export type Step<T> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'failed'; readonly outcome: Outcome };

export const failed = (text: string): Step<never> => ({ kind: 'failed', outcome: { text, exitCode: 1 } });

export async function getJson(fetchImpl: typeof fetch, url: string, path: string): Promise<Step<{ readonly status: number; readonly body: unknown }>> {
  try {
    const response = await fetchImpl(new URL(`${API_PREFIX}${path}`, url), { signal: AbortSignal.timeout(30_000) });
    return { kind: 'ok', value: { status: response.status, body: await response.json().catch(() => undefined) } };
  } catch {
    // Not propagated: refused or timed out, the advice is the same.
    return failed(`Nothing answers at ${url}. Is the application started?`);
  }
}

export const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Reads an answer to one question, asking again until what is typed is one; undefined when the learner stops. */
export async function readAnswer(question: AskedQuestion, terminal: Terminal): Promise<GivenAnswer | undefined> {
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

/** The terminal with everything it is given to print filtered, so no line of subject material reaches it unfiltered. */
export const filtered = (terminal: Terminal): Terminal => ({ write: (text) => terminal.write(printable(text)), read: (prompt) => terminal.read(printable(prompt)) });
