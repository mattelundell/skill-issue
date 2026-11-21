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

/** Keys that come in a singular and a plural form, named by what they share. */
export type CountedKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? (`${Base}.other` extends MessageKey ? Base : never) : never;
}[MessageKey];

/** The message for `count` things: the `.one` form for exactly one, the `.other` form otherwise. */
export function translateCount(language: Language, key: CountedKey, count: number): string {
  return translate(language, count === 1 ? `${key}.one` : `${key}.other`, { count: String(count) });
}

/**
 * A language's name as its own speakers write it — "svenska", "English" — so a
 * reader finds their language whatever the interface is set to. Falls back to the code.
 */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    // Not a code Intl knows: the code itself is the most honest name.
    return code;
  }
}
