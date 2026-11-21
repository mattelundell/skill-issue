import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown, plainText } from './markdown.js';

const drawn = (source: string): HTMLElement => render(<Markdown source={source} subjectId="example-subject" imageText={(alt) => `[Bild: ${alt}]`} />).container;

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

  it('draws an image from the subject’s files, with its description as alt text and its title as caption', () => {
    const container = drawn('![Energiflöde genom en byggnad](assets/energiflode.png "Effekt över ett dygn")');
    const image = container.querySelector('img');
    expect([image?.getAttribute('src'), image?.getAttribute('alt')]).toEqual(['/api/v1/content/subjects/example-subject/assets/energiflode.png', 'Energiflöde genom en byggnad']);
    expect(container.querySelector('.caption')?.textContent).toBe('Effekt över ett dygn');
  });

  it('shows an image from anywhere but the subject’s files as its text', () => {
    const container = drawn('![Logga](https://example.org/logga.png) ![Upp](assets/../subject.yaml)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent?.trim()).toBe('[Bild: Logga] [Bild: Upp]');
  });

  it('shows an image that cannot be fetched as its text', () => {
    const container = drawn('![Energiflöde](assets/energiflode.png)');
    const image = container.querySelector('img');
    expect(image).not.toBeNull();

    fireEvent.error(image as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent?.trim()).toBe('[Bild: Energiflöde]');
  });
});

describe('plainText', () => {
  it('gives the words of the Markdown without its markup, one block per line', () => {
    expect(plainText('## Rubrik\n\nEtt **fett** ord och `kod`.\n\n- punkt')).toBe('Rubrik\nEtt fett ord och kod.\npunkt');
  });
});
