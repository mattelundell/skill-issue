import { AnswerSettingSchema, GivenAnswerSchema, QuestionTypeSchema, type AnswerSetting, type ExamScope, type GivenAnswer, type QuestionType } from '@skill-issue/contract';
import { z } from 'zod';
import type { Db } from '../db.js';

/** Where and when the learner did something. */
export interface Moment {
  /** In UTC; stored to the millisecond. */
  readonly at: Date;
  readonly timeZone: string;
}

/** The item as it stood when the learner met it. */
export interface ItemAt {
  readonly subjectId: string;
  readonly id: string;
  readonly language: string;
  readonly revision: number;
}

export type RecordEvent =
  | (Moment & {
      readonly kind: 'answer';
      readonly question: ItemAt;
      readonly setting: AnswerSetting;
      readonly concepts: readonly string[];
      readonly sources: readonly string[];
      readonly questionType: QuestionType;
      /** How many options the learner chose among; undefined for a type with none. */
      readonly options: number | undefined;
      /** Undefined for an exam question left unanswered. */
      readonly given: GivenAnswer | undefined;
      readonly correct: boolean;
      readonly score: number;
      /** Undefined for an exam question left unanswered. */
      readonly durationMs: number | undefined;
      /** The sitting, for an exam's answer. */
      readonly sittingId?: string;
    })
  | (Moment & { readonly kind: 'step'; readonly lesson: ItemAt; readonly step: number })
  | (Moment & { readonly kind: 'lesson-finished'; readonly lesson: ItemAt })
  | (Moment & {
      readonly kind: 'exam';
      readonly scope: ExamScope['kind'];
      readonly item: ItemAt;
      readonly sittingId: string;
      readonly durationMs: number;
      readonly result: { readonly correct: number; readonly total: number; readonly passMark: number; readonly passed: boolean };
    });

/** An answer as the record holds it, with its place in the order rows were written. */
export interface RecordedAnswer {
  /** Rises with every row written: a later row always has a higher one. */
  readonly seq: number;
  readonly at: Date;
  readonly timeZone: string;
  readonly question: ItemAt;
  readonly setting: AnswerSetting;
  /** The concepts the question tested when it was answered. */
  readonly concepts: readonly string[];
  readonly questionType: QuestionType;
  readonly options: number | undefined;
  /** Undefined for an exam question left unanswered. */
  readonly given: GivenAnswer | undefined;
  readonly correct: boolean;
}

/** What the learner answered on the strength of one source. */
export interface SourceHistory {
  readonly questions: number;
  readonly answers: number;
}

/**
 * The learning record as the core hands it to modules: rows go in and are
 * never changed, and modules meet here — assessment appends an answer, review
 * reads it, and neither knows the other exists.
 */
export interface LearningRecord {
  /**
   * Appends rows in one statement; on `tx` when given, so they commit or roll back
   * with the work that caused them. Rows become visible in the order they are
   * numbered: appends wait for one another until each one's transaction ends.
   */
  append(events: readonly RecordEvent[], tx?: Db): Promise<void>;
  /** The answers given to questions that cited a source at the time. */
  sourceHistory(subjectId: string, sourceId: string): Promise<SourceHistory>;
  /** Answers in every subject written after row `afterSeq`, in the order written, at most `limit` of them. */
  answersAfter(afterSeq: number, limit: number): Promise<readonly RecordedAnswer[]>;
  /** The latest answer to each of the subject's questions given in one of `settings` after row `afterSeq`, by question id. */
  latestAnswers(
    subjectId: string,
    questionIds: readonly string[],
    filter: { readonly settings: readonly AnswerSetting[]; readonly afterSeq: number },
  ): Promise<ReadonlyMap<string, RecordedAnswer>>;
  /** The median time the learner took over one question in a subject, outside exams, whose time on screen is spread over visits; undefined before any. */
  typicalAnswerMs(subjectId: string): Promise<number | undefined>;
  /** The row at which the learner last reached a lesson's end; 0 when they never have. */
  lastFinished(subjectId: string, lessonId: string): Promise<number>;
  /** Every answer given in a subject, in the order written. */
  answersIn(subjectId: string): Promise<readonly RecordedAnswer[]>;
  /** The lessons of a subject whose exam the learner has passed at least once. */
  passedLessons(subjectId: string): Promise<ReadonlySet<string>>;
}

/** The advisory lock every append holds until its transaction ends. Any number no other code locks; this one spells "record". */
const APPEND_LOCK = 0x7265636f7264;

const ANSWER_COLUMNS = 'seq, at, time_zone, subject_id, item_id, language, revision, setting, concepts, question_type, options, given, correct';

const RecordedRowSchema = z.object({
  seq: z.coerce.number().int(),
  at: z.date(),
  time_zone: z.string(),
  subject_id: z.string(),
  item_id: z.string(),
  language: z.string(),
  revision: z.number().int(),
  setting: AnswerSettingSchema,
  concepts: z.array(z.string()),
  question_type: QuestionTypeSchema,
  options: z.number().int().nullable(),
  given: GivenAnswerSchema.nullable(),
  correct: z.boolean(),
});

function recordedAnswer(row: unknown): RecordedAnswer {
  const parsed = RecordedRowSchema.parse(row);
  return {
    seq: parsed.seq,
    at: parsed.at,
    timeZone: parsed.time_zone,
    question: { subjectId: parsed.subject_id, id: parsed.item_id, language: parsed.language, revision: parsed.revision },
    setting: parsed.setting,
    concepts: parsed.concepts,
    questionType: parsed.question_type,
    options: parsed.options ?? undefined,
    given: parsed.given ?? undefined,
    correct: parsed.correct,
  };
}

const COLUMNS = [
  'kind', 'at', 'time_zone', 'subject_id', 'item_kind', 'item_id', 'language', 'revision', 'setting', 'concepts', 'sources',
  'question_type', 'options', 'given', 'correct', 'score', 'duration_ms', 'step', 'sitting_id', 'result',
] as const;

const CASTS: Readonly<Record<(typeof COLUMNS)[number], string>> = {
  kind: 'text', at: 'timestamptz', time_zone: 'text', subject_id: 'text', item_kind: 'text', item_id: 'text', language: 'text',
  revision: 'integer', setting: 'text', concepts: 'text[]', sources: 'text[]', question_type: 'text', options: 'integer',
  given: 'jsonb', correct: 'boolean', score: 'numeric', duration_ms: 'bigint', step: 'integer', sitting_id: 'uuid', result: 'jsonb',
};

type Columns = Record<(typeof COLUMNS)[number], unknown>;

const EMPTY: Omit<Columns, 'kind' | 'at' | 'time_zone' | 'subject_id' | 'item_kind' | 'item_id' | 'language' | 'revision'> = {
  setting: null, concepts: null, sources: null, question_type: null, options: null, given: null, correct: null, score: null,
  duration_ms: null, step: null, sitting_id: null, result: null,
};

const item = (kind: string, at: ItemAt) => ({ subject_id: at.subjectId, item_kind: kind, item_id: at.id, language: at.language, revision: at.revision });

function columnsOf(event: RecordEvent): Columns {
  const moment = { kind: event.kind, at: event.at.toISOString(), time_zone: event.timeZone };
  switch (event.kind) {
    case 'answer':
      return {
        ...EMPTY,
        ...moment,
        ...item('question', event.question),
        setting: event.setting,
        concepts: [...event.concepts],
        sources: [...event.sources],
        question_type: event.questionType,
        options: event.options ?? null,
        given: event.given === undefined ? null : JSON.stringify(event.given),
        correct: event.correct,
        score: event.score,
        duration_ms: event.durationMs ?? null,
        sitting_id: event.sittingId ?? null,
      };
    case 'step':
      return { ...EMPTY, ...moment, ...item('lesson', event.lesson), step: event.step };
    case 'lesson-finished':
      return { ...EMPTY, ...moment, ...item('lesson', event.lesson) };
    case 'exam':
      return { ...EMPTY, ...moment, ...item(event.scope, event.item), sitting_id: event.sittingId, duration_ms: event.durationMs, result: JSON.stringify(event.result) };
    default: {
      const unknown: never = event;
      return unknown;
    }
  }
}

export function createLearningRecord(db: Db): LearningRecord {
  return {
    async append(events, tx) {
      if (events.length === 0) {
        return;
      }
      const insert = async (on: Db): Promise<void> => {
        // One parameter per column per row, cast where the driver cannot tell: a value never becomes SQL.
        const values: unknown[] = [];
        const tuples = events.map((event) => {
          const columns = columnsOf(event);
          return `(${COLUMNS.map((column) => {
            values.push(columns[column]);
            return `$${values.length}::${CASTS[column]}`;
          }).join(', ')})`;
        });
        await on.query(`INSERT INTO record.event (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`, values);
      };
      const write = async (on: Db): Promise<void> => {
        // One writer at a time, until its transaction ends: a row then becomes visible only after every row numbered before it, so a reader following the numbers never passes over one that committed late.
        await on.query('SELECT pg_advisory_xact_lock($1::bigint)', [APPEND_LOCK]);
        await insert(on);
      };
      await (tx === undefined ? db.transaction(write) : write(tx));
    },

    async sourceHistory(subjectId, sourceId) {
      const rows = await db.query(
        `SELECT count(DISTINCT item_id)::integer AS questions, count(*)::integer AS answers
           FROM record.event
          WHERE kind = 'answer' AND subject_id = $1 AND sources @> ARRAY[$2::text]`,
        [subjectId, sourceId],
      );
      const row = rows[0];
      return { questions: z.number().parse(row?.['questions']), answers: z.number().parse(row?.['answers']) };
    },

    async answersAfter(afterSeq, limit) {
      const rows = await db.query(`SELECT ${ANSWER_COLUMNS} FROM record.event WHERE kind = 'answer' AND seq > $1 ORDER BY seq LIMIT $2`, [afterSeq, limit]);
      return rows.map(recordedAnswer);
    },

    async latestAnswers(subjectId, questionIds, { settings, afterSeq }) {
      if (questionIds.length === 0 || settings.length === 0) {
        return new Map();
      }
      const rows = await db.query(
        `SELECT DISTINCT ON (item_id) ${ANSWER_COLUMNS}
           FROM record.event
          WHERE kind = 'answer' AND subject_id = $1 AND item_id = ANY($2::text[]) AND setting = ANY($3::text[]) AND seq > $4
          ORDER BY item_id, seq DESC`,
        [subjectId, [...questionIds], [...settings], afterSeq],
      );
      return new Map(rows.map((row) => {
        const answer = recordedAnswer(row);
        return [answer.question.id, answer];
      }));
    },

    async typicalAnswerMs(subjectId) {
      const rows = await db.query(
        `SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::integer AS ms
           FROM record.event
          WHERE kind = 'answer' AND subject_id = $1 AND setting <> 'exam' AND duration_ms IS NOT NULL`,
        [subjectId],
      );
      return z.number().int().nullable().parse(rows[0]?.['ms'] ?? null) ?? undefined;
    },

    async lastFinished(subjectId, lessonId) {
      const rows = await db.query(
        `SELECT coalesce(max(seq), 0) AS seq FROM record.event WHERE kind = 'lesson-finished' AND subject_id = $1 AND item_kind = 'lesson' AND item_id = $2`,
        [subjectId, lessonId],
      );
      return z.coerce.number().int().parse(rows[0]?.['seq']);
    },

    async answersIn(subjectId) {
      const rows = await db.query(`SELECT ${ANSWER_COLUMNS} FROM record.event WHERE kind = 'answer' AND subject_id = $1 ORDER BY seq`, [subjectId]);
      return rows.map(recordedAnswer);
    },

    async passedLessons(subjectId) {
      const rows = await db.query(
        `SELECT DISTINCT item_id FROM record.event WHERE kind = 'exam' AND subject_id = $1 AND item_kind = 'lesson' AND (result ->> 'passed')::boolean`,
        [subjectId],
      );
      return new Set(rows.map((row) => z.string().parse(row['item_id'])));
    },
  };
}
