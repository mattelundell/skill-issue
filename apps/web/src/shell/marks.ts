/**
 * Finding the words another module marks in a lesson's text, such as glossary
 * terms. A form is found from the start of a word, whatever its capitals, with
 * a Swedish ending allowed after it — "balanstemperaturen" names
 * "balanstemperatur" — but never inside a longer word: a compound is a concept
 * of its own, so "effektsignatur" does not name "effekt". Each mark is found
 * once, the first time it appears, so a step is not strewn with the same mark.
 */

/** A piece of text: either as written, or a found mark with the words that named it. */
export type Segment = string | { readonly mark: number; readonly text: string };

export interface Matcher {
  /** Splits `text` at the marks found in it, skipping every mark already in `marked` and adding each one found. */
  find(text: string, marked: Set<number>): readonly Segment[];
}

/**
 * Endings a Swedish noun or adjective takes after its written form, longest
 * first: definite, plural and genitive. After an abbreviation they follow a
 * colon, as in "COP:n".
 */
const ENDINGS = ['ernas', 'arnas', 'ornas', 'erna', 'arna', 'orna', 'ens', 'ets', 'ers', 'nas', 'rna', 'en', 'et', 'er', 'ar', 'or', 'na', 'ns', 'ts', 'es', 'n', 't', 's', 'r', 'e', 'a'];

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compileMarks(marks: readonly { readonly forms: readonly string[] }[]): Matcher {
  const forms = marks
    .flatMap(({ forms: written }, mark) => written.filter((form) => form.trim() !== '').map((form) => ({ mark, form })))
    // Longest first, so "tempererad area" is tried before "area" at the same place.
    .toSorted((a, b) => b.form.length - a.form.length);
  if (forms.length === 0) {
    return { find: (text) => (text === '' ? [] : [text]) };
  }
  const ending = `(?::?(?:${ENDINGS.join('|')}))?`;
  // A group per form, so the match says which form, and so which mark, it was.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.map(({ form }) => `(${escape(form)})`).join('|')})${ending}(?![\\p{L}\\p{N}])`, 'giu');

  return {
    find(text, marked) {
      const segments: Segment[] = [];
      let from = 0;
      for (const match of text.matchAll(pattern)) {
        const group = match.slice(1).findIndex((value) => value !== undefined);
        const mark = forms[group]?.mark;
        if (mark === undefined || marked.has(mark)) {
          continue;
        }
        marked.add(mark);
        if (match.index > from) {
          segments.push(text.slice(from, match.index));
        }
        segments.push({ mark, text: match[0] });
        from = match.index + match[0].length;
      }
      if (from < text.length) {
        segments.push(text.slice(from));
      }
      return segments;
    },
  };
}
