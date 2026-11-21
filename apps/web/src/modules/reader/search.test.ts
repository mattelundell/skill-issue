import { describe, expect, it } from 'vitest';
import { findAt, snippet } from './search.js';

describe('findAt', () => {
  it('finds the query at the start of a word, in any case, and not inside one', () => {
    expect(findAt('Energiprestandatal (Etal)', 'etal')).toBe(20);
    expect(findAt('Etal tas fram', 'ETAL')).toBe(0);
    expect(findAt('återbetalningstid', 'etal')).toBe(-1);
  });

  it('treats letters outside a–z as letters, so a word starting after å is not split', () => {
    expect(findAt('Mätmetoder', 'tmetoder')).toBe(-1);
    expect(findAt('om mätning', 'mät')).toBe(3);
  });

  it('takes the query literally, not as a pattern', () => {
    expect(findAt('kWh/m² (Atemp)', '(atemp')).toBe(7);
    expect(findAt('anything', '.*')).toBe(-1);
  });

  it('finds nothing for an empty query', () => {
    expect(findAt('text', '')).toBe(-1);
  });
});

describe('snippet', () => {
  it('cuts the text around the match at word boundaries, marking what was left out', () => {
    const text = 'Föreskriften ersätter BBR:s energikapitel. Det nya måttet är energiprestandatal, Etal, byggnadens energianvändning viktad per energibärare och delad med Atemp.';
    expect(snippet(text, 'etal', 30)).toBe('… är energiprestandatal, Etal, byggnadens energianvändning viktad …');
  });

  it('keeps a short text whole', () => {
    expect(snippet('Om att mäta energi.', 'mäta', 30)).toBe('Om att mäta energi.');
  });

  it('gives undefined when the query is not in the text', () => {
    expect(snippet('Om att mäta energi.', 'radon', 30)).toBeUndefined();
  });
});
