import { z } from 'zod';
import { AreaSchema, ExamBlueprintSchema, ItemIdSchema, LessonSchema, QuestionSchema, SourceSchema, type ExamScope, type LessonSource, type Question } from '@skill-issue/contract';
import type { Db, Row } from '../db.js';
import { err, ok, type Result } from '../result.js';

/**
 * The reads behind asking and examining: questions with their answers, for the
 * module that grades them, and what an exam covers. Structure — a question's
 * type, its option ids, which lesson's bank it is in — comes from the default
 * language; a translation gives the words only where it lines up.
 */

/** A question as it is shown, with its answer, and the sources its explanation rests on. */
export interface ShownQuestion {
  readonly question: Question;
  /** The revision of the entry it is shown from, in `question.language`. */
  readonly revision: number;
  readonly sources: readonly LessonSource[];
}

/** What an exam draws from and how it is passed. */
export interface ExamPlan {
  /** The lesson or area examined, as its structure stands: the default language and its revision. */
  readonly scope: { readonly language: string; readonly revision: number };
  readonly title: string;
  readonly questions: number;
  readonly passMark: number;
  /** Every question it may draw, from the lesson's bank or from the banks of the area's lessons. */
  readonly bank: readonly ShownQuestion[];
}

export type QuestionReadError = { readonly kind: 'no-subject' } | { readonly kind: 'no-item' };

const StoredQuestionSchema = z.object({ lesson: ItemIdSchema }).loose();
/** A stored body: an object, whose language is a column of its entry. */
const BodySchema = z.record(z.string(), z.unknown());
const StoredLessonSchema = z.object({ title: LessonSchema.shape.title, exam: ExamBlueprintSchema });
const StoredAreaSchema = z.object({ title: AreaSchema.shape.title, lessons: z.array(ItemIdSchema), exam: ExamBlueprintSchema });
const StoredSourceSchema = z.object({ title: SourceSchema.shape.title, publisher: SourceSchema.shape.publisher });

const text = (row: Row, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new TypeError(`catalogue column ${column} is not text`);
  }
  return value;
};

type Bodies = Map<string, Map<string, { readonly body: unknown; readonly revision: number }>>;

/** Current, held bodies of one kind, by id and language. */
async function bodiesOf(db: Db, subjectId: string, kind: string): Promise<Bodies> {
  const rows = await db.query(
    `SELECT e.id, e.language, e.current_revision, r.body
       FROM catalogue.entry e
       JOIN catalogue.revision r USING (subject_id, kind, id, language)
      WHERE e.subject_id = $1 AND e.kind = $2 AND r.revision = e.current_revision AND e.retired_at IS NULL`,
    [subjectId, kind],
  );
  const byId: Bodies = new Map();
  for (const row of rows) {
    const languages = byId.get(text(row, 'id')) ?? new Map<string, { body: unknown; revision: number }>();
    languages.set(text(row, 'language'), { body: row['body'], revision: z.number().parse(row['current_revision']) });
    byId.set(text(row, 'id'), languages);
  }
  return byId;
}

/** Whether a translated question can stand in for its original: same type, and the same option ids where it has options. */
function linesUp(original: Question, translated: Question): boolean {
  if (original.type !== translated.type) {
    return false;
  }
  if ((original.type === 'single-choice' || original.type === 'multiple-choice') && (translated.type === 'single-choice' || translated.type === 'multiple-choice')) {
    return original.options.map((option) => option.id).join('\u0000') === translated.options.map((option) => option.id).join('\u0000');
  }
  if (original.type === 'ordering' && translated.type === 'ordering') {
    return original.items.length === translated.items.length;
  }
  if (original.type === 'matching' && translated.type === 'matching') {
    return original.pairs.length === translated.pairs.length;
  }
  return true;
}

class Held {
  constructor(
    readonly defaultLanguage: string,
    readonly wanted: string,
    private readonly questions: Bodies,
    private readonly sources: Bodies,
  ) {}

  /** The question's ids in the order of their lesson's bank, or every one. */
  ids(): readonly string[] {
    return [...this.questions.keys()];
  }

  lessonOf(id: string): string | undefined {
    const entry = this.questions.get(id)?.get(this.defaultLanguage);
    return entry === undefined ? undefined : StoredQuestionSchema.parse(entry.body).lesson;
  }

  shown(id: string): ShownQuestion | undefined {
    const languages = this.questions.get(id);
    const originalEntry = languages?.get(this.defaultLanguage);
    if (languages === undefined || originalEntry === undefined) {
      return undefined;
    }
    const original = QuestionSchema.parse({ ...BodySchema.parse(originalEntry.body), language: this.defaultLanguage });
    const translatedEntry = languages.get(this.wanted);
    const translated =
      translatedEntry === undefined || this.wanted === this.defaultLanguage ? undefined : QuestionSchema.parse({ ...BodySchema.parse(translatedEntry.body), language: this.wanted });
    const [question, revision] = translated !== undefined && translatedEntry !== undefined && linesUp(original, translated) ? [translated, translatedEntry.revision] : [original, originalEntry.revision];
    const sources = original.sources.flatMap((sourceId) => {
      const sourceLanguages = this.sources.get(sourceId);
      const entry = sourceLanguages?.get(this.wanted) ?? sourceLanguages?.get(this.defaultLanguage);
      return entry === undefined ? [] : [{ id: sourceId, ...StoredSourceSchema.parse(entry.body) }];
    });
    return { question, revision, sources };
  }
}

async function held(db: Db, subjectId: string, language: string | undefined): Promise<{ held: Held; bodies: (kind: string) => Promise<Bodies> } | undefined> {
  const subjects = await db.query('SELECT default_language FROM catalogue.subject WHERE id = $1', [subjectId]);
  const subject = subjects[0];
  if (subject === undefined) {
    return undefined;
  }
  const defaultLanguage = text(subject, 'default_language');
  const [questions, sources] = await Promise.all([bodiesOf(db, subjectId, 'question'), bodiesOf(db, subjectId, 'source')]);
  return { held: new Held(defaultLanguage, language ?? defaultLanguage, questions, sources), bodies: async (kind) => bodiesOf(db, subjectId, kind) };
}

/** Questions by id, as shown, in the order asked for; an id the subject does not hold is left out. */
export async function shownQuestions(db: Db, subjectId: string, ids: readonly string[], language: string | undefined): Promise<Result<readonly ShownQuestion[], QuestionReadError>> {
  const found = await held(db, subjectId, language);
  if (found === undefined) {
    return err({ kind: 'no-subject' });
  }
  return ok(ids.flatMap((id) => {
    const shown = found.held.shown(id);
    return shown === undefined ? [] : [shown];
  }));
}

/** What an exam on a lesson or an area draws from, and how it is passed. */
export async function examPlan(db: Db, subjectId: string, scope: ExamScope, language: string | undefined): Promise<Result<ExamPlan, QuestionReadError>> {
  const found = await held(db, subjectId, language);
  if (found === undefined) {
    return err({ kind: 'no-subject' });
  }
  const { held: questions, bodies } = found;
  const titled = async (kind: string, id: string) => {
    const languages = (await bodies(kind)).get(id);
    const original = languages?.get(questions.defaultLanguage);
    return original === undefined ? undefined : { original: original.body, revision: original.revision, shown: (languages?.get(questions.wanted) ?? original).body };
  };
  const bankOf = (lessons: readonly string[]): readonly ShownQuestion[] =>
    questions.ids().flatMap((id) => {
      const lesson = questions.lessonOf(id);
      const shown = lesson !== undefined && lessons.includes(lesson) ? questions.shown(id) : undefined;
      return shown === undefined ? [] : [shown];
    });
  if (scope.kind === 'lesson') {
    const lesson = await titled('lesson', scope.id);
    if (lesson === undefined) {
      return err({ kind: 'no-item' });
    }
    const { exam } = StoredLessonSchema.parse(lesson.original);
    return ok({ scope: { language: questions.defaultLanguage, revision: lesson.revision }, title: StoredLessonSchema.parse(lesson.shown).title, questions: exam.questions, passMark: exam.passMark, bank: bankOf([scope.id]) });
  }
  const area = await titled('area', scope.id);
  if (area === undefined) {
    return err({ kind: 'no-item' });
  }
  const { exam, lessons } = StoredAreaSchema.parse(area.original);
  return ok({ scope: { language: questions.defaultLanguage, revision: area.revision }, title: StoredAreaSchema.parse(area.shown).title, questions: exam.questions, passMark: exam.passMark, bank: bankOf(lessons) });
}
