import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { translate, translateCount, type CountedKey, type Language, type MessageKey } from '../i18n/index.js';

export interface I18n {
  readonly language: Language;
  readonly t: (key: MessageKey, values?: Readonly<Record<string, string>>) => string;
  readonly tc: (key: CountedKey, count: number) => string;
  /** Names joined the way the language joins a list: "A, B och C". */
  readonly list: (items: readonly string[]) => string;
}

const I18nContext = createContext<I18n | undefined>(undefined);

export function I18nProvider({ language, children }: { readonly language: Language; readonly children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    const listFormat = new Intl.ListFormat(language, { type: 'conjunction' });
    return {
      language,
      t: (key, values) => translate(language, key, values),
      tc: (key, count) => translateCount(language, key, count),
      list: (items) => listFormat.format(items),
    };
  }, [language]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (value === undefined) {
    throw new Error('useI18n is used outside an I18nProvider');
  }
  return value;
}
