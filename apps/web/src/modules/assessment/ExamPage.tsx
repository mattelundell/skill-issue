import type { ExamResult, ExamScope, GivenAnswer, Sitting, SubjectOutline } from '@skill-issue/contract';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AreaFooterProps, LessonEndProps, PageProps } from '../../shell/contract.js';
import { Markdown } from '../../shell/markdown.js';
import { Link, subjectPath } from '../../shell/router.js';
import { WithCode } from '../../shell/text.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchPassed, handIn, startExam } from './api.js';
import { Feedback } from './CheckStep.js';
import { AnswerInput, useWords } from './inputs.js';
import { useMessages } from './messages.js';

export const examPath = (subjectId: string, scope: ExamScope): string => subjectPath(subjectId, 'assessment', [scope.kind, scope.id]);

const percent = (share: number): string => String(Math.round(share * 100));

/** A lesson or area exam at `/subjects/<subject>/assessment/<lesson|area>/<id>`. */
export function ExamPage({ subject, path }: PageProps) {
  const [kind, id, ...beyond] = path;
  const area = subject.areas.find((each) => each.id === id);
  const lesson = subject.areas.flatMap((each) => each.lessons.map((one) => ({ ...one, area: each }))).find((each) => each.id === id);
  const found = beyond.length > 0 ? undefined : kind === 'area' && area !== undefined ? { scope: { kind: 'area' as const, id: area.id }, title: area.title, area: area.title } : kind === 'lesson' && lesson !== undefined ? { scope: { kind: 'lesson' as const, id: lesson.id }, title: lesson.title, area: lesson.area.title } : undefined;
  if (found === undefined) {
    return <Missing subject={subject} id={path.join('/')} />;
  }
  return <Exam key={path.join('/')} subject={subject} scope={found.scope} title={found.title} areaTitle={found.area} />;
}

type Stage =
  | { readonly kind: 'intro'; readonly failed: boolean }
  | { readonly kind: 'starting' }
  | { readonly kind: 'sitting'; readonly sitting: Sitting; readonly at: number; readonly answers: ReadonlyMap<string, GivenAnswer>; readonly handing: boolean; readonly failed: boolean }
  | { readonly kind: 'result'; readonly result: ExamResult };

function Exam({ subject, scope, title, areaTitle }: { readonly subject: SubjectOutline; readonly scope: ExamScope; readonly title: string; readonly areaTitle: string }) {
  const { t, tc } = useMessages();
  const [stage, setStage] = useState<Stage>({ kind: 'intro', failed: false });
  const home = subjectPath(subject.id);
  const label = scope.kind === 'lesson' ? t('exam.lesson') : t('exam.area');
  useEffect(() => {
    document.title = `${label}: ${title} · ${subject.title}`;
  }, [label, title, subject.title]);

  const start = async (): Promise<void> => {
    setStage({ kind: 'starting' });
    const sitting = await startExam(subject.id, scope, subject.language);
    setStage(sitting === undefined ? { kind: 'intro', failed: true } : { kind: 'sitting', sitting, at: 0, answers: new Map(), handing: false, failed: false });
  };

  const head = (
    <>
      <div className="lesson-top">
        <p className="crumb">
          <Link to={home}>{subject.title}</Link> › {areaTitle}
        </p>
      </div>
      <p className="step-kind check">{label}</p>
      <h1 className="lesson-title">{title}</h1>
    </>
  );

  if (stage.kind === 'intro' || stage.kind === 'starting') {
    return (
      <div className="lesson exam">
        {head}
        <section className="sheet step">
          <p>{t('exam.intro')}</p>
          {stage.kind === 'intro' && stage.failed ? <p className="grade-failed" role="alert">{t('exam.start.failed')}</p> : null}
          <button type="button" className="btn" disabled={stage.kind === 'starting'} onClick={() => void start()}>
            {stage.kind === 'starting' ? t('exam.starting') : t('exam.start')}
          </button>
        </section>
      </div>
    );
  }

  if (stage.kind === 'result') {
    return (
      <div className="lesson exam">
        {head}
        <Result subject={subject} result={stage.result} again={() => setStage({ kind: 'intro', failed: false })} />
      </div>
    );
  }

  const { sitting, at, answers } = stage;
  const question = sitting.questions[at];
  const total = sitting.questions.length;
  const unanswered = sitting.questions.filter((each) => !answers.has(each.id)).length;
  const submit = async (): Promise<void> => {
    setStage({ ...stage, handing: true, failed: false });
    const result = await handIn(subject.id, sitting.id, [...answers].map(([questionId, answer]) => ({ questionId, answer })));
    setStage(result === undefined ? { ...stage, handing: false, failed: true } : { kind: 'result', result });
  };
  return (
    <div className="lesson exam">
      {head}
      <ol className="stepbar" aria-label={label}>
        {sitting.questions.map((each, index) => (
          <li key={each.id} className={index === at ? 'now' : answers.has(each.id) ? 'done' : undefined} aria-current={index === at ? 'step' : undefined}>
            <button type="button" onClick={() => setStage({ ...stage, at: index })}>
              <span className="sr">{t('question.of', { n: String(index + 1), total: String(total) })}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="stepcount">{t('question.of', { n: String(at + 1), total: String(total) })}</p>
      {question === undefined ? null : (
        <section className="sheet step" aria-label={t('question.of', { n: String(at + 1), total: String(total) })}>
          <ExamQuestion
            key={question.id}
            subject={subject}
            question={question}
            onChange={(answer) => {
              const next = new Map(answers);
              if (answer === undefined) {
                next.delete(question.id);
              } else {
                next.set(question.id, answer);
              }
              setStage({ ...stage, answers: next });
            }}
          />
        </section>
      )}
      <div className="nav">
        <span>
          {at > 0 ? (
            <button type="button" className="btn quiet small" onClick={() => setStage({ ...stage, at: at - 1 })}>
              ← {t('exam.previous')}
            </button>
          ) : null}
        </span>
        {at < total - 1 ? (
          <button type="button" className="btn" onClick={() => setStage({ ...stage, at: at + 1 })}>
            {t('exam.next')}
          </button>
        ) : (
          <span className="hand-in">
            {unanswered > 0 ? <span className="hint">{tc('exam.unanswered', unanswered)}</span> : null}
            <button type="button" className="btn" disabled={stage.handing} onClick={() => void submit()}>
              {stage.handing ? t('exam.handing-in') : t('exam.hand-in')}
            </button>
          </span>
        )}
      </div>
      {stage.failed ? <p className="grade-failed" role="alert">{t('exam.hand-in.failed')}</p> : null}
    </div>
  );
}

/** One question of a sitting. Its answer is kept as the learner moves between questions; nothing is graded until hand-in. */
function ExamQuestion({ subject, question, onChange }: { readonly subject: SubjectOutline; readonly question: Sitting['questions'][number]; readonly onChange: (answer: GivenAnswer | undefined) => void }) {
  const imageText = useCallback((alt: string) => alt, []);
  return (
    <div className="q" data-question={question.id}>
      <div className="prompt">
        <Markdown source={question.prompt} subjectId={subject.id} imageText={imageText} />
      </div>
      <AnswerInput question={question} onChange={onChange} disabled={false} />
    </div>
  );
}

function Result({ subject, result, again }: { readonly subject: SubjectOutline; readonly result: ExamResult; readonly again: () => void }) {
  const { t } = useMessages();
  const words = useWords();
  return (
    <>
      <section className={result.passed ? 'sheet end' : 'sheet end failed'} aria-labelledby="result-h">
        <h2 id="result-h">{result.passed ? t('exam.passed') : t('exam.failed')}</h2>
        <p>{t('exam.mark', { correct: String(result.correct), total: String(result.total), percent: percent(result.passMark) })}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={again}>
            {t('exam.again')}
          </button>
          <Link className="btn quiet" to={subjectPath(subject.id)}>
            {t('exam.back')}
          </Link>
        </div>
      </section>
      <h2 className="section-label">{t('exam.review')}</h2>
      <ol className="review">
        {result.review.map((entry) => (
          <li key={entry.questionId} className="sheet" data-question={entry.questionId}>
            <Markdown source={entry.question.prompt} subjectId={subject.id} imageText={(alt) => alt} />
            <p className="given">{entry.given === null ? t('exam.no-answer') : t('exam.your-answer', { answer: words(entry.question, entry.given) })}</p>
            <Feedback subject={subject} question={entry.question} graded={entry} />
          </li>
        ))}
      </ol>
    </>
  );
}

function Missing({ subject, id }: { readonly subject: SubjectOutline; readonly id: string }) {
  const { t } = useMessages();
  return (
    <div className="sheet state" role="alert">
      <h2>{t('exam.missing.title')}</h2>
      <p>
        <WithCode text={t('exam.missing.body')} placeholder="id" code={id} />
      </p>
      <Link to={subjectPath(subject.id)} className="btn small">
        {t('exam.back')}
      </Link>
    </div>
  );
}

/** Whether a lesson or area exam has been passed, read once per subject. */
function usePassed(subjectId: string) {
  const load = useMemo(() => async (signal: AbortSignal) => fetchPassed(subjectId, signal), [subjectId]);
  const { fetched } = useFetched(subjectId, load);
  return fetched?.kind === 'ok' ? fetched.value : undefined;
}

/** At a lesson's end: the offer to sit its exam now. */
export function LessonExamOffer({ subject, lessonId }: LessonEndProps) {
  const { t } = useMessages();
  const passed = usePassed(subject.id);
  return (
    <div className="exam-offer">
      <p>
        {t('offer.lesson')}
        {passed?.lessons.includes(lessonId) === true ? <span className="chip passed">{t('offer.passed')}</span> : null}
      </p>
      <Link className="btn small" to={examPath(subject.id, { kind: 'lesson', id: lessonId })}>
        {t('offer.sit')}
      </Link>
    </div>
  );
}

/** At the foot of each area on the path: its exam, offered whatever has been taken. */
export function AreaExamOffer({ subject, area }: AreaFooterProps) {
  const { t } = useMessages();
  const passed = usePassed(subject.id);
  return (
    <p className="area-exam">
      <span>{t('area.exam')}</span>
      {passed?.areas.includes(area.id) === true ? <span className="chip passed">{t('offer.passed')}</span> : null}
      <Link to={examPath(subject.id, { kind: 'area', id: area.id })}>{t('area.sit')}</Link>
    </p>
  );
}
