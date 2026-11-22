import { describe, expect, it } from 'vitest';
import { formatted, lineKind, type Format } from './format.js';

/** The text after a change, with the selection after it marked by [ and ]. */
function apply(text: string, kind: Format): string {
  const start = text.indexOf('[');
  const end = text.indexOf(']') - 1;
  const plain = text.replace('[', '').replace(']', '');
  const change = formatted(plain, start, end, kind);
  const after = plain.slice(0, change.from) + change.text + plain.slice(change.to);
  return `${after.slice(0, change.selectStart)}[${after.slice(change.selectStart, change.selectEnd)}]${after.slice(change.selectEnd)}`;
}

describe('marking up the selected text', () => {
  it('wraps the selection, and the same again takes the marks off', () => {
    expect(apply('Lutningen är [förlustfaktorn] per grad', 'bold')).toBe('Lutningen är **[förlustfaktorn]** per grad');
    expect(apply('Lutningen är **[förlustfaktorn]** per grad', 'bold')).toBe('Lutningen är [förlustfaktorn] per grad');
    expect(apply('Lutningen är [**förlustfaktorn**] per grad', 'bold')).toBe('Lutningen är [förlustfaktorn] per grad');
  });

  it('marks italic, struck-through text and code each with its own marks', () => {
    expect(apply('[ord]', 'italic')).toBe('*[ord]*');
    expect(apply('[ord]', 'strike')).toBe('~~[ord]~~');
    expect(apply('[ord]', 'code')).toBe('`[ord]`');
  });

  it('does not take the bold off a word when asked for italic, though bold also begins with a star', () => {
    expect(apply('**[ord]**', 'italic')).toBe('***[ord]***');
  });

  it('marks the word under the caret when nothing is selected', () => {
    expect(apply('en brytp[]unkt här', 'bold')).toBe('en **[brytpunkt]** här');
  });

  it('makes a link of the selection, with the address selected to be typed', () => {
    expect(apply('se [Boverket] om det', 'link')).toBe('se [Boverket]([https://]) om det');
    expect(apply('se [] om det', 'link')).toBe('se [[]](https://) om det');
  });

  it('puts a fenced code block around the selection', () => {
    expect(apply('[a = 1]', 'block')).toBe('```\n[a = 1]\n```');
  });
});

describe('marking up whole lines', () => {
  it('numbers every line the selection touches, and takes the numbers off again', () => {
    expect(apply('fö[rsta\nan]dra\ntredje', 'ol')).toBe('[1. första\n2. andra]\ntredje');
    expect(apply('[1. första\n2. andra]', 'ol')).toBe('[första\nandra]');
  });

  it('turns a numbered list into bullets rather than adding bullets to it', () => {
    expect(apply('[1. första\n2. andra]', 'ul')).toBe('[- första\n- andra]');
  });

  it('quotes the lines, and unquotes them', () => {
    expect(apply('[ett\ntvå]', 'quote')).toBe('[> ett\n> två]');
    expect(apply('[> ett\n> två]', 'quote')).toBe('[ett\ntvå]');
  });

  it('makes a heading of a list line by replacing its marker, and body text takes off only the heading', () => {
    expect(apply('- Lut[]ningen', 'h1')).toBe('[# Lutningen]');
    expect(apply('## Lut[]ningen', 'h1')).toBe('[# Lutningen]');
    expect(apply('# Lut[]ningen', 'p')).toBe('[Lutningen]');
    expect(apply('- Lut[]ningen', 'p')).toBe('[- Lutningen]');
  });
});

describe('the kind of the line the caret is on', () => {
  it('is a heading, a subheading or body text', () => {
    expect(lineKind('text\n# Rubrik\nmer', 8)).toBe('h1');
    expect(lineKind('## Under', 3)).toBe('h2');
    expect(lineKind('- lista', 3)).toBe('p');
  });
});
