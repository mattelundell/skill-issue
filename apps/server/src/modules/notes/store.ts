import type { Note } from '@skill-issue/contract';
import type { Db, Row } from '../../core/db.js';

/**
 * Notes, one per lesson step. Only the lesson is stored: the area a note is
 * filed under is the lesson's, read from the subject as it now stands, so a
 * lesson moved between areas takes its notes with it.
 */
export const noteMigrations = [
  {
    name: '0001_note',
    sql: `
CREATE SCHEMA notes;

CREATE TABLE notes.note (
  subject_id text        NOT NULL,
  lesson_id  text        NOT NULL,
  -- The step it was written at, counted from 0. A step number is all that survives a reload of the lesson, as with a lesson's position.
  step       integer     NOT NULL CHECK (step >= 0),
  body       text        NOT NULL CHECK (btrim(body) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, lesson_id, step)
);

CREATE INDEX note_updated ON notes.note (subject_id, updated_at DESC);

-- The 'simple' configuration lowercases and splits words without stemming: a note may be written in any language,
-- and a Swedish stemmer would mangle an English one. A prefix query does the work stemming would.
CREATE INDEX note_text ON notes.note USING gin (to_tsvector('simple', body));
`,
  },
] as const;

const COLUMNS = 'subject_id, lesson_id, step, body, created_at, updated_at';

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new TypeError(`notes column ${column} is not text`);
  }
  return value;
}

function time(row: Row, column: string): string {
  const value = row[column];
  if (!(value instanceof Date)) {
    throw new TypeError(`notes column ${column} is not a time`);
  }
  return value.toISOString();
}

function noteFrom(row: Row): Note {
  const step = row['step'];
  if (typeof step !== 'number') {
    throw new TypeError('notes column step is not a number');
  }
  return {
    subjectId: text(row, 'subject_id'),
    lessonId: text(row, 'lesson_id'),
    step,
    body: text(row, 'body'),
    createdAt: time(row, 'created_at'),
    updatedAt: time(row, 'updated_at'),
  };
}

/**
 * A query as a full-text search: every word must start a word of the note.
 * Only letters and digits reach the search, so nothing the learner types can
 * be read as the search's own syntax; undefined when nothing is left.
 */
export function prefixQuery(query: string): string | undefined {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return words === null ? undefined : words.map((word) => `${word}:*`).join(' & ');
}

export interface NoteFilter {
  readonly lessonId?: string;
  readonly query?: string;
}

/**
 * A subject's notes. One lesson's come in step order, for the lesson beside
 * which they are written; otherwise the most recently written come first.
 */
export async function notesIn(db: Db, subjectId: string, filter: NoteFilter = {}): Promise<readonly Note[]> {
  const where = ['subject_id = $1'];
  const values: unknown[] = [subjectId];
  if (filter.lessonId !== undefined) {
    values.push(filter.lessonId);
    where.push(`lesson_id = $${values.length}`);
  }
  const search = filter.query === undefined ? undefined : prefixQuery(filter.query);
  if (search !== undefined) {
    values.push(search);
    where.push(`to_tsvector('simple', body) @@ to_tsquery('simple', $${values.length})`);
  }
  const order = filter.lessonId === undefined ? 'updated_at DESC, lesson_id, step' : 'step';
  return (await db.query(`SELECT ${COLUMNS} FROM notes.note WHERE ${where.join(' AND ')} ORDER BY ${order}`, values)).map(noteFrom);
}

/** Writes the note at a step, keeping when it was begun. */
export async function saveNote(db: Db, at: { readonly subjectId: string; readonly lessonId: string; readonly step: number; readonly body: string }): Promise<Note> {
  // clock_timestamp, not now(): two writes in one transaction must still tell which came last.
  const rows = await db.query(
    `INSERT INTO notes.note (subject_id, lesson_id, step, body, created_at, updated_at)
          VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp())
     ON CONFLICT (subject_id, lesson_id, step) DO UPDATE SET body = EXCLUDED.body, updated_at = clock_timestamp()
     RETURNING ${COLUMNS}`,
    [at.subjectId, at.lessonId, at.step, at.body],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('saving a note returned no row');
  }
  return noteFrom(row);
}

export async function removeNote(db: Db, at: { readonly subjectId: string; readonly lessonId: string; readonly step: number }): Promise<void> {
  await db.query('DELETE FROM notes.note WHERE subject_id = $1 AND lesson_id = $2 AND step = $3', [at.subjectId, at.lessonId, at.step]);
}
