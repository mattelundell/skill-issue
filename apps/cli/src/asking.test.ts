import type { AskedQuestion, GivenAnswer } from '@skill-issue/contract';
import { describe, expect, it } from 'vitest';
import { parseAnswer } from './asking.js';

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
const ordering: AskedQuestion = { id: 'prefix-ordning', language: 'sv', type: 'ordering', prompt: 'Ordna från minst till störst.', items: ['MWh', 'kWh', 'GWh'] };
const matching: AskedQuestion = { id: 'prefix-par', language: 'sv', type: 'matching', prompt: 'Para ihop.', lefts: ['kilo', 'mega'], rights: ['miljon', 'tusen'] };
const recall: AskedQuestion = { id: 'forklara-balans', language: 'sv', type: 'free-recall', prompt: 'Förklara energibalans.', answer: 'In = ut.' };
const truth: AskedQuestion = { id: 'effekt-ar-takt', language: 'sv', type: 'true-false', prompt: 'Effekt är en takt.' };
const median: AskedQuestion = { id: 'median', language: 'en', type: 'numeric', prompt: 'The median of 1, 2, 9?', unit: '' };

describe('reading an answer typed in the terminal', () => {
  it.each<[string, AskedQuestion, string, GivenAnswer]>([
    ['an option by its number', single, '2', { type: 'single-choice', option: 'b' }],
    ['several options by number, in any separators', { ...single, type: 'multiple-choice' }, '3, 1', { type: 'multiple-choice', options: ['c', 'a'] }],
    ['true by its number', truth, '1', { type: 'true-false', value: true }],
    ['false by its letter', truth, 'f', { type: 'true-false', value: false }],
    ['a number with a decimal comma and a space between thousands', median, '1 200,5', { type: 'numeric', value: 1200.5 }],
    ['typed text as typed, trimmed', { id: 'kilo', language: 'sv', type: 'short-text', prompt: 'Kilo?' }, '  tusen ', { type: 'short-text', text: 'tusen' }],
    ['an order as the items’ numbers', ordering, '2 1 3', { type: 'ordering', items: ['kWh', 'MWh', 'GWh'] }],
    ['a matching as one letter for each left, in order', matching, 'b a', { type: 'matching', pairs: [{ left: 'kilo', right: 'tusen' }, { left: 'mega', right: 'miljon' }] }],
    ['whether free recall was known', recall, 'y', { type: 'free-recall', knew: true }],
  ])('reads %s', (_case, question, typed, given) => {
    expect(parseAnswer(question, typed)).toEqual({ ok: true, value: given });
  });

  it.each<[string, AskedQuestion, string, string]>([
    ['an option number out of range', single, '4', 'Type the number of an option, 1 to 3.'],
    ['a word for an option', single, 'kW', 'Type the number of an option, 1 to 3.'],
    ['an option twice', { ...single, type: 'multiple-choice' }, '1 1', 'Type each option’s number once, 1 to 3.'],
    ['no option at all', { ...single, type: 'multiple-choice' }, '', 'Type the numbers of the options you choose, 1 to 3.'],
    ['something neither true nor false', truth, 'kanske', 'Type 1 for true or 2 for false.'],
    ['something not a number', median, 'tolv', 'Type a number; a decimal comma or point is fine.'],
    ['nothing for typed text', { id: 'kilo', language: 'sv', type: 'short-text', prompt: 'Kilo?' }, '   ', 'Type an answer.'],
    ['an order that leaves an item out', ordering, '2 1', 'Type every item’s number once, in the order you put them: 1 to 3.'],
    ['a matching that pairs one right twice', matching, 'a a', 'Type one letter for each of the 2 on the left, each letter once: a to b.'],
    ['neither yes nor no', recall, 'kanske', 'Type y if you knew it, n if not.'],
  ])('refuses %s, saying what to type', (_case, question, typed, message) => {
    expect(parseAnswer(question, typed)).toEqual({ ok: false, error: message });
  });
});
