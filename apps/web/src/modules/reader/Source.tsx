import type { CitingArea, CitingTerm, ShownSource, SourcePage } from '@skill-issue/contract';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { languageName } from '../../i18n/index.js';
import type { PageProps } from '../../shell/contract.js';
import { useI18n } from '../../shell/i18n.js';
import { Markdown } from '../../shell/markdown.js';
import { Link } from '../../shell/router.js';
import { WithCode } from '../../shell/text.js';
import { fetchSource } from './api.js';
import { formatAge, formatDay } from './format.js';
import { useMessages } from './messages.js';
import { useFetched } from './useFetched.js';

/** One source: where it came from, the material itself, and what in the subject rests on it. */
export function Source({ subject, sourceId, pathTo }: Pick<PageProps, 'subject' | 'pathTo'> & { readonly sourceId: string }) {
  const { t } = useMessages();
  const load = useMemo(() => async (signal: AbortSignal) => fetchSource(subject.id, sourceId, signal), [subject.id, sourceId]);
  const { fetched, retry } = useFetched(`${subject.id}/${sourceId}`, load);
  const title = fetched?.kind === 'ok' ? fetched.value.source.title : undefined;
  useEffect(() => {
    if (title !== undefined) {
      document.title = `${title} · ${subject.title}`;
    }
  }, [title, subject.title]);

  const back = (
    <p className="back">
      <Link to={pathTo([])}>← {t('source.back')}</Link>
    </p>
  );
  if (fetched === undefined) {
    return (
      <>
        {back}
        <p className="sr" aria-busy="true">
          {t('loading')}
        </p>
      </>
    );
  }
  switch (fetched.kind) {
    case 'not-found':
      return <Missing sourceId={sourceId} pathTo={pathTo} />;
    case 'failed':
      return (
        <>
          {back}
          <div className="sheet state error" role="alert">
            <h2>{t('source.failed.title')}</h2>
            <p>{t('source.failed.body')}</p>
            <button type="button" className="btn quiet small" onClick={retry}>
              {t('retry')}
            </button>
          </div>
        </>
      );
    case 'ok':
      return (
        <>
          {back}
          <Shown page={fetched.value} subjectId={subject.id} subjectLanguage={subject.language} />
        </>
      );
    default: {
      const unhandled: never = fetched;
      return unhandled;
    }
  }
}

export function Missing({ sourceId, pathTo }: { readonly sourceId: string; readonly pathTo: PageProps['pathTo'] }) {
  const { t } = useMessages();
  return (
    <div className="sheet state" role="alert">
      <h2>{t('source.missing.title')}</h2>
      <p>
        <WithCode text={t('source.missing.body')} placeholder="id" code={sourceId} />
      </p>
      <Link to={pathTo([])} className="btn small">
        {t('source.missing.back')}
      </Link>
    </div>
  );
}

function Shown({ page, subjectId, subjectLanguage }: { readonly page: SourcePage; readonly subjectId: string; readonly subjectLanguage: string }) {
  const { t } = useMessages();
  const { language } = useI18n();
  const { source } = page;
  const imageText = useCallback((alt: string) => t('image', { alt }), [t]);
  return (
    <div className="source-grid">
      <article lang={source.language}>
        <h2 className="source-title">{source.title}</h2>
        {page.status === 'retired' ? (
          <div className="banner warn" role="note">
            <strong>{t('retired.title')}</strong> {t('retired.body', { date: formatDay(page.retiredAt, language) })}
          </div>
        ) : null}
        {source.language === subjectLanguage ? null : (
          <div className="banner info" role="note">
            {t('in-language', { language: languageName(source.language) })}
          </div>
        )}
        <Origin source={source} />
        <div className="sheet prose">
          <Markdown source={source.body} subjectId={subjectId} imageText={imageText} />
          <p className="kind-note">{t(`kind.${source.kind}.long`)}</p>
        </div>
      </article>
      {page.status === 'current' ? <RestsOn areas={page.areas} terms={page.terms} /> : <RestedOn />}
    </div>
  );
}

function Origin({ source }: { readonly source: ShownSource }) {
  const { t } = useMessages();
  const { language } = useI18n();
  // Taken once when the source is opened: how long ago it was read need not tick while it is on screen.
  const [today] = useState(() => new Date());
  return (
    <section className="sheet card" aria-label={t('origin')}>
      <dl>
        <dt>{t('origin.publisher')}</dt>
        <dd>{source.publisher}</dd>
        <dt>{t('origin.link')}</dt>
        <dd>
          {source.url === undefined ? (
            <>
              {t('origin.no-link')}
              <span className="hint">{t('origin.no-link.hint')}</span>
            </>
          ) : (
            <>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {new URL(source.url).hostname}
              </a>
              <span className="ext">{t('origin.opens')} ↗</span>
            </>
          )}
        </dd>
        <dt>{t('origin.read')}</dt>
        <dd>
          {formatDay(source.accessed, language)}
          <span className="hint">{capitalised(formatAge(source.accessed, language, today))}</span>
        </dd>
        <dt>{t('origin.form')}</dt>
        <dd>{t(`kind.${source.kind}`)}</dd>
        <dt>{t('origin.licence')}</dt>
        <dd>{source.licence === 'unknown' ? t('licence.unknown') : source.licence}</dd>
      </dl>
    </section>
  );
}

/**
 * The lessons and terms resting on the source. Questions are counted and never
 * shown, so the material does not give away answers before a lesson asks them.
 * Lessons are named, not linked, until a module draws a lesson.
 */
function RestsOn({ areas, terms }: { readonly areas: readonly CitingArea[]; readonly terms: readonly CitingTerm[] }) {
  const { t, tc } = useMessages();
  const { list } = useI18n();
  const lessons = areas.flatMap((area) => area.lessons);
  if (lessons.length === 0 && terms.length === 0) {
    return (
      <aside className="sheet cited">
        <h2>{t('rests.title')}</h2>
        <p>{t('rests.none')}</p>
      </aside>
    );
  }
  const questions = lessons.reduce((sum, lesson) => sum + lesson.questions, 0);
  const summary = [lessons.length > 0 ? tc('cited.lessons', lessons.length) : undefined, questions > 0 ? tc('cited.questions', questions) : undefined, terms.length > 0 ? tc('cited.terms', terms.length) : undefined].filter(
    (part) => part !== undefined,
  );
  return (
    <aside className="sheet cited" aria-labelledby="rests-on">
      <h2 id="rests-on">{t('rests.title')}</h2>
      <p>{capitalised(list(summary))}.</p>
      {areas.map((area) => (
        <section key={area.id} aria-labelledby={`rests-${area.id}`}>
          <h3 id={`rests-${area.id}`} lang={area.language}>
            {area.title}
          </h3>
          <ul>
            {area.lessons.map((lesson) => (
              <li key={lesson.id} data-lesson={lesson.id}>
                <span className="mark plain" aria-hidden="true" />
                <span>
                  <span lang={lesson.language}>{lesson.title}</span>
                  {lesson.questions > 0 ? <span className="sub">{tc('cited.questions', lesson.questions)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {terms.length > 0 ? (
        <section aria-labelledby="rests-terms">
          <h3 id="rests-terms">{t('rests.terms')}</h3>
          <dl>
            {terms.map((term) => (
              <div key={term.id} lang={term.language}>
                <dt>{term.term}</dt>
                <dd>{term.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </aside>
  );
}

function RestedOn() {
  const { t } = useMessages();
  return (
    <aside className="sheet cited">
      <h2>{t('rests.retired.title')}</h2>
      <p>{t('rests.retired.body')}</p>
    </aside>
  );
}

const capitalised = (text: string): string => text.charAt(0).toLocaleUpperCase() + text.slice(1);
