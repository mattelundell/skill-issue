import { z } from 'zod';
import { ItemIdSchema } from './content.js';

/**
 * Notes the learner writes beside a lesson. A note belongs to one step of one
 * lesson, filed there without the learner choosing anything: the area it falls
 * under is the lesson's, read from the subject as it now stands.
 */

/** The longest note kept, in characters: far beyond a note, short of anything that would slow a search. */
export const NOTE_MAX_LENGTH = 20_000;

/** One note, at the step it was written at. `step` counts from 0, as a lesson's position does. */
export const NoteSchema = z.object({
  subjectId: ItemIdSchema,
  lessonId: ItemIdSchema,
  step: z.number().int().min(0),
  /** Markdown, as written. */
  body: z.string().min(1).max(NOTE_MAX_LENGTH),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Note = z.infer<typeof NoteSchema>;

/** A subject's notes, the most recently written first. A note on a lesson the subject no longer holds is kept and listed. */
export const NoteListSchema = z.object({
  subjectId: ItemIdSchema,
  notes: z.array(NoteSchema),
});
export type NoteList = z.infer<typeof NoteListSchema>;

/** What the browser sends to write the note at a step. A body of nothing but white space removes the note. */
export const SaveNoteSchema = z.strictObject({
  body: z.string().max(NOTE_MAX_LENGTH),
});
export type SaveNote = z.infer<typeof SaveNoteSchema>;
