import type { SubjectSummary } from '@skill-issue/contract';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchSubjects, type Fetched, type ServerStatus } from '../api.js';
import { languageName } from '../i18n/index.js';
import type { WebModule } from '../shell/contract.js';
import { useI18n } from '../shell/i18n.js';
import { usePolled } from '../shell/poll.js';
import { Link, subjectPath } from '../shell/router.js';
import { WithCode } from '../shell/text.js';

interface Listed {
  readonly subjects: Fetched<readonly SubjectSummary[]>;
  readonly seenFirst: ReadonlySet<string> | undefined;
  /** Subjects in which something has been begun, by any module that says; undefined when none says. */
  readonly started: ReadonlySet<string> | undefined;
}

interface StartProps {
  readonly modules: readonly WebModule[];
  readonly status: ServerStatus | undefined;
  readonly refreshStatus: () => void;
}

/** Every subject, each with one way in. A subject loaded while the screen is open appears on the next refresh, marked as new. */
export function Start({ modules, status, refreshStatus }: StartProps) {
  const { t } = useI18n();
  const starters = useMemo(() => modules.flatMap(({ startedSubjects }) => (startedSubjects === undefined ? [] : [startedSubjects])), [modules]);
  // What the screen saw the first time the list came back; anything beyond it arrived while it was open.
  const seenFirst = useRef<ReadonlySet<string> | undefined>(undefined);
  const load = useCallback(async (signal: AbortSignal): Promise<Listed> => {
    const subjects = await fetchSubjects(signal);
    if (subjects.kind === 'ok' && seenFirst.current === undefined) {
      seenFirst.current = new Set(subjects.value.map((subject) => subject.id));
    }
    let started: ReadonlySet<string> | undefined;
    if (starters.length > 0) {
      // A module that cannot say is left out; the others still decide each row's action.
      const said = await Promise.allSettled(starters.map(async (starter) => starter(signal)));
      started = new Set(said.flatMap((result) => (result.status === 'fulfilled' ? [...result.value] : [])));
    }
    return { subjects, seenFirst: seenFirst.current, started };
  }, [starters]);
  const { value: listed, refresh } = usePolled(load);
  const subjects = listed?.subjects;

  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  const retry = (): void => {
    refreshStatus();
    refresh();
  };

  const empty = subjects?.kind === 'ok' && subjects.value.length === 0;
  return (
    <>
      <h1 className="page-title">{empty ? t('start.welcome') : t('start.title')}</h1>
      <StartBody modules={modules} status={status} subjects={subjects} seenFirst={listed?.seenFirst} started={listed?.started} retry={retry} />
    </>
  );
}

function StartBody({
  modules,
  status,
  subjects,
  seenFirst,
  started,
  retry,
}: {
  readonly modules: readonly WebModule[];
  readonly status: ServerStatus | undefined;
  readonly subjects: Fetched<readonly SubjectSummary[]> | undefined;
  readonly seenFirst: ReadonlySet<string> | undefined;
  readonly started: ReadonlySet<string> | undefined;
  readonly retry: () => void;
}) {
  const { t, language } = useI18n();
  // Which subject each module's resume panel shows; the first panel that shows one decides the layout.
  const [shows, setShows] = useState<ReadonlyMap<string, string | undefined>>(new Map());
  const reporters = useMemo(
    () => new Map(modules.map(({ id }) => [id, (subjectId: string | undefined) => setShows((before) => (before.get(id) === subjectId ? before : new Map(before).set(id, subjectId)))])),
    [modules],
  );

  if (status?.kind === 'unreachable') {
    return (
      <Problem title={t('start.unreachable.title')} retry={retry}>
        <p>{t('start.unreachable.body')}</p>
        <p>
          <WithCode text={t('start.unreachable.hint')} placeholder="command" code="docker-compose up -d" />
        </p>
      </Problem>
    );
  }
  if (status?.kind === 'answered' && status.health.status === 'unavailable') {
    return (
      <Problem title={t('start.database.title')} retry={retry}>
        <p>{t('start.database.body')}</p>
        <p>
          <WithCode text={t('start.database.hint')} placeholder="command" code="docker-compose ps" />
        </p>
      </Problem>
    );
  }
  if (subjects === undefined) {
    return (
      <div className="sheet ledger" aria-busy="true">
        <span className="sr">{t('start.loading')}</span>
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }
  if (subjects.kind !== 'ok') {
    return (
      <Problem title={t('start.failed.title')} retry={retry}>
        <p>{t('start.failed.body')}</p>
      </Problem>
    );
  }
  if (subjects.value.length === 0) {
    return <Empty />;
  }
  const shown = modules.map(({ id }) => shows.get(id)).find((subjectId) => subjectId !== undefined);
  const rows = subjects.value.filter((subject) => subject.id !== shown);
  const ledger = (
    <div className={shown === undefined ? 'sheet ledger' : 'sheet ledger compact'}>
      {rows.map((subject) => (
        <Row key={subject.id} subject={subject} modules={modules} started={started} isNew={seenFirst !== undefined && !seenFirst.has(subject.id)} />
      ))}
    </div>
  );
  return (
    <>
      {modules.map(({ id, ResumePanel }) =>
        ResumePanel === undefined ? null : <ResumePanel key={id} subjects={subjects.value} language={language} onShows={reporters.get(id) ?? noReport} />,
      )}
      {modules.map(({ id, StartLine }) => (StartLine === undefined ? null : <StartLine key={id} subjects={subjects.value} language={language} />))}
      {shown === undefined ? (
        ledger
      ) : rows.length > 0 ? (
        <section aria-labelledby="others-h">
          <h2 id="others-h" className="section-label">
            {t('start.others')}
          </h2>
          {ledger}
        </section>
      ) : null}
    </>
  );
}

const noReport = (): void => undefined;

function Row({
  subject,
  modules,
  started,
  isNew,
}: {
  readonly subject: SubjectSummary;
  readonly modules: readonly WebModule[];
  readonly started: ReadonlySet<string> | undefined;
  readonly isNew: boolean;
}) {
  const { t, language } = useI18n();
  const to = subjectPath(subject.id);
  const action = started === undefined ? 'open' : started.has(subject.id) ? 'continue' : 'begin';
  return (
    <div className={isNew ? 'ledger-row arrived' : 'ledger-row'} data-subject={subject.id}>
      <div>
        <h2>
          <Link to={to}>{subject.title}</Link>
          {isNew ? <span className="new-flag">{t('start.new')}</span> : null}
        </h2>
        <p className="summary">{subject.summary}</p>
        <div className="facts">
          {modules.map(({ id, StartFigures }) => (StartFigures === undefined ? null : <StartFigures key={id} subject={subject} language={language} />))}
          <Languages languages={subject.languages} />
        </div>
      </div>
      <Link to={to} className="btn" aria-label={t(`start.${action}.label`, { subject: subject.title })}>
        {t(`start.${action}`)}
      </Link>
    </div>
  );
}

/** Which languages a subject can be read in, said only when it is not simply the interface's own. */
function Languages({ languages }: { readonly languages: readonly string[] }) {
  const { t, language } = useI18n();
  const [only] = languages;
  if (languages.length === 1 && only !== undefined) {
    return only === language ? null : <span className="chip">{t('start.only-language', { language: languageName(only) })}</span>;
  }
  return (
    <>
      {languages.map((code) => (
        <span key={code} className="chip" lang={code}>
          {languageName(code)}
        </span>
      ))}
    </>
  );
}

function Empty() {
  const { t } = useI18n();
  return (
    <div className="sheet state">
      <h2>{t('start.empty.title')}</h2>
      <p>{t('start.empty.body')}</p>
      <ol className="howto">
        <li>
          <div>
            {t('start.empty.example')}
            <pre>node apps/cli/dist/main.js load examples/example-subject</pre>
          </div>
        </li>
        <li>
          <div>
            {t('start.empty.api')}
            <pre>
              {`curl -X POST --data-binary @pack.zip \\
  -H 'content-type: application/zip' \\
  ${window.location.origin}/api/v1/content/packs`}
            </pre>
          </div>
        </li>
      </ol>
    </div>
  );
}

function Problem({ title, retry, children }: { readonly title: string; readonly retry: () => void; readonly children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="sheet state error" role="alert">
      <h2>{title}</h2>
      {children}
      <button type="button" className="btn quiet small" onClick={retry}>
        {t('retry')}
      </button>
    </div>
  );
}
