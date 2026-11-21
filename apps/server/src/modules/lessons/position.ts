import type { LessonPosition } from '@skill-issue/contract';
import type { Db, Row } from '../../core/db.js';

/**
 * Where the learner is in each lesson. One row per lesson ever opened; the
 * learning record (a later module of the core) keeps what happened, this keeps
 * only where to take each lesson up.
 */
export const positionMigrations = [
  {
    name: '0001_position',
    sql: `
CREATE SCHEMA lessons;

CREATE TABLE lessons.position (
  subject_id  text        NOT NULL,
  lesson_id   text        NOT NULL,
  -- The step on screen; equal to steps once the learner has reached the lesson's end.
  step        integer     NOT NULL CHECK (step >= 0),
  steps       integer     NOT NULL CHECK (steps >= 1),
  revision    integer     NOT NULL CHECK (revision >= 1),
  started_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (subject_id, lesson_id),
  CHECK (step <= steps)
);

CREATE INDEX position_updated ON lessons.position (updated_at DESC);
`,
  },
] as const;

export interface StoredPosition extends LessonPosition {
  readonly subjectId: string;
  readonly lessonId: string;
}

const iso = (row: Row, column: string): string => {
  const value = row[column];
  if (!(value instanceof Date)) {
    throw new TypeError(`lessons column ${column} is not a time`);
  }
  return value.toISOString();
};

const num = (row: Row, column: string): number => {
  const value = row[column];
  if (typeof value !== 'number') {
    throw new TypeError(`lessons column ${column} is not a number`);
  }
  return value;
};

const str = (row: Row, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new TypeError(`lessons column ${column} is not text`);
  }
  return value;
};

function fromRow(row: Row): StoredPosition {
  return {
    subjectId: str(row, 'subject_id'),
    lessonId: str(row, 'lesson_id'),
    step: num(row, 'step'),
    steps: num(row, 'steps'),
    revision: num(row, 'revision'),
    startedAt: iso(row, 'started_at'),
    updatedAt: iso(row, 'updated_at'),
    finishedAt: row['finished_at'] === null ? null : iso(row, 'finished_at'),
  };
}

const COLUMNS = 'subject_id, lesson_id, step, steps, revision, started_at, updated_at, finished_at';

export async function positionOf(db: Db, subjectId: string, lessonId: string): Promise<StoredPosition | undefined> {
  const rows = await db.query(`SELECT ${COLUMNS} FROM lessons.position WHERE subject_id = $1 AND lesson_id = $2`, [subjectId, lessonId]);
  return rows[0] === undefined ? undefined : fromRow(rows[0]);
}

export async function positionsIn(db: Db, subjectId: string): Promise<readonly StoredPosition[]> {
  return (await db.query(`SELECT ${COLUMNS} FROM lessons.position WHERE subject_id = $1`, [subjectId])).map(fromRow);
}

/** Every position, the most recently moved first. */
export async function latestPositions(db: Db): Promise<readonly StoredPosition[]> {
  return (await db.query(`SELECT ${COLUMNS} FROM lessons.position ORDER BY updated_at DESC, subject_id, lesson_id`)).map(fromRow);
}

/** Records the step on screen. Reaching the end marks the lesson finished, once; going through it again keeps that. */
export async function savePosition(db: Db, at: { subjectId: string; lessonId: string; step: number; steps: number; revision: number }): Promise<StoredPosition> {
  const rows = await db.query(
    `INSERT INTO lessons.position (subject_id, lesson_id, step, steps, revision, finished_at)
          VALUES ($1, $2, $3::integer, $4::integer, $5::integer, CASE WHEN $3::integer = $4::integer THEN now() END)
     ON CONFLICT (subject_id, lesson_id) DO UPDATE
        SET step = EXCLUDED.step, steps = EXCLUDED.steps, revision = EXCLUDED.revision, updated_at = now(),
            finished_at = COALESCE(lessons.position.finished_at, EXCLUDED.finished_at)
     RETURNING ${COLUMNS}`,
    [at.subjectId, at.lessonId, at.step, at.steps, at.revision],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('saving a lesson position returned no row');
  }
  return fromRow(row);
}
