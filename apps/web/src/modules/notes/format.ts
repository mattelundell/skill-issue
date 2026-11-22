/**
 * Markdown written around what the learner selected, as a formatting bar does
 * it. Pure, so what each button does is decided here and tested here; the bar
 * only applies the change through the browser's own editing, so ⌘Z undoes it.
 */

export type Format = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'block' | 'ol' | 'ul' | 'quote' | 'h1' | 'h2' | 'p';

/** A change: replace `from`–`to` with `text`, then select `selectStart`–`selectEnd` in the text that results. */
export interface Change {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly selectStart: number;
  readonly selectEnd: number;
}

const WRAP: Readonly<Partial<Record<Format, string>>> = { bold: '**', italic: '*', strike: '~~', code: '`' };

/** A line's own marker: a heading, a quote, a bullet or a number. */
const MARKER = /^(#{1,6}\s+|>\s?|[-*]\s|\d+\.\s)/;
const HAS: Readonly<Partial<Record<Format, RegExp>>> = { ul: /^[-*]\s/, ol: /^\d+\.\s/, quote: /^>\s?/ };

/** The word around a caret, when nothing is selected; the caret itself when it is not in a word. */
function wordAround(text: string, at: number): readonly [number, number] {
  const before = /\S+$/.exec(text.slice(0, at));
  const after = /^\S+/.exec(text.slice(at));
  return [at - (before?.[0].length ?? 0), at + (after?.[0].length ?? 0)];
}

function wrapped(text: string, start: number, end: number, marks: string, italic: boolean): Change {
  const [from, to] = start === end ? wordAround(text, start) : [start, end];
  const inner = text.slice(from, to);
  const size = marks.length;
  // Italic's star is also half of bold's: a word in bold is not taken out of it by asking for italic.
  const inBold = italic && text.slice(from - 2, from) === '**' && text.slice(from - 3, from) !== '***';
  if (!inBold && text.slice(from - size, from) === marks && text.slice(to, to + size) === marks) {
    return { from: from - size, to: to + size, text: inner, selectStart: from - size, selectEnd: to - size };
  }
  if (inner.length >= 2 * size && inner.startsWith(marks) && inner.endsWith(marks) && !(italic && inner.startsWith('**'))) {
    const bare = inner.slice(size, -size);
    return { from, to, text: bare, selectStart: from, selectEnd: from + bare.length };
  }
  return { from, to, text: `${marks}${inner}${marks}`, selectStart: from + size, selectEnd: to + size };
}

/** The change a button or key makes to `text` with `start`–`end` selected. */
export function formatted(text: string, start: number, end: number, kind: Format): Change {
  const marks = WRAP[kind];
  if (marks !== undefined) {
    return wrapped(text, start, end, marks, kind === 'italic');
  }
  if (kind === 'link') {
    const label = text.slice(start, end);
    const link = `[${label}](https://)`;
    // With a label, the address is selected to be typed over; without one, the caret goes where the label is written.
    return label === ''
      ? { from: start, to: end, text: link, selectStart: start + 1, selectEnd: start + 1 }
      : { from: start, to: end, text: link, selectStart: start + label.length + 3, selectEnd: start + link.length - 1 };
  }
  if (kind === 'block') {
    const inner = text.slice(start, end);
    return { from: start, to: end, text: `\`\`\`\n${inner}\n\`\`\``, selectStart: start + 4, selectEnd: start + 4 + inner.length };
  }

  // Every line the selection touches.
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const next = text.indexOf('\n', end);
  const to = next === -1 ? text.length : next;
  const lines = text.slice(from, to).split('\n');
  let out: string;
  if (kind === 'h1' || kind === 'h2' || kind === 'p') {
    // A heading replaces whatever marks the line; body text takes off a heading only, and leaves a list or a quote as it is.
    out = lines.map((line) => (kind === 'p' ? line.replace(/^#{1,6}\s+/, '') : `${kind === 'h1' ? '#' : '##'} ${line.replace(MARKER, '')}`)).join('\n');
  } else {
    const has = HAS[kind] ?? /$^/;
    const on = !lines.every((line) => has.test(line));
    const marker = (index: number): string => (kind === 'ol' ? `${index + 1}. ` : kind === 'ul' ? '- ' : '> ');
    out = lines.map((line, index) => (on ? `${marker(index)}${line.replace(MARKER, '')}` : line.replace(MARKER, ''))).join('\n');
  }
  return { from, to, text: out, selectStart: from, selectEnd: from + out.length };
}

/** Whether the line the caret is on is a heading, a subheading or body text, for the bar to show. */
export function lineKind(text: string, at: number): 'h1' | 'h2' | 'p' {
  const from = text.lastIndexOf('\n', at - 1) + 1;
  const next = text.indexOf('\n', from);
  const line = text.slice(from, next === -1 ? text.length : next);
  return /^##\s/.test(line) ? 'h2' : /^#\s/.test(line) ? 'h1' : 'p';
}
