import type { OutlineArea, OutlineLesson, SubjectOutline } from '@skill-issue/contract';
import { useEffect, useState, type ReactNode } from 'react';
import { fetchOutline, type Fetched } from '../api.js';
import { languageName } from '../i18n/index.js';
import type { LessonMark, WebModule } from '../shell/contract.js';
import { useLessonLink, useLessonMarks } from '../shell/contributions.js';
import { useI18n } from '../shell/i18n.js';
import { Link, startPath, subjectPath } from '../shell/router.js';
import { WithCode } from '../shell/text.js';

interface SubjectHomeProps {
  readonly subjectId: string;
  /** The module whose page is open, or undefined for the overview. */
  readonly page: string | undefined;
  /** The segments below the open page. */
  readonly path: readonly string[];
  readonly modules: readonly WebModule[];
}

/** A subject: its overview — what modules put there, then the path — or one module's page. */
export function SubjectHome({ subjectId, page, path, modules }: SubjectHomeProps) {
  const { t } = useI18n();
  const [outline, setOutline] = useState<{ readonly subjectId: string; readonly fetched: Fetched<SubjectOutline> }>();

  useEffect(() => {
    const controller = new AbortController();
    const settle = async (): Promise<void> => {
      const fetched = await fetchOutline(subjectId, controller.signal);
      if (!controller.signal.aborted) {
        setOutline({ subjectId, fetched });
      }
    };
    void settle();
    return () => controller.abort();
  }, [subjectId]);

  const current = outline?.subjectId === subjectId ? outline.fetched : undefined;
  const title = current?.kind === 'ok' ? current.value.title : undefined;
  useEffect(() => {
    document.title = title === undefined ? t('app.title') : `${title} · ${t('app.title')}`;
  }, [title, t]);

  const crumb = (
    <p className="crumb">
      <Link to={startPath()}>{t('home.all-subjects')}</Link>
    </p>
  );
  if (current === undefined) {
    return (
      <>
        {crumb}
        <p className="sr" aria-busy="true">
          {t('home.loading')}
        </p>
      </>
    );
  }
  if (current.kind === 'not-found') {
    return (
      <>
        {crumb}
        <div className="sheet state" role="alert">
          <h2>{t('home.missing.title')}</h2>
          <p>
            <WithCode text={t('home.missing.body')} placeholder="id" code={subjectId} />
          </p>
          <Link to={startPath()} className="btn small">
            {t('home.missing.back')}
          </Link>
        </div>
      </>
    );
  }
  if (current.kind === 'failed') {
    return (
      <>
        {crumb}
        <div className="sheet state error" role="alert">
          <h2>{t('home.failed.title')}</h2>
          <p>{t('home.failed.body')}</p>
        </div>
      </>
    );
  }
  return (
    <>
      {crumb}
      <Subject subject={current.value} page={page} path={path} modules={modules} />
    </>
  );
}

function Subject({
  subject,
  page,
  path,
  modules,
}: {
  readonly subject: SubjectOutline;
  readonly page: string | undefined;
  readonly path: readonly string[];
  readonly modules: readonly WebModule[];
}) {
  const { t, language } = useI18n();
  const pages = modules.flatMap(({ id, page: contributed }) => (contributed === undefined ? [] : [{ id, ...contributed }]));
  const open = page === undefined ? undefined : pages.find((candidate) => candidate.id === page);

  return (
    <>
      <div className="subject-head">
        <div>
          <h1 className="page-title">{subject.title}</h1>
          <p className="lede">{subject.summary}</p>
        </div>
      </div>
      <nav className="tabs" aria-label={t('home.tabs')}>
        <Link to={subjectPath(subject.id)} aria-current={page === undefined ? 'page' : undefined}>
          {t('home.overview')}
        </Link>
        {pages.flatMap(({ id, label }) =>
          label === undefined
            ? []
            : [
                <Link key={id} to={subjectPath(subject.id, id)} aria-current={page === id ? 'page' : undefined}>
                  {label[language]}
                </Link>,
              ],
        )}
      </nav>
      {page === undefined ? (
        <Overview subject={subject} modules={modules} />
      ) : open === undefined ? (
        <div className="sheet state" role="alert">
          <h2>{t('home.no-page.title')}</h2>
          <p>{t('home.no-page.body', { page })}</p>
        </div>
      ) : (
        <div className="module-page" data-module={open.id}>
          <open.Page subject={subject} language={language} path={path} pathTo={(below) => subjectPath(subject.id, open.id, below)} />
        </div>
      )}
    </>
  );
}

function Overview({ subject, modules }: { readonly subject: SubjectOutline; readonly modules: readonly WebModule[] }) {
  const { t, tc, language } = useI18n();
  const marks = useLessonMarks(subject.id);
  const blocks = modules.flatMap(({ id, homeBlocks }) => (homeBlocks ?? []).map((block, index) => ({ key: `${id}:${index}`, module: id, ...block })));
  const lead = blocks.filter((block) => block.placement === 'lead');
  const side = blocks.filter((block) => block.placement === 'side');
  const marked = marks !== undefined;

  return (
    <div className={side.length > 0 || marked ? 'home-grid' : 'home-grid single'}>
      <div>
        {lead.map(({ key, module, Block }) => (
          <div key={key} className="home-block" data-module={module}>
            <Block subject={subject} language={language} />
          </div>
        ))}
        <div className="path-title">
          <h2>{t('home.path')}</h2>
          <p>{tc('home.areas', subject.areas.length)}</p>
        </div>
        {subject.areas.map((area) => (
          <Area key={area.id} area={area} subject={subject} marks={marks} />
        ))}
      </div>
      {side.length > 0 || marked ? (
        <aside className="side">
          {side.map(({ key, module, Block }) => (
            <div key={key} className="home-block" data-module={module}>
              <Block subject={subject} language={language} />
            </div>
          ))}
          {marked ? <Legend /> : null}
        </aside>
      ) : null}
    </div>
  );
}

function Area({ area, subject, marks }: { readonly area: OutlineArea; readonly subject: SubjectOutline; readonly marks: ReadonlyMap<string, LessonMark> | undefined }) {
  const { t, list } = useI18n();
  const titleOf = (id: string): string => subject.areas.find((candidate) => candidate.id === id)?.title ?? id;
  return (
    <section className="sheet area" aria-labelledby={`area-${area.id}`} data-area={area.id}>
      <div className="area-head">
        <div>
          <h3 id={`area-${area.id}`}>
            <InLanguage item={area} subject={subject}>
              {area.title}
            </InLanguage>
          </h3>
          <p className="summary">{area.summary}</p>
          {area.requires.length > 0 ? <p className="requires">{t('home.requires', { areas: list(area.requires.map(titleOf)) })}</p> : null}
        </div>
      </div>
      <ol className="rail">
        {area.lessons.map((lesson) => (
          <Lesson key={lesson.id} lesson={lesson} subject={subject} mark={marks === undefined ? undefined : (marks.get(lesson.id) ?? { state: 'not-started' })} />
        ))}
      </ol>
    </section>
  );
}

function Lesson({ lesson, subject, mark }: { readonly lesson: OutlineLesson; readonly subject: SubjectOutline; readonly mark: LessonMark | undefined }) {
  const { t } = useI18n();
  const lessonLink = useLessonLink();
  /** The title, a link to the lesson when a module draws lessons. */
  const titled = (children: ReactNode) => (lessonLink === undefined ? children : <Link to={lessonLink(subject.id, lesson.id)}>{children}</Link>);
  if (mark === undefined) {
    return (
      <li data-lesson={lesson.id}>
        <span className="mark plain" aria-hidden="true" />
        <span className="lesson">
          {titled(
            <InLanguage item={lesson} subject={subject}>
              {lesson.title}
            </InLanguage>,
          )}
        </span>
        <span />
      </li>
    );
  }
  const word = t(`lesson.${mark.state}`);
  return (
    <li data-lesson={lesson.id} data-state={mark.state}>
      <span className={`mark ${mark.state}`} aria-hidden="true" />
      <span>
        <span className="lesson">
          {titled(
            <InLanguage item={lesson} subject={subject}>
              {lesson.title}
            </InLanguage>,
          )}
        </span>
        {mark.here === true ? <span className="here">{t('home.here')}</span> : null}
        <span className={`state-word ${mark.state}`}>{mark.detail === undefined ? word : `${word}, ${mark.detail}`}</span>
      </span>
      <span />
    </li>
  );
}

/** An item's title, marked with its language when it is shown in the default language for want of a translation. */
function InLanguage({ item, subject, children }: { readonly item: { readonly language: string }; readonly subject: SubjectOutline; readonly children: string }) {
  const { t } = useI18n();
  if (item.language === subject.language) {
    return <>{children}</>;
  }
  return (
    <>
      <span lang={item.language}>{children}</span> <span className="chip">{t('home.in-language', { language: languageName(item.language) })}</span>
    </>
  );
}

function Legend() {
  const { t } = useI18n();
  return (
    <div className="sheet">
      <h2>{t('home.legend')}</h2>
      <ul className="legend">
        <li>
          <span className="mark not-started" aria-hidden="true" />
          {t('lesson.not-started')}
        </li>
        <li>
          <span className="mark in-progress" aria-hidden="true" />
          {t('lesson.in-progress')}
        </li>
        <li>
          <span className="mark passed" aria-hidden="true" />
          {t('legend.passed')}
        </li>
        <li>
          <span className="mark mastered" aria-hidden="true" />
          {t('legend.mastered')}
        </li>
      </ul>
    </div>
  );
}
