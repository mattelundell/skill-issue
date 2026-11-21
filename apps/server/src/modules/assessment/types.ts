import type { AskedQuestion, ExpectedAnswer, GivenAnswer, Question, QuestionType } from '@skill-issue/contract';

/**
 * A question type, as the server knows it: how it is asked (without its
 * answer), how an answer to it is graded, and what the right answer is shown
 * as. A new type is one more entry here and one in the browser's list.
 */
export interface QuestionTypePlugin<T extends QuestionType> {
  readonly ask: (question: Extract<Question, { type: T }>, shuffle: Shuffle) => Extract<AskedQuestion, { type: T }>;
  readonly grade: (question: Extract<Question, { type: T }>, given: Extract<GivenAnswer, { type: T }>) => boolean;
  readonly expected: (question: Extract<Question, { type: T }>) => Extract<ExpectedAnswer, { type: T }>;
}

/** Puts a list in a new order. Injected, so a test can fix the order and the server can make it random. */
export type Shuffle = <V>(values: readonly V[]) => V[];

export const randomShuffle: Shuffle = (values) => {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    const here = shuffled[index];
    const there = shuffled[other];
    if (here !== undefined && there !== undefined) {
      shuffled[index] = there;
      shuffled[other] = here;
    }
  }
  return shuffled;
};

/** Text as a learner types it: case kept or not, and runs of spaces taken as one. */
const normalised = (value: string, caseSensitive: boolean): string => {
  const spaced = value.trim().replace(/\s+/g, ' ');
  return caseSensitive ? spaced : spaced.toLocaleLowerCase('sv');
};

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && new Set(a).size === a.length && a.every((value) => b.includes(value));

/** A shuffle that does not hand back the correct order, when another order exists: an ordering question must ask something. */
function shuffledAway(values: readonly string[], shuffle: Shuffle): string[] {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shuffled = shuffle(values);
    if (shuffled.some((value, index) => value !== values[index])) {
      return shuffled;
    }
  }
  return [...values.slice(1), ...values.slice(0, 1)];
}

const base = (question: Question) => ({ id: question.id, language: question.language, prompt: question.prompt });

export const QUESTION_TYPES: { readonly [T in QuestionType]: QuestionTypePlugin<T> } = {
  'single-choice': {
    ask: (question) => ({ ...base(question), type: 'single-choice', options: question.options }),
    grade: (question, given) => given.option === question.answer,
    expected: (question) => ({ type: 'single-choice', option: question.answer }),
  },
  'multiple-choice': {
    ask: (question) => ({ ...base(question), type: 'multiple-choice', options: question.options }),
    grade: (question, given) => sameSet(given.options, question.answer),
    expected: (question) => ({ type: 'multiple-choice', options: question.answer }),
  },
  'true-false': {
    ask: (question) => ({ ...base(question), type: 'true-false' }),
    grade: (question, given) => given.value === question.answer,
    expected: (question) => ({ type: 'true-false', value: question.answer }),
  },
  numeric: {
    ask: (question) => ({ ...base(question), type: 'numeric', unit: question.answer.unit }),
    // A hair of slack, so 0.1 + 0.2 typed as 0.3 is not wrong by floating point alone.
    grade: (question, given) => Math.abs(given.value - question.answer.value) <= question.answer.tolerance + 1e-9 * Math.max(1, Math.abs(question.answer.value)),
    expected: (question) => ({ type: 'numeric', ...question.answer }),
  },
  'short-text': {
    ask: (question) => ({ ...base(question), type: 'short-text' }),
    grade: (question, given) => question.accepted.some((accepted) => normalised(accepted, question.caseSensitive) === normalised(given.text, question.caseSensitive)),
    expected: (question) => ({ type: 'short-text', accepted: question.accepted }),
  },
  ordering: {
    ask: (question, shuffle) => ({ ...base(question), type: 'ordering', items: shuffledAway(question.items, shuffle) }),
    grade: (question, given) => given.items.length === question.items.length && given.items.every((item, index) => item === question.items[index]),
    expected: (question) => ({ type: 'ordering', items: question.items }),
  },
  matching: {
    ask: (question, shuffle) => ({ ...base(question), type: 'matching', lefts: shuffle(question.pairs.map((pair) => pair.left)), rights: shuffle(question.pairs.map((pair) => pair.right)) }),
    grade: (question, given) =>
      given.pairs.length === question.pairs.length && question.pairs.every((pair) => given.pairs.some((answered) => answered.left === pair.left && answered.right === pair.right)),
    expected: (question) => ({ type: 'matching', pairs: question.pairs }),
  },
  'free-recall': {
    ask: (question) => ({ ...base(question), type: 'free-recall', answer: question.answer }),
    grade: (_question, given) => given.knew,
    expected: (question) => ({ type: 'free-recall', answer: question.answer }),
  },
};

/** How a question is asked, through its type. Exhaustive: a type missing here does not compile. */
export function ask(question: Question, shuffle: Shuffle): AskedQuestion {
  switch (question.type) {
    case 'single-choice':
      return QUESTION_TYPES['single-choice'].ask(question, shuffle);
    case 'multiple-choice':
      return QUESTION_TYPES['multiple-choice'].ask(question, shuffle);
    case 'true-false':
      return QUESTION_TYPES['true-false'].ask(question, shuffle);
    case 'numeric':
      return QUESTION_TYPES.numeric.ask(question, shuffle);
    case 'short-text':
      return QUESTION_TYPES['short-text'].ask(question, shuffle);
    case 'ordering':
      return QUESTION_TYPES.ordering.ask(question, shuffle);
    case 'matching':
      return QUESTION_TYPES.matching.ask(question, shuffle);
    case 'free-recall':
      return QUESTION_TYPES['free-recall'].ask(question, shuffle);
    default: {
      const unknown: never = question;
      return unknown;
    }
  }
}

/** Whether an answer is right; undefined when it is not an answer to this type of question at all. */
export function grade(question: Question, given: GivenAnswer): boolean | undefined {
  switch (question.type) {
    case 'single-choice':
      return given.type === question.type ? QUESTION_TYPES['single-choice'].grade(question, given) : undefined;
    case 'multiple-choice':
      return given.type === question.type ? QUESTION_TYPES['multiple-choice'].grade(question, given) : undefined;
    case 'true-false':
      return given.type === question.type ? QUESTION_TYPES['true-false'].grade(question, given) : undefined;
    case 'numeric':
      return given.type === question.type ? QUESTION_TYPES.numeric.grade(question, given) : undefined;
    case 'short-text':
      return given.type === question.type ? QUESTION_TYPES['short-text'].grade(question, given) : undefined;
    case 'ordering':
      return given.type === question.type ? QUESTION_TYPES.ordering.grade(question, given) : undefined;
    case 'matching':
      return given.type === question.type ? QUESTION_TYPES.matching.grade(question, given) : undefined;
    case 'free-recall':
      return given.type === question.type ? QUESTION_TYPES['free-recall'].grade(question, given) : undefined;
    default: {
      const unknown: never = question;
      return unknown;
    }
  }
}

export function expected(question: Question): ExpectedAnswer {
  switch (question.type) {
    case 'single-choice':
      return QUESTION_TYPES['single-choice'].expected(question);
    case 'multiple-choice':
      return QUESTION_TYPES['multiple-choice'].expected(question);
    case 'true-false':
      return QUESTION_TYPES['true-false'].expected(question);
    case 'numeric':
      return QUESTION_TYPES.numeric.expected(question);
    case 'short-text':
      return QUESTION_TYPES['short-text'].expected(question);
    case 'ordering':
      return QUESTION_TYPES.ordering.expected(question);
    case 'matching':
      return QUESTION_TYPES.matching.expected(question);
    case 'free-recall':
      return QUESTION_TYPES['free-recall'].expected(question);
    default: {
      const unknown: never = question;
      return unknown;
    }
  }
}

/** How many options the learner chooses among, for the learning record: what a guess would have to pick from. Undefined for a type with none. */
export function optionsOf(question: Question): number | undefined {
  switch (question.type) {
    case 'single-choice':
    case 'multiple-choice':
      return question.options.length;
    case 'true-false':
      return 2;
    case 'ordering':
      return question.items.length;
    case 'matching':
      return question.pairs.length;
    case 'numeric':
    case 'short-text':
    case 'free-recall':
      return undefined;
    default: {
      const unknown: never = question;
      return unknown;
    }
  }
}
