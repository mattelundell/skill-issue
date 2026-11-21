import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from './i18n.js';
import { catalogueFaults, defineMessages } from './messages.js';

const catalogues = {
  sv: { 'greeting': 'Hej {name}', 'pages.one': '{count} sida', 'pages.other': '{count} sidor' },
  en: { 'greeting': 'Hello {name}', 'pages.one': '{count} page', 'pages.other': '{count} pages' },
} as const;
const useMessages = defineMessages(catalogues);

function Probe({ pages }: { readonly pages: number }) {
  const { t, tc } = useMessages();
  return (
    <p>
      {t('greeting', { name: 'Ada' })}, {tc('pages', pages)}
    </p>
  );
}

describe('a module’s own messages', () => {
  it('follow the interface language, fill in values, and take the singular for exactly one', () => {
    const { rerender } = render(
      <I18nProvider language="sv">
        <Probe pages={1} />
      </I18nProvider>,
    );
    expect(screen.getByText('Hej Ada, 1 sida')).toBeTruthy();

    rerender(
      <I18nProvider language="en">
        <Probe pages={0} />
      </I18nProvider>,
    );
    expect(screen.getByText('Hello Ada, 0 pages')).toBeTruthy();
  });
});

describe('catalogueFaults', () => {
  it('names each message that is empty, or whose placeholders differ from the Swedish', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
    expect(
      catalogueFaults({
        sv: { a: 'Hej {name}', b: 'Två', c: 'Tre {n}' },
        en: { a: 'Hello {who}', b: ' ', c: 'Three {n}' },
      }),
    ).toEqual(['en a: placeholders {who} where Swedish has {name}', 'en b: empty']);
  });
});
