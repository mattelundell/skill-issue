import { z } from 'zod';
import { ItemIdSchema, LessonSchema, SourceSchema, type ShownLesson, type ShownStep } from '@skill-issue/contract';
import type { Db, Row } from '../db.js';
import { err, ok, type Result } from '../result.js';

/**
 * The read behind taking a lesson: its steps in the language asked for, its
 * area, and the sources it rests on, named so they can be linked.
 */

export type LessonReadError = { readonly kind: 'no-subject' } | { readonly kind: 'no-lesson' };

const StoredLessonSchema = LessonSchema.omit({ language: true });
const StoredAreaSchema = z.object({ title: z.string() });
/** Only what a lesson shows of a source; the stored body holds more. */
const StoredSourceSchema = z.object({ title: SourceSchema.shape.title, publisher: SourceSchema.shape.publisher });

const text = (row: Row, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new TypeError(`catalogue column ${column} is not text`);
  }
  return value;
};

const integer = (row: Row, column: string): number => {
  const value = row[column];
  if (typeof value !== 'number') {
    throw new TypeError(`catalogue column ${column} is not a number`);
  }
  return value;
};

/** Current, held entries of one item, by language, with their revision. */
async function entries(db: Db, subjectId: string, kind: string, ids: readonly string[]): Promise<Map<string, Map<string, { body: unknown; revision: number }>>> {
  const rows = await db.query(
    `SELECT e.id, e.language, e.current_revision, r.body
       FROM catalogue.entry e
       JOIN catalogue.revision r USING (subject_id, kind, id, language)
      WHERE e.subject_id = $1 AND e.kind = $2 AND e.id = ANY($3)
        AND r.revision = e.current_revision AND e.retired_at IS NULL`,
    [subjectId, kind, ids],
  );
  const byId = new Map<string, Map<string, { body: unknown; revision: number }>>();
  for (const row of rows) {
    const languages = byId.get(text(row, 'id')) ?? new Map<string, { body: unknown; revision: number }>();
    languages.set(text(row, 'language'), { body: row['body'], revision: integer(row, 'current_revision') });
    byId.set(text(row, 'id'), languages);
  }
  return byId;
}

/** The translation's steps where they line up with the original's, one for one and of the same types. */
function sameShape(original: readonly ShownStep[], translated: readonly ShownStep[]): boolean {
  return original.length === translated.length && original.every((step, index) => step.type === translated[index]?.type);
}

export async function shownLesson(db: Db, subjectId: string, lessonId: string, language: string | undefined): Promise<Result<ShownLesson, LessonReadError>> {
  const subjects = await db.query('SELECT default_language FROM catalogue.subject WHERE id = $1', [subjectId]);
  const subject = subjects[0];
  if (subject === undefined) {
    return err({ kind: 'no-subject' });
  }
  const defaultLanguage = text(subject, 'default_language');
  const wanted = language ?? defaultLanguage;

  const lessonEntries = (await entries(db, subjectId, 'lesson', [lessonId])).get(lessonId);
  const original = lessonEntries?.get(defaultLanguage);
  if (lessonEntries === undefined || original === undefined) {
    // Not held, or held only in translation: the subject does not offer it.
    return err({ kind: 'no-lesson' });
  }
  const originalBody = StoredLessonSchema.parse(original.body);
  const translation = lessonEntries.get(wanted);
  const translatedBody = translation === undefined ? undefined : StoredLessonSchema.parse(translation.body);
  // A translation whose steps do not line up would put other text at a step number; until loading refuses one, it is not shown.
  const [lesson, shownIn] =
    translatedBody !== undefined && sameShape(originalBody.steps, translatedBody.steps) ? [translatedBody, wanted] : [originalBody, defaultLanguage];

  const parents = await db.query(`SELECT parent_id FROM catalogue.item WHERE subject_id = $1 AND kind = 'lesson' AND id = $2`, [subjectId, lessonId]);
  const areaId = ItemIdSchema.parse(parents[0]?.['parent_id']);
  const areaEntries = (await entries(db, subjectId, 'area', [areaId])).get(areaId);
  const areaShown = areaEntries?.get(wanted) === undefined ? defaultLanguage : wanted;
  const areaBody = areaEntries?.get(areaShown);
  if (areaBody === undefined) {
    throw new Error(`lesson ${lessonId} of ${subjectId} has no area entry in ${defaultLanguage}`);
  }

  const sourceEntries = await entries(db, subjectId, 'source', originalBody.sources);
  const sources = originalBody.sources.flatMap((id) => {
    const languages = sourceEntries.get(id);
    const shown = languages?.get(wanted) ?? languages?.get(defaultLanguage);
    if (shown === undefined) {
      return [];
    }
    const { title, publisher } = StoredSourceSchema.parse(shown.body);
    return [{ id, title, publisher }];
  });

  return ok({
    subjectId,
    id: lessonId,
    language: shownIn,
    revision: original.revision,
    title: lesson.title,
    summary: lesson.summary,
    area: { id: areaId, language: areaShown, title: StoredAreaSchema.parse(areaBody.body).title },
    steps: lesson.steps,
    sources,
  });
}
