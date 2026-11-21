import { z } from 'zod';
import { ItemIdSchema } from './content.js';

/**
 * Scheduled review. Which questions come back, and when, is decided by the
 * review module from the learning record; answering one goes through whoever
 * grades answers, with the setting "review".
 */

/** The questions of one subject due today in the learner's time zone, the most overdue first. */
export const DueSchema = z.object({
  subjectId: ItemIdSchema,
  questions: z.array(ItemIdSchema),
  /** Questions met so far in the subject, due or not. */
  scheduled: z.number().int().min(0),
  /** The first day after today on which questions fall due, as YYYY-MM-DD in the learner's time zone, and how many; null when none will. */
  next: z.object({ day: z.iso.date(), questions: z.number().int().min(1) }).nullable(),
  /** How long the learner typically takes over one question in the subject, from their own answers; null before they have answered one. */
  typicalAnswerMs: z.number().int().min(0).nullable(),
});
export type Due = z.infer<typeof DueSchema>;

/** How many questions each subject has due today, and how long one typically takes, for every subject with a question scheduled. */
export const DueCountsSchema = z.object({
  subjects: z.record(ItemIdSchema, z.object({ due: z.number().int().min(0), typicalAnswerMs: z.number().int().min(0).nullable() })),
});
export type DueCounts = z.infer<typeof DueCountsSchema>;
