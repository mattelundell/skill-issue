import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown, plainText } from './markdown.js';

const drawn = (source: string): HTMLElement => render(<Markdown source={source} imageText={(alt) => `[Bild: ${alt}]`} />).container;

describe('Markdown', () => {
  it('draws headings, emphasis, lists and tables', () => {
    const html = drawn('## Faktorer\n\nEl är **1,8**.\n\n- a\n- b\n\n| Bärare | Faktor |\n|---|---|\n| El | 1,8 |\n').innerHTML;
    expect(html).toContain('<h2>Faktorer</h2>');
    expect(html).toContain('<strong>1,8</strong>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<td>El</td>');
  });

  it('draws raw HTML as text, never as markup', () => {
    const container = drawn('Före <script>alert(1)</script> <img src=x onerror=alert(1)> efter');
    expect(container.querySelector('script, img')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('opens a web link in a new tab without handing it this page', () => {
    const link = drawn('Se [Boverket](https://www.boverket.se/).').querySelector('a');
    expect([link?.getAttribute('href'), link?.getAttribute('target'), link?.getAttribute('rel')]).toEqual(['https://www.boverket.se/', '_blank', 'noopener noreferrer']);
  });

  it('refuses a script link, leaving its text', () => {
    const container = drawn('[klicka](javascript:alert(1))');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('klicka');
  });

  it('shows an image as its text until the application can serve it', () => {
    const container = drawn('![Energiflöde](assets/energiflode.png)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent?.trim()).toBe('[Bild: Energiflöde]');
  });
});

describe('plainText', () => {
  it('gives the words of the Markdown without its markup, one block per line', () => {
    expect(plainText('## Rubrik\n\nEtt **fett** ord och `kod`.\n\n- punkt')).toBe('Rubrik\nEtt fett ord och kod.\npunkt');
  });
});
