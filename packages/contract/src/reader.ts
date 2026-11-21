import { z } from 'zod';
import { ItemIdSchema, LanguageSchema, SourceSchema } from './content.js';

/**
 * A subject's raw material as the reader shows it: each source with where it
 * came from, and what in the subject rests on it.
 */

/** A source's origin and its material, in the language it is shown in. */
export const ShownSourceSchema = SourceSchema.extend({
  /** The language this source is shown in: the one asked for, or the subject's default where no translation exists. */
  language: LanguageSchema,
});
export type ShownSource = z.infer<typeof ShownSourceSchema>;

/**
 * How much of the subject cites a source. A lesson counts when it cites the
 * source itself or when any question in its bank does.
 */
export const CitationCountSchema = z.object({
  lessons: z.number().int().min(0),
  questions: z.number().int().min(0),
  terms: z.number().int().min(0),
});
export type CitationCount = z.infer<typeof CitationCountSchema>;

export const LibrarySourceSchema = ShownSourceSchema.extend({ cited: CitationCountSchema });
export type LibrarySource = z.infer<typeof LibrarySourceSchema>;

/**
 * Every source the subject holds, in the order of the pack, each with its
 * material, so the library can be searched without asking again.
 */
export const SourceLibrarySchema = z.object({
  subjectId: ItemIdSchema,
  sources: z.array(LibrarySourceSchema),
});
export type SourceLibrary = z.infer<typeof SourceLibrarySchema>;

/** A lesson that rests on a source, and how many questions in its bank cite it. */
export const CitingLessonSchema = z.object({
  id: ItemIdSchema,
  language: LanguageSchema,
  title: z.string(),
  questions: z.number().int().min(0),
});
export type CitingLesson = z.infer<typeof CitingLessonSchema>;

export const CitingAreaSchema = z.object({
  id: ItemIdSchema,
  language: LanguageSchema,
  title: z.string(),
  lessons: z.array(CitingLessonSchema).min(1),
});
export type CitingArea = z.infer<typeof CitingAreaSchema>;

export const CitingTermSchema = z.object({
  id: ItemIdSchema,
  language: LanguageSchema,
  term: z.string(),
  definition: z.string(),
});
export type CitingTerm = z.infer<typeof CitingTermSchema>;

/**
 * One source. A source the subject no longer holds is still answered, with its
 * last revision, so that an answer once given on its strength keeps an origin.
 * Questions are counted, never quoted: the material must not give away answers
 * before a lesson asks them.
 */
export const SourcePageSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('current'),
    source: ShownSourceSchema,
    /** Areas in path order, each with its citing lessons in path order. */
    areas: z.array(CitingAreaSchema),
    terms: z.array(CitingTermSchema),
  }),
  z.object({
    status: z.literal('retired'),
    source: ShownSourceSchema,
    /** When the subject stopped holding it. */
    retiredAt: z.iso.datetime({ offset: true }),
  }),
]);
export type SourcePage = z.infer<typeof SourcePageSchema>;
