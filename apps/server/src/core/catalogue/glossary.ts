import { z } from 'zod';
import { ItemIdSchema, type Glossary, type GlossaryEntry, type TermSource } from '@skill-issue/contract';
import type { Db } from '../db.js';
import { holdings } from './sources.js';

/**
 * The read behind a subject's glossary: every term with its other names and the
 * titles of the sources it rests on. A term and each source are shown in the
 * language asked for where translated, each saying which language it is in.
 */

/** Stored bodies carry no language: it is a column of the entry. */
const StoredTermSchema = z.object({
  term: z.string(),
  definition: z.string(),
  alsoKnownAs: z.array(z.string()).optional(),
  sources: z.array(ItemIdSchema),
});
/** Only the title is read; the source schema is strict, so it is not picked from it. */
const StoredSourceTitleSchema = z.object({ title: z.string() });

export async function glossary(db: Db, subjectId: string, language: string | undefined): Promise<Glossary | undefined> {
  const held = await holdings(db, subjectId);
  if (held === undefined) {
    return undefined;
  }
  const wanted = language ?? held.defaultLanguage;
  const terms = held.ids('glossary-term').flatMap((id): GlossaryEntry[] => {
    const shown = held.shown('glossary-term', id, wanted, StoredTermSchema);
    if (shown === undefined) {
      return [];
    }
    const sources = shown.body.sources.flatMap((sourceId): TermSource[] => {
      const source = held.shown('source', sourceId, wanted, StoredSourceTitleSchema);
      return source === undefined ? [] : [{ id: sourceId, language: source.language, title: source.body.title }];
    });
    return [{ id, language: shown.language, term: shown.body.term, definition: shown.body.definition, alsoKnownAs: shown.body.alsoKnownAs ?? [], sources }];
  });
  return { subjectId, terms };
}
