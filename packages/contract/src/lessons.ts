import { z } from 'zod';
import { TimeZoneSchema } from './record.js';
import { ItemIdSchema, LanguageSchema } from './content.js';

/**
 * A lesson as it is taken: its steps in order, and where the learner is in it.
 */

/** One step as shown. A check names the questions it asks; drawing and grading them is another module's work. */
export const ShownStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), body: z.string() }),
  z.object({ type: z.literal('example'), body: z.string() }),
  z.object({ type: z.literal('check'), questions: z.array(ItemIdSchema).min(1) }),
]);
export type ShownStep = z.infer<typeof ShownStepSchema>;

/** A source a lesson rests on, with enough to name it and link to it. */
export const LessonSourceSchema = z.object({
  id: ItemIdSchema,
  title: z.string(),
  publisher: z.string(),
});
export type LessonSource = z.infer<typeof LessonSourceSchema>;

/**
 * One lesson in the language it is shown in. Its steps come from the default
 * language, so every translation has the same steps in the same order, and
 * `revision` is the default language's: a step number means the same step in
 * every language, and changes only when the lesson itself is reloaded changed.
 */
export const ShownLessonSchema = z.object({
  subjectId: ItemIdSchema,
  id: ItemIdSchema,
  /** The language the lesson is shown in: the one asked for, or the subject's default where no translation exists. */
  language: LanguageSchema,
  revision: z.number().int().min(1),
  title: z.string(),
  summary: z.string(),
  area: z.object({ id: ItemIdSchema, language: LanguageSchema, title: z.string() }),
  steps: z.array(ShownStepSchema).min(1),
  sources: z.array(LessonSourceSchema),
});
export type ShownLesson = z.infer<typeof ShownLessonSchema>;

/**
 * Where the learner is in a lesson. `step` is the index of the step on screen;
 * it equals `steps` when the learner has reached the lesson's end.
 */
export const LessonPositionSchema = z.object({
  step: z.number().int().min(0),
  /** How many steps the lesson had when the learner was last in it. */
  steps: z.number().int().min(1),
  /** The lesson's revision when the learner was last in it. */
  revision: z.number().int().min(1),
  startedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** When the learner first reached the end; kept when the lesson is gone through again. */
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type LessonPosition = z.infer<typeof LessonPositionSchema>;

/**
 * A lesson with where to take it up. `resumeAt` is the step to show: the saved
 * one, moved back to the last step when a reload has made the lesson shorter,
 * and the first step for a lesson not started or already finished.
 */
export const LessonViewSchema = z.object({
  lesson: ShownLessonSchema,
  position: LessonPositionSchema.nullable(),
  resumeAt: z.number().int().min(0),
  /** Whether the lesson has been reloaded changed since the learner was last in it. */
  changedSince: z.boolean(),
});
export type LessonView = z.infer<typeof LessonViewSchema>;

/** What the browser sends as the learner moves: the step now on screen, of the revision it was drawn from, and the learner's time zone for the learning record. */
export const SavePositionSchema = z.strictObject({
  step: z.number().int().min(0),
  revision: z.number().int().min(1),
  timeZone: TimeZoneSchema,
});
export type SavePosition = z.infer<typeof SavePositionSchema>;

/** Every lesson of a subject the learner has been in, by lesson id. */
export const SubjectPositionsSchema = z.object({
  subjectId: ItemIdSchema,
  lessons: z.record(ItemIdSchema, LessonPositionSchema),
});
export type SubjectPositions = z.infer<typeof SubjectPositionsSchema>;

/** A lesson the start screen offers, with its place in the path. */
export const ResumeLessonSchema = z.object({
  subjectId: ItemIdSchema,
  lessonId: ItemIdSchema,
  language: LanguageSchema,
  title: z.string(),
  areaTitle: z.string(),
});

/**
 * Where the learner left off across every subject: the lesson last in, when it
 * is unfinished; else the first unfinished lesson after it on its subject's path.
 * `started` lists every subject in which a lesson has been begun.
 */
export const ResumeSchema = z.object({
  offer: z
    .discriminatedUnion('kind', [
      ResumeLessonSchema.extend({ kind: z.literal('continue'), step: z.number().int().min(0), steps: z.number().int().min(1) }),
      ResumeLessonSchema.extend({ kind: z.literal('next') }),
    ])
    .nullable(),
  started: z.array(ItemIdSchema),
});
export type Resume = z.infer<typeof ResumeSchema>;
