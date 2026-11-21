import { z } from 'zod';

/**
 * What the learning record needs from whoever reports something the learner
 * did: where they were in the world, and how long it took. The record stores
 * time in UTC; the zone is kept beside it so that "what did I do this morning"
 * can be answered in the learner's own day.
 */

/** Whether a name is a time zone this runtime knows, such as Europe/Stockholm or UTC. */
function isTimeZone(name: string): boolean {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: name }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
}

/** The learner's time zone, as an IANA name. */
export const TimeZoneSchema = z.string().min(1).max(64).refine(isTimeZone, { message: 'a time zone name such as Europe/Stockholm' });

/** How long an answer took, from the question being shown to it being sent. A day at most, so a tab left open overnight is still an answer. */
export const DurationMsSchema = z.number().int().min(0).max(86_400_000);

/** Where an answer was given: inside a lesson, in an exam, in a scheduled review, or in extra practice. */
export const AnswerSettingSchema = z.enum(['lesson-check', 'exam', 'review', 'practice']);
export type AnswerSetting = z.infer<typeof AnswerSettingSchema>;

/** The kinds of row the learning record holds. */
export const RecordKindSchema = z.enum(['answer', 'step', 'lesson-finished', 'exam']);
export type RecordKind = z.infer<typeof RecordKindSchema>;
