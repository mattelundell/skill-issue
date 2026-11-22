import { z } from 'zod';
import { ItemIdSchema } from './content.js';

/**
 * What the learner can recall in a subject, and how that has moved. Every
 * figure is computed from the learning record: an expected recall is the
 * scheduling model's chance of recalling a question at a moment, and a share of
 * questions is the mean of that chance over them, a question never answered
 * counting as 0. Ids only, with no text, so the browser names them from the
 * outline in whatever language it shows.
 */

/** A chance or a share, from 0 to 1. */
const ShareSchema = z.number().min(0).max(1);

/** The expected recall of a set of questions, with how many there are and how many the learner has met. */
const RecallSchema = z.object({
  /** The mean expected recall of the questions; null when there are none. */
  recall: ShareSchema.nullable(),
  questions: z.number().int().min(0),
  /** Questions the learner has answered at least once. */
  met: z.number().int().min(0),
});

export const LessonProgressSchema = RecallSchema.extend({
  lessonId: ItemIdSchema,
  /** The lesson's exam has been passed at least once. */
  passed: z.boolean(),
  /** Passed, and the expected recall of its questions is at or above the target. Lost again when it falls below. */
  mastered: z.boolean(),
});
export type LessonProgress = z.infer<typeof LessonProgressSchema>;

export const AreaProgressSchema = RecallSchema.extend({
  areaId: ItemIdSchema,
  lessons: z.array(LessonProgressSchema),
});
export type AreaProgress = z.infer<typeof AreaProgressSchema>;

/** One day in the learner's time zone. */
export const DayProgressSchema = z.object({
  day: z.iso.date(),
  /** Answers given that day, in every setting. */
  answers: z.number().int().min(0),
  /** Of them, the ones that were right. */
  correct: z.number().int().min(0),
  /** The subject's expected recall at the end of that day, or now for today, over the questions it holds now. */
  recall: ShareSchema,
});
export type DayProgress = z.infer<typeof DayProgressSchema>;

/** A concept the learner has answered wrongly, with the first lesson on the path that teaches it. */
export const WeakSpotSchema = z.object({
  concept: ItemIdSchema,
  /** The name the subject gives the concept, in the language asked for where translated. */
  name: z.string(),
  wrong: z.number().int().min(1),
  answers: z.number().int().min(1),
  lessonId: ItemIdSchema,
});
export type WeakSpot = z.infer<typeof WeakSpotSchema>;

export const SubjectProgressSchema = RecallSchema.extend({
  subjectId: ItemIdSchema,
  /** The expected recall at or above which a passed lesson is mastered. */
  target: ShareSchema,
  areas: z.array(AreaProgressSchema),
  /** The last days, oldest first, ending today. */
  days: z.array(DayProgressSchema),
  /** The concepts with the most wrong answers, most first; at most five. */
  weakSpots: z.array(WeakSpotSchema),
});
export type SubjectProgress = z.infer<typeof SubjectProgressSchema>;
