import { useEffect, useState } from 'react';
import { fetchStatus, type ServerStatus } from './api.js';
import { defaultLanguage, isLanguage, languages, translate, type Language, type MessageKey } from './i18n/index.js';

const LANGUAGE_STORAGE_KEY = 'skill-issue.language';

function storedLanguage(): Language {
  const stored: unknown = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguage(stored) ? stored : defaultLanguage;
}

function statusMessage(status: ServerStatus | undefined, t: Translate): string {
  if (status === undefined) {
    return t('status.loading');
  }
  if (status.kind === 'unreachable') {
    return t('status.unreachable');
  }
  const { health } = status;
  switch (health.status) {
    case 'ok':
      return t('status.ok', { modules: health.modules.join(', ') });
    case 'unavailable':
      return t('status.unavailable');
    default: {
      const unhandled: never = health;
      return unhandled;
    }
  }
}

type Translate = (key: MessageKey, values?: Readonly<Record<string, string>>) => string;

export function App() {
  const [language, setLanguage] = useState<Language>(storedLanguage);
  const [status, setStatus] = useState<ServerStatus>();
  const t: Translate = (key, values) => translate(language, key, values);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      const result = await fetchStatus(controller.signal);
      if (!controller.signal.aborted) {
        setStatus(result);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  return (
    <main>
      <header>
        <div>
          <h1>{t('app.title')}</h1>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
        <label>
          {t('language.label')}{' '}
          <select
            value={language}
            onChange={(event) => {
              const chosen: unknown = event.target.value;
              if (isLanguage(chosen)) {
                setLanguage(chosen);
              }
            }}
          >
            {languages.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="empty">
        <h2>{t('start.empty.title')}</h2>
        <p>{t('start.empty.body')}</p>
      </section>

      <footer>
        <output>{statusMessage(status, t)}</output>
      </footer>
    </main>
  );
}
