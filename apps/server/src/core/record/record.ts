import type { AnswerSetting, ExamScope, GivenAnswer, QuestionType } from '@skill-issue/contract';
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
  /** Appends rows in one statement; on `tx` when given, so they commit or roll back with the work that caused them. */
  append(events: readonly RecordEvent[], tx?: Db): Promise<void>;
  /** The answers given to questions that cited a source at the time. */
  sourceHistory(subjectId: string, sourceId: string): Promise<SourceHistory>;
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
    async append(events, tx = db) {
      if (events.length === 0) {
        return;
      }
      // One parameter per column per row, cast where the driver cannot tell: a value never becomes SQL.
      const values: unknown[] = [];
      const tuples = events.map((event) => {
        const columns = columnsOf(event);
        return `(${COLUMNS.map((column) => {
          values.push(columns[column]);
          return `$${values.length}::${CASTS[column]}`;
        }).join(', ')})`;
      });
      await tx.query(`INSERT INTO record.event (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`, values);
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
  };
}
