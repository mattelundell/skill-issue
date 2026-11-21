import type { GivenAnswer, Question } from '@skill-issue/contract';
import { describe, expect, it } from 'vitest';
import { ask, expected, grade, type Shuffle } from './types.js';

const base = { language: 'sv', lesson: 'energi-och-effekt', concepts: ['effekt'], sources: ['exempelkalla'], prompt: 'Fråga?', explanation: 'Därför.' };

const QUESTIONS = {
  single: { ...base, id: 'single', type: 'single-choice', options: [{ id: 'a', text: 'kWh' }, { id: 'b', text: 'kW' }], answer: 'b' },
  multiple: { ...base, id: 'multiple', type: 'multiple-choice', options: [{ id: 'a', text: 'Fönster' }, { id: 'b', text: 'Ventilation' }, { id: 'c', text: 'Elmätaren' }], answer: ['a', 'b'] },
  trueFalse: { ...base, id: 'tf', type: 'true-false', answer: true },
  numeric: { ...base, id: 'numeric', type: 'numeric', answer: { value: 6, unit: 'kWh', tolerance: 0.5 } },
  shortText: { ...base, id: 'short', type: 'short-text', accepted: ['Atemp', 'tempererad area'], caseSensitive: false },
  ordering: { ...base, id: 'ordering', type: 'ordering', items: ['kilo', 'mega', 'giga'] },
  matching: { ...base, id: 'matching', type: 'matching', pairs: [{ left: 'k', right: '10³' }, { left: 'M', right: '10⁶' }] },
  freeRecall: { ...base, id: 'recall', type: 'free-recall', answer: 'Tillförd energi är lika med bortförd, över tid.' },
} as const satisfies Record<string, Question>;

/** Every type answered right and wrong, with the edge each grading rule exists for. */
const CASES: readonly (readonly [string, Question, GivenAnswer, boolean])[] = [
  ['single right', QUESTIONS.single, { type: 'single-choice', option: 'b' }, true],
  ['single wrong', QUESTIONS.single, { type: 'single-choice', option: 'a' }, false],
  ['multiple right, in any order', QUESTIONS.multiple, { type: 'multiple-choice', options: ['b', 'a'] }, true],
  ['multiple missing one', QUESTIONS.multiple, { type: 'multiple-choice', options: ['a'] }, false],
  ['multiple with one too many', QUESTIONS.multiple, { type: 'multiple-choice', options: ['a', 'b', 'c'] }, false],
  ['multiple with one named twice', QUESTIONS.multiple, { type: 'multiple-choice', options: ['a', 'a'] }, false],
  ['true-false right', QUESTIONS.trueFalse, { type: 'true-false', value: true }, true],
  ['true-false wrong', QUESTIONS.trueFalse, { type: 'true-false', value: false }, false],
  ['numeric exact', QUESTIONS.numeric, { type: 'numeric', value: 6 }, true],
  ['numeric at the edge of the tolerance', QUESTIONS.numeric, { type: 'numeric', value: 6.5 }, true],
  ['numeric just outside it', QUESTIONS.numeric, { type: 'numeric', value: 6.51 }, false],
  ['short text, other case and spacing', QUESTIONS.shortText, { type: 'short-text', text: '  Tempererad   AREA ' }, true],
  ['short text wrong', QUESTIONS.shortText, { type: 'short-text', text: 'Atemp2' }, false],
  ['ordering right', QUESTIONS.ordering, { type: 'ordering', items: ['kilo', 'mega', 'giga'] }, true],
  ['ordering wrong', QUESTIONS.ordering, { type: 'ordering', items: ['mega', 'kilo', 'giga'] }, false],
  ['matching right, pairs in any order', QUESTIONS.matching, { type: 'matching', pairs: [{ left: 'M', right: '10⁶' }, { left: 'k', right: '10³' }] }, true],
  ['matching crossed', QUESTIONS.matching, { type: 'matching', pairs: [{ left: 'k', right: '10⁶' }, { left: 'M', right: '10³' }] }, false],
  ['free recall known', QUESTIONS.freeRecall, { type: 'free-recall', knew: true }, true],
  ['free recall not known', QUESTIONS.freeRecall, { type: 'free-recall', knew: false }, false],
];

describe('grading', () => {
  it.each(CASES)('%s', (_name, question, given, right) => {
    expect(grade(question, given)).toBe(right);
  });

  it('refuses an answer of another type, rather than calling it wrong', () => {
    expect(grade(QUESTIONS.single, { type: 'true-false', value: true })).toBeUndefined();
  });

  it('grades a case-sensitive short text by its case', () => {
    const strict: Question = { ...QUESTIONS.shortText, accepted: ['Atemp'], caseSensitive: true };
    expect([grade(strict, { type: 'short-text', text: 'Atemp' }), grade(strict, { type: 'short-text', text: 'atemp' })]).toEqual([true, false]);
  });
});

const reverse: Shuffle = (values) => values.toReversed();
const keep: Shuffle = (values) => [...values];
const answerFields = (question: Question): string[] => Object.keys(ask(question, reverse)).filter((key) => ['answer', 'accepted', 'pairs', 'caseSensitive'].includes(key));

describe('asking', () => {
  it('sends no answer for any type but free recall, whose answer the learner sees before grading themselves', () => {
    expect(Object.fromEntries(Object.values(QUESTIONS).map((question) => [question.type, answerFields(question)]))).toEqual({
      'single-choice': [],
      'multiple-choice': [],
      'true-false': [],
      numeric: [],
      'short-text': [],
      ordering: [],
      matching: [],
      'free-recall': ['answer'],
    });
  });

  it('never asks an ordering question in its right order', () => {
    expect(ask(QUESTIONS.ordering, keep)).toMatchObject({ items: ['mega', 'giga', 'kilo'] });
    expect(ask(QUESTIONS.ordering, reverse)).toMatchObject({ items: ['giga', 'mega', 'kilo'] });
  });

  it('asks a matching question with both sides shuffled apart', () => {
    expect(ask(QUESTIONS.matching, reverse)).toEqual({ id: 'matching', language: 'sv', prompt: 'Fråga?', type: 'matching', lefts: ['M', 'k'], rights: ['10⁶', '10³'] });
  });

  it('shows the right answer of each type after answering', () => {
    expect(expected(QUESTIONS.numeric)).toEqual({ type: 'numeric', value: 6, unit: 'kWh', tolerance: 0.5 });
    expect(expected(QUESTIONS.multiple)).toEqual({ type: 'multiple-choice', options: ['a', 'b'] });
  });
});
