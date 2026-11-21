import type { Migration } from '../migrate.js';
import { CORE_OWNER } from '../migrate.js';

/**
 * The learning record: one row for everything the learner did — an answer, a
 * step gone through, a lesson finished, an exam sat. Every view of progress is
 * read from it or rebuilt from it, so a row is never changed or removed; the
 * trigger makes that a property of the table rather than a habit of the code.
 */
const record = `
CREATE SCHEMA record;

CREATE TABLE record.event (
  seq          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text        NOT NULL CHECK (kind IN ('answer', 'step', 'lesson-finished', 'exam')),
  -- When, in UTC to the millisecond, and the learner's time zone, so a day can be read as theirs.
  at           timestamptz NOT NULL CHECK (at = date_trunc('milliseconds', at)),
  time_zone    text        NOT NULL,
  subject_id   text        NOT NULL REFERENCES catalogue.subject (id),
  -- The item as it stood: a question for an answer, a lesson for a step, a lesson or area for an exam.
  item_kind    text        NOT NULL CHECK (item_kind IN ('question', 'lesson', 'area')),
  item_id      text        NOT NULL,
  language     text        NOT NULL,
  revision     integer     NOT NULL CHECK (revision >= 1),
  -- An answer: where it was given, what it tests and rests on, what was given and how it was graded.
  setting      text        CHECK (setting IN ('lesson-check', 'exam', 'review', 'practice')),
  concepts     text[],
  sources      text[],
  question_type text,
  -- How many options the learner chose among; empty for a type with none, such as a typed number.
  options      integer     CHECK (options >= 2),
  -- Empty for an exam question left unanswered.
  given        jsonb,
  correct      boolean,
  score        numeric     CHECK (score >= 0 AND score <= 1),
  -- An answer's time on screen, from shown to sent, or over every visit in an exam; an exam's from started to handed in. Empty for an exam question left unanswered.
  -- bigint: an exam left open for weeks before it is handed in still fits.
  duration_ms  bigint      CHECK (duration_ms >= 0),
  -- For a review: the scheduler, its version and parameters, and the memory state before and after.
  scheduler    jsonb,
  -- A step: which, counted from 0.
  step         integer     CHECK (step >= 0),
  -- An exam's answers and the exam itself share the sitting.
  sitting_id   uuid,
  -- An exam: its mark against its pass mark.
  result       jsonb,
  FOREIGN KEY (subject_id, item_kind, item_id, language, revision) REFERENCES catalogue.revision (subject_id, kind, id, language, revision),
  CHECK (CASE kind
    WHEN 'answer' THEN item_kind = 'question' AND setting IS NOT NULL AND concepts IS NOT NULL AND sources IS NOT NULL
                       AND question_type IS NOT NULL AND correct IS NOT NULL AND score IS NOT NULL AND step IS NULL AND result IS NULL
                       AND (setting = 'exam') = (sitting_id IS NOT NULL) AND (setting = 'review') = (scheduler IS NOT NULL)
                       AND (given IS NOT NULL OR setting = 'exam')
    WHEN 'step' THEN item_kind = 'lesson' AND step IS NOT NULL AND setting IS NULL AND given IS NULL AND correct IS NULL AND result IS NULL
    WHEN 'lesson-finished' THEN item_kind = 'lesson' AND step IS NULL AND setting IS NULL AND given IS NULL AND correct IS NULL AND result IS NULL
    WHEN 'exam' THEN item_kind IN ('lesson', 'area') AND sitting_id IS NOT NULL AND result IS NOT NULL AND duration_ms IS NOT NULL
                     AND setting IS NULL AND given IS NULL AND correct IS NULL AND step IS NULL
  END)
);

CREATE INDEX event_at ON record.event (at);
CREATE INDEX event_item ON record.event (subject_id, item_kind, item_id, at);
CREATE INDEX event_sources ON record.event USING gin (sources);

CREATE FUNCTION record.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'record.event is append-only: rows are never changed or removed';
END;
$$;

CREATE TRIGGER event_append_only BEFORE UPDATE OR DELETE ON record.event
  FOR EACH ROW EXECUTE FUNCTION record.refuse_change();
`;

/**
 * A review answer is an answer like any other. The scheduler's memory state is
 * the review module's own, rebuilt by replaying these rows with the scheduler
 * it names, so the record keeps only what happened: a review answer can be
 * graded by whoever grades answers without knowing a scheduler exists.
 * Dropping the column drops the row-shape check that named it, so the check is
 * added again without it.
 */
const reviewIsAnAnswer = `
ALTER TABLE record.event
  DROP COLUMN scheduler,
  ADD CONSTRAINT event_shape CHECK (CASE kind
    WHEN 'answer' THEN item_kind = 'question' AND setting IS NOT NULL AND concepts IS NOT NULL AND sources IS NOT NULL
                       AND question_type IS NOT NULL AND correct IS NOT NULL AND score IS NOT NULL AND step IS NULL AND result IS NULL
                       AND (setting = 'exam') = (sitting_id IS NOT NULL)
                       AND (given IS NOT NULL OR setting = 'exam')
    WHEN 'step' THEN item_kind = 'lesson' AND step IS NOT NULL AND setting IS NULL AND given IS NULL AND correct IS NULL AND result IS NULL
    WHEN 'lesson-finished' THEN item_kind = 'lesson' AND step IS NULL AND setting IS NULL AND given IS NULL AND correct IS NULL AND result IS NULL
    WHEN 'exam' THEN item_kind IN ('lesson', 'area') AND sitting_id IS NOT NULL AND result IS NOT NULL AND duration_ms IS NOT NULL
                     AND setting IS NULL AND given IS NULL AND correct IS NULL AND step IS NULL
  END);
`;

export const recordMigrations: readonly Migration[] = [
  { owner: CORE_OWNER, name: '0002_record', sql: record },
  { owner: CORE_OWNER, name: '0003_review_is_an_answer', sql: reviewIsAnAnswer },
];
