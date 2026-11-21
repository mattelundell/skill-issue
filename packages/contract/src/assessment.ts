import { z } from 'zod';
import { ItemIdSchema, LanguageSchema } from './content.js';
import { LessonSourceSchema } from './lessons.js';
import { DurationMsSchema, TimeZoneSchema } from './record.js';

/**
 * Asking and grading. A question goes to the browser without its answer, the
 * learner's answer comes back, and the server grades it: the page never holds
 * an answer before the question has been answered.
 */

const askedBase = {
  id: ItemIdSchema,
  /** The language the question is shown in: the one asked for, or the subject's default where no translation exists. */
  language: LanguageSchema,
  prompt: z.string(),
};

const ShownOptionSchema = z.object({ id: ItemIdSchema, text: z.string() });

/** A question as it is asked. Ordering items and matching sides come shuffled; only free recall carries its answer, which the learner sees before grading themselves. */
export const AskedQuestionSchema = z.discriminatedUnion('type', [
  z.object({ ...askedBase, type: z.literal('single-choice'), options: z.array(ShownOptionSchema).min(2) }),
  z.object({ ...askedBase, type: z.literal('multiple-choice'), options: z.array(ShownOptionSchema).min(2) }),
  z.object({ ...askedBase, type: z.literal('true-false') }),
  z.object({ ...askedBase, type: z.literal('numeric'), unit: z.string() }),
  z.object({ ...askedBase, type: z.literal('short-text') }),
  z.object({ ...askedBase, type: z.literal('ordering'), items: z.array(z.string()).min(2) }),
  z.object({ ...askedBase, type: z.literal('matching'), lefts: z.array(z.string()).min(2), rights: z.array(z.string()).min(2) }),
  z.object({ ...askedBase, type: z.literal('free-recall'), answer: z.string() }),
]);
export type AskedQuestion = z.infer<typeof AskedQuestionSchema>;
export type QuestionType = AskedQuestion['type'];
export const QuestionTypeSchema = z.enum(['single-choice', 'multiple-choice', 'true-false', 'numeric', 'short-text', 'ordering', 'matching', 'free-recall']);
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// The list names every type a question is asked as, and nothing else: a type added to one and not the other does not compile.
export const QUESTION_TYPES_MATCH: Same<QuestionType, z.infer<typeof QuestionTypeSchema>> = true;

/** The learner's answer, in the shape of its question's type. */
export const GivenAnswerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('single-choice'), option: ItemIdSchema }),
  z.strictObject({ type: z.literal('multiple-choice'), options: z.array(ItemIdSchema) }),
  z.strictObject({ type: z.literal('true-false'), value: z.boolean() }),
  z.strictObject({ type: z.literal('numeric'), value: z.number() }),
  z.strictObject({ type: z.literal('short-text'), text: z.string().max(500) }),
  z.strictObject({ type: z.literal('ordering'), items: z.array(z.string()).max(100) }),
  z.strictObject({ type: z.literal('matching'), pairs: z.array(z.strictObject({ left: z.string(), right: z.string() })).max(100) }),
  /** Free recall is graded by the learner: whether they knew it. */
  z.strictObject({ type: z.literal('free-recall'), knew: z.boolean() }),
]);
export type GivenAnswer = z.infer<typeof GivenAnswerSchema>;

/** The right answer, as it is shown after answering. */
export const ExpectedAnswerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('single-choice'), option: ItemIdSchema }),
  z.object({ type: z.literal('multiple-choice'), options: z.array(ItemIdSchema) }),
  z.object({ type: z.literal('true-false'), value: z.boolean() }),
  z.object({ type: z.literal('numeric'), value: z.number(), unit: z.string(), tolerance: z.number() }),
  z.object({ type: z.literal('short-text'), accepted: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('ordering'), items: z.array(z.string()) }),
  z.object({ type: z.literal('matching'), pairs: z.array(z.object({ left: z.string(), right: z.string() })) }),
  z.object({ type: z.literal('free-recall'), answer: z.string() }),
]);
export type ExpectedAnswer = z.infer<typeof ExpectedAnswerSchema>;

/** A graded answer: whether it was right, what was right, why, and where that comes from. */
export const GradedSchema = z.object({
  questionId: ItemIdSchema,
  correct: z.boolean(),
  expected: ExpectedAnswerSchema,
  explanation: z.string(),
  sources: z.array(LessonSourceSchema),
});
export type Graded = z.infer<typeof GradedSchema>;

/**
 * One answer to a question asked on its own, with what the learning record keeps
 * beside it: how long it took, the learner's time zone, and where it was asked —
 * inside a lesson's check, which is the default, or in a scheduled review.
 */
export const AnswerRequestSchema = z.strictObject({
  answer: GivenAnswerSchema,
  durationMs: DurationMsSchema,
  timeZone: TimeZoneSchema,
  setting: z.enum(['lesson-check', 'review']).optional(),
});

/** A check answer already given, as it is shown again when the learner comes back to its step. */
export const EarlierAnswerSchema = z.object({ given: GivenAnswerSchema, graded: GradedSchema });
export type EarlierAnswer = z.infer<typeof EarlierAnswerSchema>;

/** The latest check answer to each question asked for, at the question's present revision; a question not answered since is left out. */
export const EarlierAnswersSchema = z.object({ subjectId: ItemIdSchema, answers: z.array(EarlierAnswerSchema) });
export type EarlierAnswers = z.infer<typeof EarlierAnswersSchema>;

/** The questions a check step asks, by id, as asked. */
export const AskedQuestionsSchema = z.object({ subjectId: ItemIdSchema, questions: z.array(AskedQuestionSchema) });
export type AskedQuestions = z.infer<typeof AskedQuestionsSchema>;

/** What an exam covers: one lesson's bank, or the banks of every lesson in an area. */
export const ExamScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('lesson'), id: ItemIdSchema }),
  z.strictObject({ kind: z.literal('area'), id: ItemIdSchema }),
]);
export type ExamScope = z.infer<typeof ExamScopeSchema>;

export const StartExamSchema = z.strictObject({ scope: ExamScopeSchema });

/** One sitting: the questions drawn for it, asked. Each sitting draws afresh. */
export const SittingSchema = z.object({
  id: z.uuid(),
  subjectId: ItemIdSchema,
  scope: ExamScopeSchema,
  title: z.string(),
  passMark: z.number(),
  questions: z.array(AskedQuestionSchema).min(1),
  startedAt: z.iso.datetime({ offset: true }),
});
export type Sitting = z.infer<typeof SittingSchema>;

/** A sitting handed in. Each answer carries how long its question was on screen, over every visit to it, since the learner may move back and forth. */
export const SubmitExamSchema = z.strictObject({
  answers: z.array(z.strictObject({ questionId: ItemIdSchema, answer: GivenAnswerSchema, durationMs: DurationMsSchema })).max(500),
  timeZone: TimeZoneSchema,
});

/** A sitting's result: the mark against the pass mark, and every answer reviewed. */
export const ExamResultSchema = z.object({
  sittingId: z.uuid(),
  scope: ExamScopeSchema,
  title: z.string(),
  correct: z.number().int().min(0),
  total: z.number().int().min(1),
  passMark: z.number(),
  passed: z.boolean(),
  review: z.array(GradedSchema.extend({ question: AskedQuestionSchema, given: GivenAnswerSchema.nullable() })),
});
export type ExamResult = z.infer<typeof ExamResultSchema>;

/** Which lessons and areas of a subject have had an exam passed, at least once. */
export const PassedSchema = z.object({
  subjectId: ItemIdSchema,
  lessons: z.array(ItemIdSchema),
  areas: z.array(ItemIdSchema),
});
export type Passed = z.infer<typeof PassedSchema>;
