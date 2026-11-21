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
});
export type Due = z.infer<typeof DueSchema>;

/** How many questions each subject has due today, for every subject with a question scheduled. */
export const DueCountsSchema = z.object({ subjects: z.record(ItemIdSchema, z.number().int().min(0)) });
export type DueCounts = z.infer<typeof DueCountsSchema>;
