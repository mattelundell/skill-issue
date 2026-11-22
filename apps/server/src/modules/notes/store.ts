import { createHash } from 'node:crypto';
import type { NotebookSection, SectionKind } from '@skill-issue/contract';
import type { Db, Row } from '../../core/db.js';

/**
 * A notebook per subject: a section for each area and each lesson. A section is
 * stored against its area or lesson only, so a lesson moved between areas takes
 * its section with it. Images added to notes are kept beside them.
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
  {
    name: '0002_notebook',
    sql: `
-- A notebook's section belongs to an area or a lesson, not to a step: what was a note per step becomes one per lesson.
CREATE TABLE notes.section (
  subject_id text        NOT NULL,
  kind       text        NOT NULL CHECK (kind IN ('area', 'lesson')),
  item_id    text        NOT NULL,
  body       text        NOT NULL CHECK (btrim(body) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, kind, item_id)
);

CREATE INDEX section_updated ON notes.section (subject_id, updated_at DESC);
CREATE INDEX section_text ON notes.section USING gin (to_tsvector('simple', body));

-- A lesson's notes, step by step in step order with a blank line between, become its section; when it was begun and last written carry over.
INSERT INTO notes.section (subject_id, kind, item_id, body, created_at, updated_at)
SELECT subject_id, 'lesson', lesson_id, string_agg(btrim(body), E'\\n\\n' ORDER BY step), min(created_at), max(updated_at)
  FROM notes.note
 GROUP BY subject_id, lesson_id;

DROP TABLE notes.note;

-- An image the learner added to a note, named as the note references it. The name is the app's, never the learner's file name.
CREATE TABLE notes.image (
  subject_id text        NOT NULL,
  name       text        NOT NULL CHECK (name ~ '^bild-[1-9][0-9]{0,5}\\.(png|jpg|gif|webp)$'),
  media_type text        NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  data       bytea       NOT NULL,
  digest     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, name)
);
`,
  },
] as const;

const COLUMNS = 'subject_id, kind, item_id, body, created_at, updated_at';

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

function kindOf(row: Row): SectionKind {
  const kind = row['kind'];
  if (kind !== 'area' && kind !== 'lesson') {
    throw new TypeError('notes column kind is neither area nor lesson');
  }
  return kind;
}

function sectionFrom(row: Row): NotebookSection {
  return {
    subjectId: text(row, 'subject_id'),
    kind: kindOf(row),
    itemId: text(row, 'item_id'),
    body: text(row, 'body'),
    createdAt: time(row, 'created_at'),
    updatedAt: time(row, 'updated_at'),
  };
}

/**
 * A query as a full-text search: every word must start a word of the section.
 * Only letters and digits reach the search, so nothing the learner types can
 * be read as the search's own syntax; undefined when nothing is left.
 */
export function prefixQuery(query: string): string | undefined {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return words === null ? undefined : words.map((word) => `${word}:*`).join(' & ');
}

/** A subject's written sections, the most recently written first; with a query, those in which every word given starts a word. */
export async function sectionsIn(db: Db, subjectId: string, query?: string): Promise<readonly NotebookSection[]> {
  const values: unknown[] = [subjectId];
  let where = 'subject_id = $1';
  const search = query === undefined ? undefined : prefixQuery(query);
  if (search !== undefined) {
    values.push(search);
    where += ` AND to_tsvector('simple', body) @@ to_tsquery('simple', $2)`;
  }
  return (await db.query(`SELECT ${COLUMNS} FROM notes.section WHERE ${where} ORDER BY updated_at DESC, kind, item_id`, values)).map(sectionFrom);
}

/** Every subject's written sections, for the list of notebooks. */
export async function allSections(db: Db): Promise<readonly NotebookSection[]> {
  return (await db.query(`SELECT ${COLUMNS} FROM notes.section ORDER BY subject_id, updated_at DESC`)).map(sectionFrom);
}

export interface SectionAt {
  readonly subjectId: string;
  readonly kind: SectionKind;
  readonly itemId: string;
}

/** Writes a section, keeping when it was begun. */
export async function saveSection(db: Db, at: SectionAt & { readonly body: string }): Promise<NotebookSection> {
  // clock_timestamp, not now(): two writes in one transaction must still tell which came last.
  const rows = await db.query(
    `INSERT INTO notes.section (subject_id, kind, item_id, body, created_at, updated_at)
          VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp())
     ON CONFLICT (subject_id, kind, item_id) DO UPDATE SET body = EXCLUDED.body, updated_at = clock_timestamp()
     RETURNING ${COLUMNS}`,
    [at.subjectId, at.kind, at.itemId, at.body],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('saving a section returned no row');
  }
  return sectionFrom(row);
}

export async function removeSection(db: Db, at: SectionAt): Promise<void> {
  await db.query('DELETE FROM notes.section WHERE subject_id = $1 AND kind = $2 AND item_id = $3', [at.subjectId, at.kind, at.itemId]);
}

export interface StoredImage {
  readonly name: string;
  readonly mediaType: string;
  readonly data: Uint8Array;
  readonly digest: string;
}

const EXTENSION: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * Keeps an image under the next free name in its subject's notebook. The
 * number is taken under a lock on the subject, so two images added at once
 * never take the same one.
 */
export async function addImage(db: Db, subjectId: string, mediaType: string, data: Uint8Array): Promise<StoredImage> {
  const extension = EXTENSION[mediaType];
  if (extension === undefined) {
    throw new TypeError(`not an image type a notebook keeps: ${mediaType}`);
  }
  const digest = createHash('sha256').update(data).digest('hex');
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('notes.image:' || $1))", [subjectId]);
    const [last] = await tx.query(
      `SELECT coalesce(max(substring(name FROM '^bild-([0-9]+)\\.')::int), 0) AS n FROM notes.image WHERE subject_id = $1`,
      [subjectId],
    );
    const name = `bild-${Number(last?.['n'] ?? 0) + 1}.${extension}`;
    await tx.query('INSERT INTO notes.image (subject_id, name, media_type, data, digest) VALUES ($1, $2, $3, $4, $5)', [subjectId, name, mediaType, Buffer.from(data), digest]);
    return { name, mediaType, data, digest };
  });
}

function imageFrom(row: Row): StoredImage {
  const data = row['data'];
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('notes column data is not bytes');
  }
  return { name: text(row, 'name'), mediaType: text(row, 'media_type'), data, digest: text(row, 'digest') };
}

export async function imageNamed(db: Db, subjectId: string, name: string): Promise<StoredImage | undefined> {
  const [row] = await db.query('SELECT name, media_type, data, digest FROM notes.image WHERE subject_id = $1 AND name = $2', [subjectId, name]);
  return row === undefined ? undefined : imageFrom(row);
}

export async function imagesNamed(db: Db, subjectId: string, names: readonly string[]): Promise<readonly StoredImage[]> {
  if (names.length === 0) {
    return [];
  }
  return (await db.query('SELECT name, media_type, data, digest FROM notes.image WHERE subject_id = $1 AND name = ANY($2) ORDER BY name', [subjectId, [...names]])).map(imageFrom);
}
