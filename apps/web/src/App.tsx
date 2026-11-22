import { useEffect, useState } from 'react';
import { fetchStatus, type ServerStatus } from './api.js';
import { defaultLanguage, isLanguage, languageName, languages, type Language } from './i18n/index.js';
import { Start } from './screens/Start.js';
import { SubjectHome } from './screens/SubjectHome.js';
import type { WebModule } from './shell/contract.js';
import { ContributionsProvider } from './shell/contributions.js';
import { I18nProvider, useI18n, type I18n } from './shell/i18n.js';
import { usePolled } from './shell/poll.js';
import { appPagePath, Link, startPath, useRoute } from './shell/router.js';

const LANGUAGE_STORAGE_KEY = 'skill-issue.language';

function storedLanguage(): Language {
  let stored: unknown;
  try {
    stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // Storage blocked: the default language is a fine answer.
    stored = undefined;
  }
  return isLanguage(stored) ? stored : defaultLanguage;
}

function statusMessage(status: ServerStatus | undefined, t: I18n['t']): string {
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

/** The browser app: the shell, its two screens, and whatever the given modules contribute to them. */
export function App({ modules }: { readonly modules: readonly WebModule[] }) {
  const [language, setLanguage] = useState<Language>(storedLanguage);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
    document.documentElement.lang = language;
  }, [language]);

  return (
    <I18nProvider language={language}>
      <ContributionsProvider modules={modules}>
        <Shell modules={modules} setLanguage={setLanguage} />
      </ContributionsProvider>
    </I18nProvider>
  );
}

function Shell({ modules, setLanguage }: { readonly modules: readonly WebModule[]; readonly setLanguage: (language: Language) => void }) {
  const { t, language } = useI18n();
  const route = useRoute();
  const { value: status, refresh: refreshStatus } = usePolled(fetchStatus);

  return (
    <div className="app">
      <div className="wrap">
        <header className="topbar">
          <Link className="brand" to={startPath()}>
            {t('app.title')}
          </Link>
          <label className="lang">
            {t('language.label')}
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
                <option key={code} value={code} lang={code}>
                  {capitalised(languageName(code))}
                </option>
              ))}
            </select>
          </label>
        </header>
        <main>
          <Screen route={route} modules={modules} status={status} refreshStatus={refreshStatus} />
        </main>
        <footer className="footer">
          <output>{statusMessage(status, t)}</output>
          {modules.map(({ id, Footer }) => (Footer === undefined ? null : <Footer key={id} language={language} />))}
        </footer>
      </div>
    </div>
  );
}

function Screen({
  route,
  modules,
  status,
  refreshStatus,
}: {
  readonly route: ReturnType<typeof useRoute>;
  readonly modules: readonly WebModule[];
  readonly status: ServerStatus | undefined;
  readonly refreshStatus: () => void;
}) {
  const { language } = useI18n();
  switch (route.kind) {
    case 'start':
      return <Start modules={modules} status={status} refreshStatus={refreshStatus} />;
    case 'subject':
      return <SubjectHome key={route.subjectId} subjectId={route.subjectId} page={route.page} path={route.path} modules={modules} />;
    case 'app-page': {
      const page = modules.find(({ id }) => id === route.page)?.appPage;
      if (page === undefined) {
        return <NotFound />;
      }
      return <page.Page key={route.page} language={language} path={route.path} pathTo={(below) => appPagePath(route.page, below)} />;
    }
    case 'not-found':
      return <NotFound />;
    default: {
      const unhandled: never = route;
      return unhandled;
    }
  }
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="sheet state" role="alert">
      <h2>{t('not-found.title')}</h2>
      <p>{t('not-found.body')}</p>
      <Link to={startPath()} className="btn small">
        {t('home.missing.back')}
      </Link>
    </div>
  );
}

const capitalised = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1);
