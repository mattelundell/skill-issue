import { describe, expect, it } from 'vitest';
import { catalogues, isLanguage, languageName, languages, translate, translateCount } from './index.js';

const placeholders = (text: string): readonly string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[0]).toSorted();

describe('catalogues', () => {
  it.each(languages)('%s has no empty message', (language) => {
    const empty = Object.entries(catalogues[language]).filter(([, text]) => text.trim() === '');
    expect(empty).toEqual([]);
  });

  it.each(languages)('%s uses the same placeholders as Swedish in every message', (language) => {
    const differing = Object.keys(catalogues.sv).filter((key) => {
      const k = key as keyof typeof catalogues.sv;
      return placeholders(catalogues[language][k]).join() !== placeholders(catalogues.sv[k]).join();
    });
    expect(differing).toEqual([]);
  });
});

describe('translate', () => {
  it('returns the message in the asked language', () => {
    expect(translate('sv', 'start.empty.title')).toBe('Inga ämnen än');
    expect(translate('en', 'start.empty.title')).toBe('No subjects yet');
  });

  it('fills in named values', () => {
    expect(translate('en', 'start.open.label', { subject: 'Statistics' })).toBe('Open: Statistics');
  });

  it('leaves a placeholder visible when its value is missing', () => {
    expect(translate('en', 'start.open.label')).toBe('Open: {subject}');
  });
});

describe('isLanguage', () => {
  it('accepts the shipped languages and nothing else', () => {
    expect(['sv', 'en', 'de', '', null, 'toString'].filter(isLanguage)).toEqual(['sv', 'en']);
  });
});

describe('translateCount', () => {
  it('takes the singular form for one and the plural for every other count, zero included', () => {
    expect([0, 1, 2].map((count) => translateCount('sv', 'home.areas', count))).toEqual(['0 områden', '1 område', '2 områden']);
    expect(translateCount('en', 'home.areas', 1)).toBe('1 area');
  });
});

describe('languageName', () => {
  it('names a language in that language, and falls back to the code for one Intl cannot name', () => {
    expect(['sv', 'en', 'not a code'].map(languageName)).toEqual(['svenska', 'English', 'not a code']);
  });
});
