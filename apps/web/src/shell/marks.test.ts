import { describe, expect, it } from 'vitest';
import { compileMarks, type Segment } from './marks.js';

const find = (forms: readonly (readonly string[])[], text: string, marked = new Set<number>()): readonly Segment[] =>
  compileMarks(forms.map((f) => ({ forms: f }))).find(text, marked);

describe('finding marked words in text', () => {
  it('finds a term written as it is, keeping the text’s own capitals', () => {
    expect(find([['Graddagar']], 'SMHI räknar graddagar per ort.')).toEqual(['SMHI räknar ', { mark: 0, text: 'graddagar' }, ' per ort.']);
  });

  it('finds a term with a Swedish ending after it, the way a sentence inflects it', () => {
    expect(find([['Balanstemperatur']], 'Under balanstemperaturen behövs värme.')).toEqual(['Under ', { mark: 0, text: 'balanstemperaturen' }, ' behövs värme.']);
    expect(find([['Graddagar']], 'Graddagarna kommer från SMHI.')).toEqual([{ mark: 0, text: 'Graddagarna' }, ' kommer från SMHI.']);
    expect(find([['Energisignatur']], 'Energisignaturens lutning.')).toEqual([{ mark: 0, text: 'Energisignaturens' }, ' lutning.']);
  });

  it('finds an abbreviation inflected after a colon', () => {
    expect(find([['COP']], 'COP:n är 3.')).toEqual([{ mark: 0, text: 'COP:n' }, ' är 3.']);
  });

  it('does not find a term inside another word, at its start or its end', () => {
    // A compound is its own concept: "effektsignatur" is not "effekt", and SCOP is not COP.
    expect(find([['Effekt']], 'En effektsignatur.')).toEqual(['En effektsignatur.']);
    expect(find([['COP']], 'Värmepumpens SCOP.')).toEqual(['Värmepumpens SCOP.']);
    expect(find([['area']], 'Bruttoarean.')).toEqual(['Bruttoarean.']);
  });

  it('finds a term through any of its other names, and the longest name where two start at the same place', () => {
    const forms = [['Atemp', 'tempererad area'], ['area']];
    // "tempererade" is not the form "tempererad area", so the shorter "area" is what names "arean" here.
    expect(find(forms, 'Den tempererade arean, alltså Atemp.')).toEqual(['Den tempererade ', { mark: 1, text: 'arean' }, ', alltså ', { mark: 0, text: 'Atemp' }, '.']);
    expect(find(forms, 'Den tempererad arean är stor.')).toEqual(['Den ', { mark: 0, text: 'tempererad arean' }, ' är stor.']);
  });

  it('finds each term once: the first time it appears, across every piece of text that shares the record', () => {
    const marked = new Set<number>();
    const matcher = compileMarks([{ forms: ['Effekt'] }, { forms: ['Energi'] }]);
    expect(matcher.find('Effekt är energi per tid. Effekt mäts i watt.', marked)).toEqual([
      { mark: 0, text: 'Effekt' },
      ' är ',
      { mark: 1, text: 'energi' },
      ' per tid. Effekt mäts i watt.',
    ]);
    expect(matcher.find('Mer om effekt och energi.', marked)).toEqual(['Mer om effekt och energi.']);
  });

  it('reads letters beyond a–z as letters, so å, ä and ö do not end a word', () => {
    expect(find([['Värme']], 'Värmeåtervinning och värmen.')).toEqual(['Värmeåtervinning och ', { mark: 0, text: 'värmen' }, '.']);
  });

  it('treats a form’s characters literally, not as a pattern', () => {
    expect(find([['U.värde']], 'Ett Uxvärde och ett U.värde.')).toEqual(['Ett Uxvärde och ett ', { mark: 0, text: 'U.värde' }, '.']);
  });

  it('gives the text back whole when there is nothing to mark', () => {
    expect(find([], 'Ingenting här.')).toEqual(['Ingenting här.']);
    expect(find([['Effekt']], '')).toEqual([]);
  });
});
