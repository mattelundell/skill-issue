import { z } from 'zod';
import {
  ItemIdSchema,
  SourceSchema,
  type CitingArea,
  type CitingTerm,
  type LibrarySource,
  type ShownSource,
  type SourceLibrary,
  type SourcePage,
} from '@skill-issue/contract';
import type { Db, Row } from '../db.js';
import { err, ok, type Result } from '../result.js';

/**
 * The reads behind a subject's source library: each source with what cites it.
 * Citations are taken from the default language, which carries a subject's
 * structure; a translation names the same sources, and counting it again would
 * count one question twice.
 */

export type SourcePageError = { readonly kind: 'no-subject' } | { readonly kind: 'no-source' };

/** One source as the catalogue knows it. What the learner answered on a retired one is the learning record's to say. */
export type CataloguePage = Exclude<SourcePage, { status: 'retired' }> | Omit<Extract<SourcePage, { status: 'retired' }>, 'history'>;

const References = z.array(ItemIdSchema);
/** Stored bodies carry no language: it is a column of the entry. */
const StoredSourceSchema = SourceSchema.omit({ language: true });
const StoredSubjectSchema = z.object({ areas: References });
const StoredAreaSchema = z.object({ title: z.string(), lessons: References });
const StoredLessonSchema = z.object({ title: z.string(), sources: References });
const StoredQuestionSchema = z.object({ sources: References });
const StoredTermSchema = z.object({ term: z.string(), definition: z.string(), sources: References });

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

interface Held {
  readonly parentId: string | null;
  readonly position: number;
  /** The item's current body in each language the subject holds it in. */
  readonly bodies: ReadonlyMap<string, unknown>;
}

/** Everything a subject currently holds of the kinds the reader shows, keyed by kind and id. */
class Holdings {
  readonly #items: ReadonlyMap<string, Held>;
  readonly defaultLanguage: string;

  constructor(items: ReadonlyMap<string, Held>, defaultLanguage: string) {
    this.#items = items;
    this.defaultLanguage = defaultLanguage;
  }

  /** Ids of one kind, in their order within their parent. */
  ids(kind: string): readonly string[] {
    const prefix = `${kind}\u0000`;
    return [...this.#items]
      .filter(([key]) => key.startsWith(prefix))
      .toSorted(([, a], [, b]) => a.position - b.position)
      .map(([key]) => key.slice(prefix.length));
  }

  parentOf(kind: string, id: string): string | null {
    return this.#items.get(`${kind}\u0000${id}`)?.parentId ?? null;
  }

  /** The item as the default language has it; undefined for an item held only in translation, or not at all. */
  original<T>(kind: string, id: string, schema: z.ZodType<T>): T | undefined {
    const body = this.#items.get(`${kind}\u0000${id}`)?.bodies.get(this.defaultLanguage);
    return body === undefined ? undefined : schema.parse(body);
  }

  /** The item in `language` where it is translated, else in the default language, saying which. */
  shown<T>(kind: string, id: string, language: string, schema: z.ZodType<T>): { readonly body: T; readonly language: string } | undefined {
    const bodies = this.#items.get(`${kind}\u0000${id}`)?.bodies;
    if (bodies?.get(this.defaultLanguage) === undefined) {
      return undefined;
    }
    const translated = bodies.get(language);
    return translated === undefined
      ? { body: schema.parse(bodies.get(this.defaultLanguage)), language: this.defaultLanguage }
      : { body: schema.parse(translated), language };
  }
}

async function holdings(db: Db, subjectId: string): Promise<Holdings | undefined> {
  const subjects = await db.query('SELECT default_language FROM catalogue.subject WHERE id = $1', [subjectId]);
  const subject = subjects[0];
  if (subject === undefined) {
    return undefined;
  }
  const rows = await db.query(
    `SELECT e.kind, e.id, e.language, i.parent_id, i.position, r.body
       FROM catalogue.entry e
       JOIN catalogue.item i USING (subject_id, kind, id)
       JOIN catalogue.revision r USING (subject_id, kind, id, language)
      WHERE e.subject_id = $1 AND e.kind IN ('subject', 'source', 'glossary-term', 'area', 'lesson', 'question')
        AND r.revision = e.current_revision AND e.retired_at IS NULL`,
    [subjectId],
  );
  const items = new Map<string, { parentId: string | null; position: number; bodies: Map<string, unknown> }>();
  for (const row of rows) {
    const key = `${text(row, 'kind')}\u0000${text(row, 'id')}`;
    const parent = row['parent_id'];
    const held = items.get(key) ?? { parentId: typeof parent === 'string' ? parent : null, position: integer(row, 'position'), bodies: new Map<string, unknown>() };
    held.bodies.set(text(row, 'language'), row['body']);
    items.set(key, held);
  }
  return new Holdings(items, text(subject, 'default_language'));
}

const shownSource = (body: z.infer<typeof StoredSourceSchema>, language: string): ShownSource => ({ ...body, language });

/** For each source, the questions citing it, grouped by the lesson whose bank holds them. */
function citingQuestions(held: Holdings): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const bySource = new Map<string, Map<string, number>>();
  for (const id of held.ids('question')) {
    const question = held.original('question', id, StoredQuestionSchema);
    const lesson = held.parentOf('question', id);
    if (question === undefined || lesson === null) {
      continue;
    }
    for (const source of new Set(question.sources)) {
      const perLesson = bySource.get(source) ?? new Map<string, number>();
      perLesson.set(lesson, (perLesson.get(lesson) ?? 0) + 1);
      bySource.set(source, perLesson);
    }
  }
  return bySource;
}

/** The lessons resting on a source: those citing it themselves, and those with a citing question in their bank. */
function citingLessons(held: Holdings, sourceId: string, questions: ReadonlyMap<string, number>): ReadonlySet<string> {
  const lessons = new Set(questions.keys());
  for (const id of held.ids('lesson')) {
    if (held.original('lesson', id, StoredLessonSchema)?.sources.includes(sourceId) === true) {
      lessons.add(id);
    }
  }
  return lessons;
}

function citingTermIds(held: Holdings, sourceId: string): readonly string[] {
  return held.ids('glossary-term').filter((id) => held.original('glossary-term', id, StoredTermSchema)?.sources.includes(sourceId) === true);
}

export async function sourceLibrary(db: Db, subjectId: string, language: string | undefined): Promise<SourceLibrary | undefined> {
  const held = await holdings(db, subjectId);
  if (held === undefined) {
    return undefined;
  }
  const wanted = language ?? held.defaultLanguage;
  const questions = citingQuestions(held);
  const sources = held.ids('source').flatMap((id): LibrarySource[] => {
    const shown = held.shown('source', id, wanted, StoredSourceSchema);
    if (shown === undefined) {
      return [];
    }
    const perLesson = questions.get(id) ?? new Map<string, number>();
    return [
      {
        ...shownSource(shown.body, shown.language),
        cited: {
          lessons: citingLessons(held, id, perLesson).size,
          questions: [...perLesson.values()].reduce((sum, count) => sum + count, 0),
          terms: citingTermIds(held, id).length,
        },
      },
    ];
  });
  return { subjectId, sources };
}

export async function sourcePage(db: Db, subjectId: string, sourceId: string, language: string | undefined): Promise<Result<CataloguePage, SourcePageError>> {
  const held = await holdings(db, subjectId);
  if (held === undefined) {
    return err({ kind: 'no-subject' });
  }
  const wanted = language ?? held.defaultLanguage;
  const shown = held.shown('source', sourceId, wanted, StoredSourceSchema);
  if (shown === undefined) {
    return retiredSource(db, subjectId, sourceId, wanted, held.defaultLanguage);
  }
  const perLesson = citingQuestions(held).get(sourceId) ?? new Map<string, number>();
  const lessons = citingLessons(held, sourceId, perLesson);
  const path = held.original('subject', subjectId, StoredSubjectSchema)?.areas ?? [];
  const areas = path.flatMap((areaId): CitingArea[] => {
    const area = held.shown('area', areaId, wanted, StoredAreaSchema);
    const original = held.original('area', areaId, StoredAreaSchema);
    if (area === undefined || original === undefined) {
      return [];
    }
    const citing = original.lessons.flatMap((lessonId) => {
      const lesson = lessons.has(lessonId) ? held.shown('lesson', lessonId, wanted, StoredLessonSchema) : undefined;
      return lesson === undefined ? [] : [{ id: lessonId, language: lesson.language, title: lesson.body.title, questions: perLesson.get(lessonId) ?? 0 }];
    });
    return citing.length === 0 ? [] : [{ id: areaId, language: area.language, title: area.body.title, lessons: citing }];
  });
  const terms = citingTermIds(held, sourceId).flatMap((id): CitingTerm[] => {
    const term = held.shown('glossary-term', id, wanted, StoredTermSchema);
    return term === undefined ? [] : [{ id, language: term.language, term: term.body.term, definition: term.body.definition }];
  });
  return ok({ status: 'current', source: shownSource(shown.body, shown.language), areas, terms });
}

/**
 * A source the subject held once and holds no longer: its last revision, in the
 * language asked for if it was ever held in it, else in the default language.
 */
async function retiredSource(db: Db, subjectId: string, sourceId: string, wanted: string, defaultLanguage: string): Promise<Result<CataloguePage, SourcePageError>> {
  const rows = await db.query(
    `SELECT e.language, e.retired_at, r.body
       FROM catalogue.entry e
       JOIN catalogue.revision r USING (subject_id, kind, id, language)
      WHERE e.subject_id = $1 AND e.kind = 'source' AND e.id = $2
        AND r.revision = e.current_revision AND e.retired_at IS NOT NULL
      ORDER BY (e.language = $3) DESC, (e.language = $4) DESC, e.language`,
    [subjectId, sourceId, wanted, defaultLanguage],
  );
  const row = rows[0];
  if (row === undefined) {
    return err({ kind: 'no-source' });
  }
  const retiredAt = row['retired_at'];
  if (!(retiredAt instanceof Date)) {
    throw new TypeError('catalogue column retired_at is not a timestamp');
  }
  return ok({ status: 'retired', source: shownSource(StoredSourceSchema.parse(row['body']), text(row, 'language')), retiredAt: retiredAt.toISOString() });
}
