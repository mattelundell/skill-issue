import { z } from 'zod';
import { ItemIdSchema, LanguageSchema } from './content.js';

/**
 * A subject's glossary as a lesson marks it in its text: each term with the
 * other names it goes by, so a lesson can find it however the text names it,
 * and the sources its definition rests on, by title, so the definition can say
 * where it comes from without a second read.
 */

export const TermSourceSchema = z.object({
  id: ItemIdSchema,
  /** The language the title is in: the one asked for, or the subject's default where the source is not translated. */
  language: LanguageSchema,
  title: z.string(),
});
export type TermSource = z.infer<typeof TermSourceSchema>;

export const GlossaryEntrySchema = z.object({
  id: ItemIdSchema,
  /** The language this term is shown in: the one asked for, or the subject's default where it is not translated. */
  language: LanguageSchema,
  term: z.string(),
  /** Markdown. */
  definition: z.string(),
  alsoKnownAs: z.array(z.string()),
  sources: z.array(TermSourceSchema),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;

/** Every term the subject holds, in the order of the pack. */
export const GlossarySchema = z.object({
  subjectId: ItemIdSchema,
  terms: z.array(GlossaryEntrySchema),
});
export type Glossary = z.infer<typeof GlossarySchema>;
