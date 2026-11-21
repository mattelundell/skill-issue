import { en } from './en.js';
import { sv, type Catalogue, type MessageKey } from './sv.js';

export type { MessageKey };

export const catalogues = { sv, en } as const satisfies Readonly<Record<string, Catalogue>>;
export type Language = keyof typeof catalogues;

export const languages: readonly Language[] = ['sv', 'en'];
export const defaultLanguage: Language = 'sv';

export function isLanguage(value: unknown): value is Language {
  // Own keys only: `in` would also accept names inherited from Object, such as "toString".
  return typeof value === 'string' && Object.hasOwn(catalogues, value);
}

/** The message for `key` in `language`, with each `{name}` replaced from `values`. */
export function translate(
  language: Language,
  key: MessageKey,
  values: Readonly<Record<string, string>> = {},
): string {
  return catalogues[language][key].replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}
