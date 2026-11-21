import { OpenAPIHono, z } from '@hono/zod-openapi';
import {
  AnswerRequestSchema,
  AskedQuestionsSchema,
  EarlierAnswersSchema,
  ExamResultSchema,
  GradedSchema,
  ItemIdSchema,
  LanguageSchema,
  PassedSchema,
  SittingSchema,
  StartExamSchema,
  SubmitExamSchema,
  type ExamResult,
  type GivenAnswer,
  type Graded,
  type Sitting,
} from '@skill-issue/contract';
import type { Context } from 'hono';
import type { ShownQuestion } from '../../core/catalogue/questions.js';
import { problem, problemContent } from '../../core/problem.js';
import type { RecordEvent } from '../../core/record/record.js';
import type { ModuleContext } from '../../core/registry.js';
import { createSitting, passedIn, sittingOf, submitSitting, type StoredSitting } from './sittings.js';
import { ask, expected, grade, optionsOf, randomShuffle } from './types.js';

const noSubject = (subjectId: string) => problem(404, 'No such subject', `No subject has the id ${JSON.stringify(subjectId)}.`);
const badLanguage = problem(400, 'language must be a language code such as sv, en or en-GB');

const graded = ({ question, sources }: ShownQuestion, correct: boolean): Graded => ({
  questionId: question.id,
  correct,
  expected: expected(question),
  explanation: question.explanation,
  sources: [...sources],
});

/** An answer as the learning record keeps it. Every type is graded right or wrong, so its score is 1 or 0. */
function answered(
  subjectId: string,
  { question, revision, sources }: ShownQuestion,
  given: GivenAnswer | undefined,
  correct: boolean,
  at: { at: Date; timeZone: string; setting: 'lesson-check' | 'review' | 'exam'; durationMs: number | undefined; sittingId?: string },
): RecordEvent {
  return {
    kind: 'answer',
    at: at.at,
    timeZone: at.timeZone,
    question: { subjectId, id: question.id, language: question.language, revision },
    setting: at.setting,
    concepts: question.concepts,
    sources: sources.map((source) => source.id),
    questionType: question.type,
    options: optionsOf(question),
    given,
    correct,
    score: correct ? 1 : 0,
    durationMs: at.durationMs,
    ...(at.sittingId === undefined ? {} : { sittingId: at.sittingId }),
  };
}

const publicSitting = (sitting: StoredSitting): Sitting => ({
  id: sitting.id,
  subjectId: sitting.subjectId,
  scope: sitting.scope,
  title: sitting.title,
  passMark: sitting.passMark,
  questions: [...sitting.asked],
  startedAt: sitting.startedAt,
});

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/** Checks inside lessons, and exams on a lesson or an area. Answers are graded here; the browser never holds one before it is given. */
export function assessmentRoutes({ db, catalogue, record }: ModuleContext): OpenAPIHono {
  const routes = new OpenAPIHono();
  const subjectParam = z.object({ subjectId: ItemIdSchema });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/questions',
    summary: 'Questions by id, as they are asked: without their answers.',
    request: { params: subjectParam, query: z.object({ ids: z.string(), language: LanguageSchema.optional() }) },
    responses: {
      200: { description: 'The questions, in the order asked for; an id the subject does not hold is left out.', content: { 'application/json': { schema: AskedQuestionsSchema } } },
      400: { description: 'The language is not a language code.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/questions', async (c) => {
    const subjectId = c.req.param('subjectId');
    const language = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!language.success) {
      return c.json(badLanguage, 400);
    }
    const ids = (c.req.query('ids') ?? '').split(',').filter((id) => ItemIdSchema.safeParse(id).success);
    const shown = await catalogue.questions(subjectId, ids, language.data);
    if (!shown.ok) {
      return c.json(noSubject(subjectId), 404);
    }
    return c.json({ subjectId, questions: shown.value.map(({ question }) => ask(question, randomShuffle)) }, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/answers',
    summary: 'The latest check answer to each question asked for, given after a row of the learning record, graded as it was.',
    description:
      'For a check step taken up again: `after` is where the pass through the lesson began, as the lesson gives it. An answer given to an earlier revision of the question than the one now shown is left out, so the question is asked afresh.',
    request: { params: subjectParam, query: z.object({ ids: z.string(), after: z.string().optional(), language: LanguageSchema.optional() }) },
    responses: {
      200: { description: 'The answers, in the order the questions were asked for.', content: { 'application/json': { schema: EarlierAnswersSchema } } },
      400: { description: 'The language is not a language code, or `after` is not a row number.', content: problemContent },
      404: { description: 'No such subject.', content: problemContent },
    },
  });
  routes.get('/subjects/:subjectId/answers', async (c) => {
    const subjectId = c.req.param('subjectId');
    const language = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!language.success) {
      return c.json(badLanguage, 400);
    }
    const after = z.coerce.number().int().min(0).safeParse(c.req.query('after') ?? '0');
    if (!after.success) {
      return c.json(problem(400, 'after must be a row number from 0'), 400);
    }
    const ids = (c.req.query('ids') ?? '').split(',').filter((id) => ItemIdSchema.safeParse(id).success);
    const shown = await catalogue.questions(subjectId, ids, language.data);
    if (!shown.ok) {
      return c.json(noSubject(subjectId), 404);
    }
    const latest = await record.latestAnswers(subjectId, ids, { settings: ['lesson-check'], afterSeq: after.data });
    const answers = shown.value.flatMap((found) => {
      const answer = latest.get(found.question.id);
      // The text the learner answered must be the text shown now; otherwise the question is asked afresh.
      if (answer?.given === undefined || answer.question.language !== found.question.language || answer.question.revision !== found.revision) {
        return [];
      }
      return [{ given: answer.given, graded: graded(found, answer.correct) }];
    });
    return c.json({ subjectId, answers }, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/subjects/{subjectId}/questions/{questionId}/answers',
    summary: 'Grades one answer to a question asked on its own — in a lesson check, or in a scheduled review: right or wrong, the right answer, why, and where that comes from.',
    request: {
      params: z.object({ subjectId: ItemIdSchema, questionId: ItemIdSchema }),
      query: z.object({ language: LanguageSchema.optional() }),
      body: { content: { 'application/json': { schema: AnswerRequestSchema } } },
    },
    responses: {
      200: { description: 'The graded answer.', content: { 'application/json': { schema: GradedSchema } } },
      400: { description: 'Not an answer, or an answer of another type than the question.', content: problemContent },
      404: { description: 'No such subject, or no such question in it.', content: problemContent },
    },
  });
  routes.post('/subjects/:subjectId/questions/:questionId/answers', async (c) => {
    const subjectId = c.req.param('subjectId');
    const questionId = c.req.param('questionId');
    const language = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!language.success) {
      return c.json(badLanguage, 400);
    }
    const body = AnswerRequestSchema.safeParse(await jsonBody(c));
    if (!body.success) {
      return c.json(
        problem(400, 'The body is not an answer', 'Send { "answer": { "type": <the question type>, … }, "durationMs": <milliseconds from shown to sent>, "timeZone": <such as Europe/Stockholm> }.'),
        400,
      );
    }
    const shown = await catalogue.questions(subjectId, [questionId], language.data);
    if (!shown.ok) {
      return c.json(noSubject(subjectId), 404);
    }
    const [found] = shown.value;
    if (found === undefined) {
      return c.json(problem(404, 'No such question', `The subject holds no question with the id ${JSON.stringify(questionId)}.`), 404);
    }
    const correct = grade(found.question, body.data.answer);
    if (correct === undefined) {
      return c.json(problem(400, 'The answer is of another type', `The question is ${found.question.type}; the answer is ${body.data.answer.type}.`), 400);
    }
    await record.append([answered(subjectId, found, body.data.answer, correct, { at: new Date(), timeZone: body.data.timeZone, setting: body.data.setting ?? 'lesson-check', durationMs: body.data.durationMs })]);
    return c.json(graded(found, correct), 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/subjects/{subjectId}/exams',
    summary: 'Starts a sitting of a lesson or area exam, drawing its questions afresh from the bank.',
    request: { params: subjectParam, query: z.object({ language: LanguageSchema.optional() }), body: { content: { 'application/json': { schema: StartExamSchema } } } },
    responses: {
      201: { description: 'The sitting, its questions asked without their answers.', content: { 'application/json': { schema: SittingSchema } } },
      400: { description: 'The body names no exam.', content: problemContent },
      404: { description: 'No such subject, or no such lesson or area in it.', content: problemContent },
    },
  });
  routes.post('/subjects/:subjectId/exams', async (c) => {
    const subjectId = c.req.param('subjectId');
    const language = LanguageSchema.optional().safeParse(c.req.query('language'));
    if (!language.success) {
      return c.json(badLanguage, 400);
    }
    const body = StartExamSchema.safeParse(await jsonBody(c));
    if (!body.success) {
      return c.json(problem(400, 'The body names no exam', 'Send { "scope": { "kind": "lesson" | "area", "id": <its id> } }.'), 400);
    }
    const plan = await catalogue.examPlan(subjectId, body.data.scope, language.data);
    if (!plan.ok) {
      return plan.error.kind === 'no-subject'
        ? c.json(noSubject(subjectId), 404)
        : c.json(problem(404, `No such ${body.data.scope.kind}`, `The subject has no ${body.data.scope.kind} with the id ${JSON.stringify(body.data.scope.id)}.`), 404);
    }
    // Each sitting draws afresh, so an exam can be retaken without its order being learnt.
    const drawn = randomShuffle(plan.value.bank).slice(0, plan.value.questions);
    const sitting = await createSitting(db, {
      subjectId,
      scope: body.data.scope,
      scopeAt: plan.value.scope,
      title: plan.value.title,
      passMark: plan.value.passMark,
      drawn,
      asked: drawn.map(({ question }) => ask(question, randomShuffle)),
    });
    return c.json(publicSitting(sitting), 201);
  });

  routes.openAPIRegistry.registerPath({
    method: 'post',
    path: '/subjects/{subjectId}/exams/{sittingId}',
    summary: 'Hands a sitting in: the mark against the pass mark, and every answer reviewed.',
    description: 'A question left unanswered counts as wrong. A sitting is handed in once; again is 409.',
    request: { params: z.object({ subjectId: ItemIdSchema, sittingId: z.uuid() }), body: { content: { 'application/json': { schema: SubmitExamSchema } } } },
    responses: {
      200: { description: 'The result.', content: { 'application/json': { schema: ExamResultSchema } } },
      400: { description: 'Not answers, an answer to a question the sitting did not ask, or of another type.', content: problemContent },
      404: { description: 'No such sitting.', content: problemContent },
      409: { description: 'The sitting has already been handed in.', content: problemContent },
    },
  });
  routes.post('/subjects/:subjectId/exams/:sittingId', async (c) => {
    const subjectId = c.req.param('subjectId');
    const sittingId = c.req.param('sittingId');
    const noSitting = problem(404, 'No such sitting', `The subject has no exam sitting ${JSON.stringify(sittingId)}.`);
    if (!z.uuid().safeParse(sittingId).success) {
      return c.json(noSitting, 404);
    }
    const body = SubmitExamSchema.safeParse(await jsonBody(c));
    if (!body.success) {
      return c.json(
        problem(400, 'The body is not answers', 'Send { "answers": [{ "questionId": …, "answer": { "type": …, … }, "durationMs": <milliseconds on screen> }], "timeZone": <such as Europe/Stockholm> }.'),
        400,
      );
    }
    const sitting = await sittingOf(db, subjectId, sittingId);
    if (sitting === undefined) {
      return c.json(noSitting, 404);
    }
    if (sitting.submitted !== undefined) {
      return c.json(problem(409, 'The sitting has been handed in', 'Start a new sitting to sit the exam again.'), 409);
    }
    const given = new Map(body.data.answers.map(({ questionId, answer }) => [questionId, answer]));
    const asked = new Set(sitting.drawn.map(({ question }) => question.id));
    const stranger = [...given.keys()].find((id) => !asked.has(id));
    if (stranger !== undefined) {
      return c.json(problem(400, 'An answer to a question not asked', `The sitting did not ask ${JSON.stringify(stranger)}.`), 400);
    }
    const review: ExamResult['review'] = [];
    for (const [index, shown] of sitting.drawn.entries()) {
      const answer = given.get(shown.question.id);
      const correct = answer === undefined ? false : grade(shown.question, answer);
      if (correct === undefined) {
        return c.json(problem(400, 'The answer is of another type', `${shown.question.id} is ${shown.question.type}; the answer is ${answer?.type ?? 'none'}.`), 400);
      }
      const question = sitting.asked[index];
      if (question === undefined) {
        throw new Error(`sitting ${sitting.id} has fewer asked questions than drawn`);
      }
      review.push({ ...graded(shown, correct), question, given: answer ?? null });
    }
    const correct = review.filter((entry) => entry.correct).length;
    const total = review.length;
    const passed = correct / total >= sitting.passMark - 1e-9;
    const at = new Date();
    const { timeZone } = body.data;
    // The hand-in and what the record keeps of it commit together: never an answer without its sitting, nor a sitting without its answers.
    const handedIn = await db.transaction(async (tx) => {
      if (!(await submitSitting(tx, sitting.id, at, { answers: body.data.answers, correct, passed }))) {
        return false;
      }
      await record.append(
        [
          ...sitting.drawn.map((shown) => {
            const sent = body.data.answers.find((each) => each.questionId === shown.question.id);
            return answered(subjectId, shown, sent?.answer, review.find((entry) => entry.questionId === shown.question.id)?.correct ?? false, {
              at,
              timeZone,
              setting: 'exam',
              durationMs: sent?.durationMs,
              sittingId: sitting.id,
            });
          }),
          {
            kind: 'exam',
            at,
            timeZone,
            scope: sitting.scope.kind,
            item: { subjectId, id: sitting.scope.id, ...sitting.scopeAt },
            sittingId: sitting.id,
            durationMs: Math.max(0, at.getTime() - Date.parse(sitting.startedAt)),
            result: { correct, total, passMark: sitting.passMark, passed },
          },
        ],
        tx,
      );
      return true;
    });
    if (!handedIn) {
      return c.json(problem(409, 'The sitting has been handed in', 'Start a new sitting to sit the exam again.'), 409);
    }
    return c.json({ sittingId: sitting.id, scope: sitting.scope, title: sitting.title, correct, total, passMark: sitting.passMark, passed, review }, 200);
  });

  routes.openAPIRegistry.registerPath({
    method: 'get',
    path: '/subjects/{subjectId}/passed',
    summary: 'The lessons and areas of a subject whose exam has been passed at least once.',
    request: { params: subjectParam },
    responses: { 200: { description: 'What has been passed.', content: { 'application/json': { schema: PassedSchema } } } },
  });
  routes.get('/subjects/:subjectId/passed', async (c) => {
    const subjectId = c.req.param('subjectId');
    return c.json({ subjectId, ...(await passedIn(db, subjectId)) }, 200);
  });

  return routes;
}
