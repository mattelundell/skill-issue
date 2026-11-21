import type { AskedQuestion, EarlierAnswer, GivenAnswer, Graded, SubjectOutline } from '@skill-issue/contract';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CheckStepProps } from '../../shell/contract.js';
import { useSourceLink } from '../../shell/contributions.js';
import { Markdown } from '../../shell/markdown.js';
import { Link } from '../../shell/router.js';
import { useFetched } from '../../shell/useFetched.js';
import { fetchEarlierAnswers, fetchQuestions, postAnswer } from './api.js';
import { AnswerInput, useWords } from './inputs.js';
import { useMessages } from './messages.js';

/** A check inside a lesson: each question answered and graded at once, with why, and where that comes from. */
export function CheckStep({ subject, questions: ids, answeredAfter, onSettled, onAnswered }: CheckStepProps) {
  const { t } = useMessages();
  // Questions are read in the language the subject is shown in, as the lesson around them is; a step taken up again also reads what was answered in it.
  const load = useMemo(
    () => async (signal: AbortSignal) => {
      const [questions, earlier] = await Promise.all([
        fetchQuestions(subject.id, ids, subject.language, signal),
        answeredAfter === undefined ? undefined : fetchEarlierAnswers(subject.id, ids, answeredAfter, subject.language, signal),
      ]);
      if (questions.kind !== 'ok') {
        return questions;
      }
      if (earlier !== undefined && earlier.kind !== 'ok') {
        return { kind: 'failed' as const };
      }
      return { kind: 'ok' as const, value: { questions: questions.value.questions, earlier: earlier?.value.answers ?? [] } };
    },
    [subject.id, ids, subject.language, answeredAfter],
  );
  const { fetched, retry } = useFetched(`${subject.id}/${ids.join(',')}/${subject.language}/${String(answeredAfter)}`, load);
  const [graded, setGraded] = useState<ReadonlyMap<string, Graded>>(new Map());
  const earlier = useMemo(
    () => new Map(fetched?.kind === 'ok' ? fetched.value.earlier.map((answer) => [answer.graded.questionId, answer] as const) : []),
    [fetched],
  );

  const settled = fetched?.kind === 'ok' && fetched.value.questions.every((question) => graded.has(question.id) || earlier.has(question.id));
  useEffect(() => onSettled(settled), [onSettled, settled]);

  const record = useCallback(
    (result: Graded) => {
      setGraded((before) => new Map(before).set(result.questionId, result));
      onAnswered(result.questionId, result.correct);
    },
    [onAnswered],
  );

  if (fetched === undefined) {
    return <p className="sr">{t('loading')}</p>;
  }
  if (fetched.kind !== 'ok') {
    return (
      <div className="check-failed" role="alert">
        <p>{t('failed')}</p>
        <button type="button" className="btn quiet small" onClick={retry}>
          {t('retry')}
        </button>
      </div>
    );
  }
  const { questions } = fetched.value;
  return (
    <div className="questions">
      {questions.map((question, index) => (
        <AskedOne
          key={question.id}
          subject={subject}
          question={question}
          n={index + 1}
          total={questions.length}
          graded={graded.get(question.id)}
          earlier={graded.has(question.id) ? undefined : earlier.get(question.id)}
          onGraded={record}
        />
      ))}
    </div>
  );
}

function AskedOne({
  subject,
  question,
  n,
  total,
  graded,
  earlier,
  onGraded,
}: {
  readonly subject: SubjectOutline;
  readonly question: AskedQuestion;
  readonly n: number;
  readonly total: number;
  readonly graded: Graded | undefined;
  /** Answered before the learner left the step: shown with that answer, not asked again. */
  readonly earlier: EarlierAnswer | undefined;
  readonly onGraded: (graded: Graded) => void;
}) {
  const { t } = useMessages();
  const words = useWords();
  const [answer, setAnswer] = useState<GivenAnswer>();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  // From the question being shown to the answer being sent: the learning record's "how long it took".
  const [shownAt] = useState(() => Date.now());
  const imageText = useCallback((alt: string) => alt, []);
  const send = async (): Promise<void> => {
    if (answer === undefined) {
      return;
    }
    setSending(true);
    const result = await postAnswer(subject.id, question.id, answer, subject.language, Math.min(86_400_000, Math.max(0, Math.round(Date.now() - shownAt))));
    setSending(false);
    setFailed(result === undefined);
    if (result !== undefined) {
      onGraded(result);
    }
  };
  const shown = graded ?? earlier?.graded;
  return (
    <section className="q" aria-labelledby={`q-${question.id}`} data-question={question.id}>
      <div id={`q-${question.id}`} className="prompt">
        {total > 1 ? <span className="qn">{t('question.of', { n: String(n), total: String(total) })}</span> : null}
        <Markdown source={question.prompt} subjectId={subject.id} imageText={imageText} />
      </div>
      {earlier === undefined ? (
        <AnswerInput question={question} onChange={setAnswer} disabled={graded !== undefined || sending} />
      ) : (
        <p className="given">{t('exam.your-answer', { answer: words(question, earlier.given) })}</p>
      )}
      {shown === undefined ? (
        <p className="answer-row">
          <button type="button" className="btn small quiet" disabled={answer === undefined || sending} onClick={() => void send()}>
            {t('answer')}
          </button>
          {failed ? <span className="grade-failed">{t('grade.failed')}</span> : null}
        </p>
      ) : (
        <Feedback subject={subject} question={question} graded={shown} />
      )}
    </section>
  );
}

/** What the learner is told after answering: right or not, the right answer when not, why, and from where. */
export function Feedback({ subject, question, graded }: { readonly subject: SubjectOutline; readonly question: AskedQuestion; readonly graded: Graded }) {
  const { t } = useMessages();
  const words = useWords();
  const sourceLink = useSourceLink();
  const imageText = useCallback((alt: string) => alt, []);
  return (
    <output className={graded.correct ? 'feedback right' : 'feedback wrong'}>
      <strong>{graded.correct ? t('right') : t('wrong')}</strong>
      {graded.correct ? null : <p className="right-answer">{t('right-answer', { answer: words(question, graded.expected) })}</p>}
      <Markdown source={graded.explanation} subjectId={subject.id} imageText={imageText} />
      {graded.sources.length > 0 ? (
        <p className="src">
          {t('source')}
          {graded.sources.map((source, index) => (
            <span key={source.id}>
              {index > 0 ? ', ' : ''}
              {sourceLink === undefined ? `${source.title} (${source.publisher})` : <Link to={sourceLink(subject.id, source.id)}>{`${source.title} (${source.publisher})`}</Link>}
            </span>
          ))}
        </p>
      ) : null}
    </output>
  );
}
