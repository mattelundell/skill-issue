import {
  RECORDING_MAX_EVENTS,
  RecordingClientSchema,
  RecordedEventSchema,
  type ApiCall,
  type InterfaceEvent,
  type RecordedEvent,
  type Recording,
  type RecordingClient,
} from '@skill-issue/contract';
import type { Db, Row } from '../../core/db.js';

/**
 * Recordings of study sessions and what each saw. At most one recording is
 * under way; an event is stored as it was given, so an export hands back
 * exactly what was seen.
 */
export const diagnosticsMigrations = [
  {
    name: '0001_recording',
    sql: `
CREATE SCHEMA diagnostics;

CREATE TABLE diagnostics.recording (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  -- 'learner' when stopped by the learner, 'full' when it reached the most events a recording holds.
  ended_by   text        CHECK (ended_by IN ('learner', 'full')),
  -- Kept with the recording, so it can be bounded without counting its events.
  events     integer     NOT NULL DEFAULT 0 CHECK (events >= 0),
  client     jsonb       NOT NULL DEFAULT '{}',
  CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);

-- At most one recording is under way: two would each hold half of what happened.
CREATE UNIQUE INDEX recording_under_way ON diagnostics.recording ((true)) WHERE ended_at IS NULL;

CREATE TABLE diagnostics.event (
  recording_id bigint      NOT NULL REFERENCES diagnostics.recording ON DELETE CASCADE,
  seq          bigint      GENERATED ALWAYS AS IDENTITY,
  at           timestamptz NOT NULL,
  source       text        NOT NULL CHECK (source IN ('interface', 'api')),
  body         jsonb       NOT NULL,
  PRIMARY KEY (recording_id, seq)
);

CREATE INDEX event_in_order ON diagnostics.event (recording_id, at, seq);
`,
  },
] as const;

const COLUMNS = 'id, started_at, ended_at, ended_by, events, client';

function moment(value: unknown, column: string): string {
  if (!(value instanceof Date)) {
    throw new TypeError(`diagnostics column ${column} is not a time`);
  }
  return value.toISOString();
}

function recordingFrom(row: Row): Recording {
  const { id, events, ended_by: endedBy } = row;
  if (typeof id !== 'string' || typeof events !== 'number' || (endedBy !== null && endedBy !== 'learner' && endedBy !== 'full')) {
    throw new TypeError('a diagnostics recording row has an unexpected shape');
  }
  return {
    id: Number(id),
    startedAt: moment(row['started_at'], 'started_at'),
    endedAt: row['ended_at'] === null ? null : moment(row['ended_at'], 'ended_at'),
    endedBy,
    events,
    client: RecordingClientSchema.parse(row['client']),
  };
}

/** The recording under way, if any. */
export async function recordingUnderWay(db: Db): Promise<Recording | undefined> {
  const [row] = await db.query(`SELECT ${COLUMNS} FROM diagnostics.recording WHERE ended_at IS NULL`);
  return row === undefined ? undefined : recordingFrom(row);
}

export async function recording(db: Db, id: number): Promise<Recording | undefined> {
  const [row] = await db.query(`SELECT ${COLUMNS} FROM diagnostics.recording WHERE id = $1`, [id]);
  return row === undefined ? undefined : recordingFrom(row);
}

/** Every recording kept, the most recently started first. */
export async function recordings(db: Db): Promise<readonly Recording[]> {
  const rows = await db.query(`SELECT ${COLUMNS} FROM diagnostics.recording ORDER BY started_at DESC, id DESC`);
  return rows.map(recordingFrom);
}

export type Started = { readonly kind: 'started'; readonly recording: Recording } | { readonly kind: 'under-way'; readonly recording: Recording };

/** Starts a recording, unless one is already under way, which is then given back. */
export async function startRecording(db: Db, client: RecordingClient): Promise<Started> {
  return db.transaction(async (tx) => {
    // Serialises two starts at once, so the second finds the first rather than the unique index.
    await tx.query('LOCK TABLE diagnostics.recording IN SHARE ROW EXCLUSIVE MODE');
    const current = await recordingUnderWay(tx);
    if (current !== undefined) {
      return { kind: 'under-way', recording: current };
    }
    const [row] = await tx.query(`INSERT INTO diagnostics.recording (client) VALUES ($1) RETURNING ${COLUMNS}`, [JSON.stringify(client)]);
    if (row === undefined) {
      throw new Error('a new recording was not returned');
    }
    return { kind: 'started', recording: recordingFrom(row) };
  });
}

/** Ends a recording; one already ended is left as it ended. Undefined when there is no such recording. */
export async function endRecording(db: Db, id: number): Promise<Recording | undefined> {
  await db.query(`UPDATE diagnostics.recording SET ended_at = now(), ended_by = 'learner' WHERE id = $1 AND ended_at IS NULL`, [id]);
  return recording(db, id);
}

/** Removes a recording and everything it saw. False when there was none. */
export async function removeRecording(db: Db, id: number): Promise<boolean> {
  const rows = await db.query('DELETE FROM diagnostics.recording WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

export type Appended =
  | { readonly kind: 'taken'; readonly taken: number; readonly underWay: boolean }
  /** The recording has ended, or there is none under way. */
  | { readonly kind: 'not-under-way' };

type Sourced = { readonly source: 'interface'; readonly event: InterfaceEvent } | { readonly source: 'api'; readonly event: ApiCall };

/**
 * Adds events to a recording under way: the one named, or for `undefined`
 * whichever is under way. A recording takes events until it holds the most it
 * may, and then ends itself as full; what does not fit is dropped.
 */
export async function appendEvents(db: Db, id: number | undefined, events: readonly Sourced[]): Promise<Appended> {
  if (id === undefined && (await db.query('SELECT 1 FROM diagnostics.recording WHERE ended_at IS NULL')).length === 0) {
    // Nothing recording: the common case for every API call, answered without a transaction.
    return { kind: 'not-under-way' };
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.query(
      `SELECT id, events FROM diagnostics.recording WHERE ended_at IS NULL ${id === undefined ? '' : 'AND id = $1'} FOR UPDATE`,
      id === undefined ? [] : [id],
    );
    if (row === undefined) {
      return { kind: 'not-under-way' } as const;
    }
    const held = row['events'];
    if (typeof held !== 'number') {
      throw new TypeError('diagnostics column events is not a number');
    }
    const taken = events.slice(0, RECORDING_MAX_EVENTS - held);
    if (taken.length > 0) {
      await tx.query(
        `INSERT INTO diagnostics.event (recording_id, at, source, body)
         SELECT $1, (item->'event'->>'at')::timestamptz, item->>'source', item->'event'
         FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS given(item, n)
         ORDER BY n`,
        [row['id'], JSON.stringify(taken)],
      );
    }
    const full = held + taken.length >= RECORDING_MAX_EVENTS;
    await tx.query(
      `UPDATE diagnostics.recording SET events = events + $2${full ? ", ended_at = now(), ended_by = 'full'" : ''} WHERE id = $1`,
      [row['id'], taken.length],
    );
    return { kind: 'taken', taken: taken.length, underWay: !full } as const;
  });
}

/** A recording's events, in the order they happened; those at the same moment in the order they were stored. */
export async function eventsOf(db: Db, id: number): Promise<readonly RecordedEvent[]> {
  const rows = await db.query('SELECT seq, source, body FROM diagnostics.event WHERE recording_id = $1 ORDER BY at, seq', [id]);
  return rows.map((row) => RecordedEventSchema.parse({ seq: Number(row['seq']), source: row['source'], event: row['body'] }));
}
