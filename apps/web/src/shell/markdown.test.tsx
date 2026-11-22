import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TextMark } from './contract.js';
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

const MARKS: readonly TextMark[] = [
  { id: 'effekt', forms: ['Effekt', 'power'], card: <p>Energi per tidsenhet.</p> },
  { id: 'energi', forms: ['Energi'], card: <p>Förmågan att uträtta arbete.</p> },
];

const marked = (source: string, marks: readonly TextMark[] = MARKS): HTMLElement =>
  render(<Markdown source={source} subjectId="example-subject" imageText={(alt) => alt} marks={marks} />).container;

const marksIn = (container: HTMLElement): readonly string[] => [...container.querySelectorAll('button.term')].map((mark) => mark.textContent ?? '');

describe('Markdown with marks', () => {
  it('marks each term the first time the text names it, and nowhere after, keeping the words as written', () => {
    const container = marked('**Effekten** är hur fort energi används.\n\nEnergi och effekt igen.');

    expect(marksIn(container)).toEqual(['Effekten', 'energi']);
    expect(container.textContent).toBe('Effekten är hur fort energi används.\nEnergi och effekt igen.\n');
    expect(container.querySelector('strong button.term')).not.toBeNull();
  });

  it('marks nothing in a heading, a link or code, and takes the first mention outside them', () => {
    const container = marked('## Effekt\n\nSe [energi hos Boverket](https://www.boverket.se/) och `Effekt = E/t`, sedan effekt och energi.');

    expect(marksIn(container)).toEqual(['effekt', 'energi']);
    expect(container.querySelector('h2 button, a button, code button')).toBeNull();
  });

  it('marks nothing when no module marks words, and nothing in text that names none of them', () => {
    expect(marksIn(drawn('Effekt och energi.'))).toEqual([]);
    expect(marksIn(marked('Watt och joule.'))).toEqual([]);
  });

  it('draws marked words as text, never as markup, however a form is written', () => {
    const container = marked('Ett <b>x</b> här.', [{ id: 'b', forms: ['<b>x</b>'], card: <p>B.</p> }]);

    expect(container.querySelector('b')).toBeNull();
    expect(marksIn(container)).toEqual(['<b>x</b>']);
  });

  it('shows a mark’s card while the pointer is on it or its card, and closes it once the pointer has left both', async () => {
    vi.useFakeTimers();
    try {
      const container = marked('Effekt är energi per tid.');
      const mark = screen.getByRole('button', { name: 'Effekt' });

      fireEvent.pointerOver(mark);
      expect(screen.getByText('Energi per tidsenhet.')).toBeTruthy();
      expect(mark.getAttribute('aria-expanded')).toBe('true');
      expect(container.querySelectorAll('.term-card')).toHaveLength(1);

      fireEvent.pointerOut(mark);
      fireEvent.pointerOver(screen.getByText('Energi per tidsenhet.'));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('Energi per tidsenhet.')).toBeTruthy();

      fireEvent.pointerOut(screen.getByText('Energi per tidsenhet.'));
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText('Energi per tidsenhet.')).toBeNull();
      expect(mark.getAttribute('aria-expanded')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens a card from the keyboard, ties it to its mark, and closes it with Escape, back on the mark', async () => {
    marked('Effekt är energi per tid.');
    const user = userEvent.setup();

    await user.tab();
    const mark = screen.getByRole('button', { name: 'Effekt' });
    expect(document.activeElement).toBe(mark);
    const card = screen.getByText('Energi per tidsenhet.').closest('.term-card');
    expect(card?.id).toBe(mark.getAttribute('aria-controls'));

    await user.keyboard('{Escape}');
    expect(screen.queryByText('Energi per tidsenhet.')).toBeNull();
    expect(document.activeElement).toBe(mark);
  });

  it('lets the keyboard into a card and back: Tab reaches a link in it, Escape closes it and returns the focus to its mark', async () => {
    // A second mark later in the text: Tab from the first must reach its card before the next mark.
    marked('Effekt är energi.', [
      { id: 'effekt', forms: ['Effekt'], card: <p>Se <a href="/subjects/example-subject/reader/exempelkalla">Exempelkälla</a>.</p> },
      { id: 'energi', forms: ['Energi'], card: <p>Förmågan att uträtta arbete.</p> },
    ]);
    const user = userEvent.setup();

    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Exempelkälla' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('link', { name: 'Exempelkälla' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Effekt' }));
  });

  it('keeps a card open once its mark is clicked, until it is clicked again, and shows one card at a time', async () => {
    vi.useFakeTimers();
    try {
      marked('Effekt är energi per tid.');
      const effekt = screen.getByRole('button', { name: 'Effekt' });

      fireEvent.click(effekt);
      fireEvent.pointerOut(effekt);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('Energi per tidsenhet.')).toBeTruthy();

      // Passing over another mark does not replace a card the learner clicked open.
      fireEvent.pointerOver(screen.getByRole('button', { name: 'energi' }));
      expect(screen.getByText('Energi per tidsenhet.')).toBeTruthy();
      expect(screen.queryByText('Förmågan att uträtta arbete.')).toBeNull();
      fireEvent.pointerOut(screen.getByRole('button', { name: 'energi' }));

      fireEvent.click(screen.getByRole('button', { name: 'energi' }));
      expect(screen.queryByText('Energi per tidsenhet.')).toBeNull();
      expect(screen.getByText('Förmågan att uträtta arbete.')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'energi' }));
      expect(screen.queryByText('Förmågan att uträtta arbete.')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('plainText', () => {
  it('gives the words of the Markdown without its markup, one block per line', () => {
    expect(plainText('## Rubrik\n\nEtt **fett** ord och `kod`.\n\n- punkt')).toBe('Rubrik\nEtt fett ord och kod.\npunkt');
  });
});
