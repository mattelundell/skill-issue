/**
 * Search in the source library. A query matches at the start of a word, so
 * "etal" finds Etal and not the middle of "återbetalningstid": a reader
 * searching for a term wants the term, and substring matches on Swedish
 * compounds bury it.
 */

const escaped = (query: string): string => query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where `query` starts a word in `text`, ignoring case; -1 when it does not. */
export function findAt(text: string, query: string): number {
  if (query === '') {
    return -1;
  }
  const match = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped(query)}`, 'iu').exec(text);
  return match === null ? -1 : match.index + (match[1]?.length ?? 0);
}

/**
 * The part of `text` around the first match, about `reach` characters each way,
 * cut at spaces and marked with an ellipsis where text was left out.
 */
export function snippet(text: string, query: string, reach: number): string | undefined {
  const at = findAt(text, query);
  if (at < 0) {
    return undefined;
  }
  const from = at - reach <= 0 ? 0 : text.indexOf(' ', at - reach) + 1;
  const end = at + query.length + reach;
  const spaceAfter = text.indexOf(' ', end);
  const to = end >= text.length || spaceAfter < 0 ? text.length : spaceAfter;
  return `${from > 0 ? '… ' : ''}${text.slice(from, to).trim()}${to < text.length ? ' …' : ''}`;
}
