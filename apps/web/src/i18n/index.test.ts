import { describe, expect, it } from 'vitest';
import { catalogues, isLanguage, languages, translate } from './index.js';

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
    expect(translate('en', 'status.ok', { modules: 'notes, review' })).toBe('The server is up. Loaded modules: notes, review.');
  });

  it('leaves a placeholder visible when its value is missing', () => {
    expect(translate('en', 'status.ok')).toBe('The server is up. Loaded modules: {modules}.');
  });
});

describe('isLanguage', () => {
  it('accepts the shipped languages and nothing else', () => {
    expect(['sv', 'en', 'de', '', null, 'toString'].filter(isLanguage)).toEqual(['sv', 'en']);
  });
});
