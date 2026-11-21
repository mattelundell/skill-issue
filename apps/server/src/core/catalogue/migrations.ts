import type { Migration } from '../migrate.js';
import { CORE_OWNER } from '../migrate.js';

/**
 * The catalogue: every subject's items, their place in the subject, and every
 * revision of every language of each. Rows are added and retired, never
 * deleted, because the learning record refers to the revision that was answered.
 */
const catalogue = `
CREATE SCHEMA catalogue;

CREATE TABLE catalogue.subject (
  id               text        PRIMARY KEY,
  default_language text        NOT NULL,
  format_version   integer     NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One row per item the subject has ever held, with its place in the subject.
CREATE TABLE catalogue.item (
  subject_id  text    NOT NULL REFERENCES catalogue.subject (id),
  kind        text    NOT NULL CHECK (kind IN ('subject', 'source', 'glossary-term', 'area', 'lesson', 'question')),
  id          text    NOT NULL,
  parent_kind text,
  parent_id   text,
  position    integer NOT NULL,
  PRIMARY KEY (subject_id, kind, id),
  CHECK ((parent_kind IS NULL) = (parent_id IS NULL))
);

-- One row per language of an item: which revision is current, and whether
-- the subject still offers it.
CREATE TABLE catalogue.entry (
  subject_id       text        NOT NULL,
  kind             text        NOT NULL,
  id               text        NOT NULL,
  language         text        NOT NULL,
  current_revision integer     NOT NULL,
  retired_at       timestamptz,
  PRIMARY KEY (subject_id, kind, id, language),
  FOREIGN KEY (subject_id, kind, id) REFERENCES catalogue.item (subject_id, kind, id)
);

-- Every version of every entry, as loaded.
CREATE TABLE catalogue.revision (
  subject_id text        NOT NULL,
  kind       text        NOT NULL,
  id         text        NOT NULL,
  language   text        NOT NULL,
  revision   integer     NOT NULL CHECK (revision >= 1),
  body       jsonb       NOT NULL,
  digest     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, kind, id, language, revision),
  FOREIGN KEY (subject_id, kind, id, language) REFERENCES catalogue.entry (subject_id, kind, id, language)
);

-- The current revision always exists; checked at commit, since entry and revision are written together.
ALTER TABLE catalogue.entry
  ADD FOREIGN KEY (subject_id, kind, id, language, current_revision)
  REFERENCES catalogue.revision (subject_id, kind, id, language, revision)
  DEFERRABLE INITIALLY DEFERRED;

-- Files a subject carries. Nothing refers to an earlier version of one, so
-- only the current one is kept.
CREATE TABLE catalogue.asset (
  subject_id text  NOT NULL REFERENCES catalogue.subject (id),
  path       text  NOT NULL,
  media_type text  NOT NULL,
  data       bytea NOT NULL,
  digest     text  NOT NULL,
  PRIMARY KEY (subject_id, path)
);
`;

export const catalogueMigrations: readonly Migration[] = [{ owner: CORE_OWNER, name: '0001_catalogue', sql: catalogue }];
