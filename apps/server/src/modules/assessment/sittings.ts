import { z } from 'zod';
import { AskedQuestionSchema, ExamScopeSchema, GivenAnswerSchema, QuestionSchema, LessonSourceSchema, type AskedQuestion, type ExamScope, type GivenAnswer } from '@skill-issue/contract';
import type { Db, Row } from '../../core/db.js';
import type { ShownQuestion } from '../../core/catalogue/questions.js';

/**
 * Exam sittings. Each holds the questions it drew, as they stood when drawn and
 * with their answers, so a sitting is graded against what was asked even if the
 * subject is reloaded before it is handed in.
 */
export const sittingMigrations = [
  {
    name: '0001_sitting',
    sql: `
CREATE SCHEMA assessment;

CREATE TABLE assessment.sitting (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   text        NOT NULL,
  scope_kind   text        NOT NULL CHECK (scope_kind IN ('lesson', 'area')),
  scope_id     text        NOT NULL,
  title        text        NOT NULL,
  pass_mark    numeric     NOT NULL CHECK (pass_mark > 0 AND pass_mark <= 1),
  -- The questions drawn, with their answers and sources, in the order asked.
  drawn        jsonb       NOT NULL,
  -- The same questions as they were asked, without their answers.
  asked        jsonb       NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  answers      jsonb,
  correct      integer,
  passed       boolean,
  CHECK ((submitted_at IS NULL) = (answers IS NULL) AND (answers IS NULL) = (correct IS NULL) AND (correct IS NULL) = (passed IS NULL))
);

CREATE INDEX sitting_passed ON assessment.sitting (subject_id, scope_kind, scope_id) WHERE passed;
`,
  },
  {
    // The learning record names the revision of everything it records. A sitting
    // drawn before this keeps what it drew; the revision each question and the
    // scope had is the latest one loaded before the sitting started.
    name: '0002_revisions',
    sql: `
ALTER TABLE assessment.sitting ADD COLUMN scope_language text, ADD COLUMN scope_revision integer CHECK (scope_revision >= 1);

UPDATE assessment.sitting s
   SET scope_language = subject.default_language,
       scope_revision = COALESCE(
         (SELECT max(r.revision) FROM catalogue.revision r
           WHERE r.subject_id = s.subject_id AND r.kind = s.scope_kind AND r.id = s.scope_id
             AND r.language = subject.default_language AND r.created_at <= s.started_at),
         1)
  FROM catalogue.subject subject
 WHERE subject.id = s.subject_id;

UPDATE assessment.sitting s
   SET drawn = (
     SELECT jsonb_agg(d.elem || jsonb_build_object('revision', COALESCE(
              (SELECT max(r.revision) FROM catalogue.revision r
                WHERE r.subject_id = s.subject_id AND r.kind = 'question' AND r.id = d.elem #>> '{question,id}'
                  AND r.language = d.elem #>> '{question,language}' AND r.created_at <= s.started_at),
              1)) ORDER BY d.ord)
       FROM jsonb_array_elements(s.drawn) WITH ORDINALITY AS d (elem, ord));

ALTER TABLE assessment.sitting ALTER COLUMN scope_language SET NOT NULL, ALTER COLUMN scope_revision SET NOT NULL;
`,
  },
] as const;

const DrawnSchema = z.array(z.object({ question: QuestionSchema, revision: z.number().int().min(1), sources: z.array(LessonSourceSchema) }));

export interface StoredSitting {
  readonly id: string;
  readonly subjectId: string;
  readonly scope: ExamScope;
  /** The examined lesson or area as its structure stood when drawn. */
  readonly scopeAt: { readonly language: string; readonly revision: number };
  readonly title: string;
  readonly passMark: number;
  readonly drawn: readonly ShownQuestion[];
  readonly asked: readonly AskedQuestion[];
  readonly startedAt: string;
  readonly submitted: { readonly answers: readonly { readonly questionId: string; readonly answer: GivenAnswer }[]; readonly correct: number; readonly passed: boolean } | undefined;
}

const COLUMNS = 'id, subject_id, scope_kind, scope_id, scope_language, scope_revision, title, pass_mark, drawn, asked, started_at, submitted_at, answers, correct, passed';

function fromRow(row: Row): StoredSitting {
  const startedAt = row['started_at'];
  if (!(startedAt instanceof Date)) {
    throw new TypeError('assessment column started_at is not a time');
  }
  const answers = row['answers'];
  return {
    id: z.string().parse(row['id']),
    subjectId: z.string().parse(row['subject_id']),
    scope: ExamScopeSchema.parse({ kind: row['scope_kind'], id: row['scope_id'] }),
    scopeAt: { language: z.string().parse(row['scope_language']), revision: z.number().parse(row['scope_revision']) },
    title: z.string().parse(row['title']),
    passMark: Number(row['pass_mark']),
    drawn: DrawnSchema.parse(row['drawn']),
    asked: z.array(AskedQuestionSchema).parse(row['asked']),
    startedAt: startedAt.toISOString(),
    submitted:
      answers === null
        ? undefined
        : {
            answers: z.array(z.object({ questionId: z.string(), answer: GivenAnswerSchema })).parse(answers),
            correct: z.number().parse(row['correct']),
            passed: z.boolean().parse(row['passed']),
          },
  };
}

export async function createSitting(
  db: Db,
  sitting: { subjectId: string; scope: ExamScope; scopeAt: { language: string; revision: number }; title: string; passMark: number; drawn: readonly ShownQuestion[]; asked: readonly AskedQuestion[] },
): Promise<StoredSitting> {
  const rows = await db.query(
    `INSERT INTO assessment.sitting (subject_id, scope_kind, scope_id, scope_language, scope_revision, title, pass_mark, drawn, asked)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
       RETURNING ${COLUMNS}`,
    [sitting.subjectId, sitting.scope.kind, sitting.scope.id, sitting.scopeAt.language, sitting.scopeAt.revision, sitting.title, sitting.passMark, JSON.stringify(sitting.drawn), JSON.stringify(sitting.asked)],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('creating a sitting returned no row');
  }
  return fromRow(row);
}

export async function sittingOf(db: Db, subjectId: string, id: string): Promise<StoredSitting | undefined> {
  const rows = await db.query(`SELECT ${COLUMNS} FROM assessment.sitting WHERE subject_id = $1 AND id = $2`, [subjectId, id]);
  return rows[0] === undefined ? undefined : fromRow(rows[0]);
}

/** Hands a sitting in at `at`, once: false when it had already been handed in. */
export async function submitSitting(
  db: Db,
  id: string,
  at: Date,
  result: { answers: readonly { questionId: string; answer: GivenAnswer; durationMs?: number }[]; correct: number; passed: boolean },
): Promise<boolean> {
  const rows = await db.query(
    `UPDATE assessment.sitting SET submitted_at = $2, answers = $3::jsonb, correct = $4, passed = $5
      WHERE id = $1 AND submitted_at IS NULL
      RETURNING id`,
    [id, at.toISOString(), JSON.stringify(result.answers.map(({ questionId, answer }) => ({ questionId, answer }))), result.correct, result.passed],
  );
  return rows.length === 1;
}

/** The lessons and areas of a subject with a sitting passed. */
export async function passedIn(db: Db, subjectId: string): Promise<{ lessons: string[]; areas: string[] }> {
  const rows = await db.query(`SELECT DISTINCT scope_kind, scope_id FROM assessment.sitting WHERE subject_id = $1 AND passed ORDER BY scope_kind, scope_id`, [subjectId]);
  const of = (kind: string): string[] => rows.filter((row) => row['scope_kind'] === kind).map((row) => z.string().parse(row['scope_id']));
  return { lessons: of('lesson'), areas: of('area') };
}
