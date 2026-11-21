import { useMemo } from 'react';
import { languages, type Language } from '../i18n/index.js';
import { useI18n } from './i18n.js';

/**
 * A module's own interface text. Each module keeps its messages beside its
 * code, one catalogue per interface language, so removing the module removes
 * its text with it and the shell's catalogue names no module. A language left
 * out, or a key missing from one language, does not compile.
 */

export type Catalogues<K extends string> = Readonly<Record<Language, Readonly<Record<K, string>>>>;

/** Keys that come in a singular and a plural form, named by what they share. */
export type CountedKey<K extends string> = CountedIn<K, K>;
/** Each key is taken alone while its `.other` form is looked up among all of them. */
type CountedIn<Each extends string, All extends string> = Each extends `${infer Base}.one` ? (`${Base}.other` extends All ? Base : never) : never;

export interface Messages<K extends string> {
  /** The message for `key`, with each `{name}` replaced from `values`; a placeholder with no value stays visible. */
  readonly t: (key: K, values?: Readonly<Record<string, string>>) => string;
  /** The message for `count` things: the `.one` form for exactly one, the `.other` form otherwise. */
  readonly tc: (key: CountedKey<K>, count: number) => string;
}

const fill = (text: string, values: Readonly<Record<string, string>>): string =>
  text.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);

/** A hook giving a module's messages in the current interface language. */
export function defineMessages<K extends string>(catalogues: Catalogues<K>): () => Messages<K> {
  return function useMessages(): Messages<K> {
    const { language } = useI18n();
    return useMemo<Messages<K>>(() => {
      const catalogue = catalogues[language];
      // Read by any string: a counted key's forms are built from text, which the type checker cannot follow back to K.
      const byText: Readonly<Record<string, string | undefined>> = catalogue;
      return {
        t: (key, values = {}) => fill(catalogue[key], values),
        tc: (key, count) => {
          const form = count === 1 ? `${key}.one` : `${key}.other`;
          return fill(byText[form] ?? form, { count: String(count) });
        },
      };
    }, [language]);
  };
}

const placeholders = (text: string): string => [...text.matchAll(/\{\w+\}/g)].map((match) => match[0]).toSorted().join(' ');

/**
 * What is wrong with a module's catalogues, one line per message: empty in some
 * language, or with other placeholders than the Swedish, which defines them.
 */
export function catalogueFaults<K extends string>(catalogues: Catalogues<K>): readonly string[] {
  const swedishMessages: Readonly<Record<string, string>> = catalogues.sv;
  return languages.flatMap((language) => {
    const messages: Readonly<Record<string, string | undefined>> = catalogues[language];
    return Object.entries(swedishMessages).flatMap(([key, swedishText]) => {
      const text = messages[key] ?? '';
      if (text.trim() === '') {
        return [`${language} ${key}: empty`];
      }
      const own = placeholders(text);
      const swedish = placeholders(swedishText);
      return own === swedish ? [] : [`${language} ${key}: placeholders ${own} where Swedish has ${swedish}`];
    });
  });
}
