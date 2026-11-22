import { z } from 'zod';
import type { Db } from '../../core/db.js';
import type { LearningRecord, RecordedAnswer } from '../../core/record/record.js';
import { remember, SCHEDULER_ID, type Card, type Remembered, type Scheduler } from '../../core/memory/memory.js';

/**
 * Each question's memory as the scheduler left it, rebuilt from the learning
 * record. The record is the truth; these tables are a view of it that is
 * brought up to date on every read, and replayed from the first row when the
 * scheduler that built them is no longer the one in use.
 */
export const memoryMigrations = [
  {
    name: '0001_memory',
    sql: `
CREATE SCHEMA review;

-- Every question the learner has met, as of the last answer that counted. Progress attaches to the id, not the language.
CREATE TABLE review.memory (
  subject_id  text        NOT NULL,
  question_id text        NOT NULL,
  -- The scheduler's own card: difficulty, stability, due date and its counts.
  card        jsonb       NOT NULL,
  due_at      timestamptz NOT NULL,
  -- The last answer that counted: only the first answer of a day, in the learner's time zone, does.
  counted_at  timestamptz NOT NULL,
  PRIMARY KEY (subject_id, question_id)
);

CREATE INDEX memory_due ON review.memory (subject_id, due_at);

-- How far into the learning record the memory has been brought, and by which scheduler. One row.
CREATE TABLE review.replay (
  only_row  boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  seq       bigint  NOT NULL CHECK (seq >= 0),
  scheduler text    NOT NULL
);
`,
  },
] as const;

/** One question's memory, as the review module keeps it. */
export interface Memory extends Remembered {
  readonly subjectId: string;
  readonly questionId: string;
  readonly dueAt: Date;
}

const BATCH = 500;

const MemoryRowSchema = z.object({
  subject_id: z.string(),
  question_id: z.string(),
  card: z.record(z.string(), z.unknown()),
  due_at: z.date(),
  counted_at: z.date(),
});

const ReplayRowSchema = z.object({ seq: z.coerce.number().int(), scheduler: z.string() });

/** The card as stored: times as ISO text, which JSON keeps; read back with its times as dates again. */
function cardFrom(kept: Readonly<Record<string, unknown>>, scheduler: Scheduler): Card {
  const dueAt = z.iso.datetime().parse(kept['dueAt']);
  const lastReviewAt = z.iso.datetime().nullable().parse(kept['lastReviewAt'] ?? null);
  // The library checks the whole card against its own schema, so a card that is not one fails here rather than scheduling wrongly.
  return { ...scheduler.newCard({ now: new Date(dueAt) }), ...kept, dueAt: new Date(dueAt), lastReviewAt: lastReviewAt === null ? null : new Date(lastReviewAt) };
}

function memoryFrom(row: unknown, scheduler: Scheduler): Memory {
  const parsed = MemoryRowSchema.parse(row);
  return { subjectId: parsed.subject_id, questionId: parsed.question_id, card: cardFrom(parsed.card, scheduler), dueAt: parsed.due_at, countedAt: parsed.counted_at };
}

const keyOf = (subjectId: string, questionId: string): string => `${subjectId}\u0000${questionId}`;

/** Folds answers, in the order written, into the memories they touch; returns those that changed. */
export function fold(answers: readonly RecordedAnswer[], known: ReadonlyMap<string, Memory>, scheduler: Scheduler): Map<string, Memory> {
  const changed = new Map<string, Memory>();
  for (const answer of answers) {
    const { subjectId, id: questionId } = answer.question;
    const key = keyOf(subjectId, questionId);
    const next = remember(scheduler, answer, changed.get(key) ?? known.get(key));
    if (next !== undefined) {
      changed.set(key, { subjectId, questionId, ...next, dueAt: next.card.dueAt });
    }
  }
  return changed;
}

async function memoriesOf(tx: Db, answers: readonly RecordedAnswer[], scheduler: Scheduler): Promise<Map<string, Memory>> {
  const subjects = answers.map((answer) => answer.question.subjectId);
  const questions = answers.map((answer) => answer.question.id);
  const rows = await tx.query(
    `SELECT m.subject_id, m.question_id, m.card, m.due_at, m.counted_at
       FROM review.memory m
       JOIN unnest($1::text[], $2::text[]) AS wanted (subject_id, question_id) USING (subject_id, question_id)`,
    [subjects, questions],
  );
  return new Map(rows.map((row) => {
    const memory = memoryFrom(row, scheduler);
    return [keyOf(memory.subjectId, memory.questionId), memory];
  }));
}

/** The card without the id the library gives each new one at random, so a replay stores exactly what was stored live. */
function stored(card: Card): Omit<Card, 'cardId'> {
  const { cardId: _random, ...kept } = card;
  return kept;
}

async function store(tx: Db, memories: Iterable<Memory>): Promise<void> {
  for (const memory of memories) {
    await tx.query(
      `INSERT INTO review.memory (subject_id, question_id, card, due_at, counted_at) VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (subject_id, question_id) DO UPDATE SET card = EXCLUDED.card, due_at = EXCLUDED.due_at, counted_at = EXCLUDED.counted_at`,
      [memory.subjectId, memory.questionId, JSON.stringify(stored(memory.card)), memory.dueAt.toISOString(), memory.countedAt.toISOString()],
    );
  }
}

/**
 * Brings the memory up to date with the learning record: every answer written
 * since the last time, in the order written. Run before every read. A memory
 * built by another scheduler is thrown away and replayed from the first row.
 * The replay row is locked for the duration, so two reads at once fold each
 * answer once. The record makes its rows visible in the order they are
 * numbered, so a row is never passed over for having committed late.
 */
export async function catchUp(db: Db, record: LearningRecord, scheduler: Scheduler): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`INSERT INTO review.replay (only_row, seq, scheduler) VALUES (true, 0, $1) ON CONFLICT (only_row) DO NOTHING`, [SCHEDULER_ID]);
    const replay = ReplayRowSchema.parse((await tx.query(`SELECT seq, scheduler FROM review.replay WHERE only_row FOR UPDATE`))[0]);
    let seq = replay.seq;
    if (replay.scheduler !== SCHEDULER_ID) {
      await tx.query('DELETE FROM review.memory');
      seq = 0;
    }
    for (;;) {
      const answers = await record.answersAfter(seq, BATCH);
      const last = answers.at(-1);
      if (last === undefined) {
        break;
      }
      await store(tx, fold(answers, await memoriesOf(tx, answers, scheduler), scheduler).values());
      seq = last.seq;
    }
    await tx.query(`UPDATE review.replay SET seq = $1, scheduler = $2 WHERE only_row`, [seq, SCHEDULER_ID]);
  });
}

/** Throws the memory away and replays the whole learning record into it. */
export async function rebuild(db: Db, record: LearningRecord, scheduler: Scheduler): Promise<void> {
  await db.query(`INSERT INTO review.replay (only_row, seq, scheduler) VALUES (true, 0, '') ON CONFLICT (only_row) DO UPDATE SET seq = 0, scheduler = ''`);
  await catchUp(db, record, scheduler);
}

/** Every question of a subject the learner has met, with when it is due. */
export async function memoriesIn(db: Db, subjectId: string | undefined, scheduler: Scheduler): Promise<readonly Memory[]> {
  const rows =
    subjectId === undefined
      ? await db.query(`SELECT subject_id, question_id, card, due_at, counted_at FROM review.memory ORDER BY subject_id, due_at, question_id`)
      : await db.query(`SELECT subject_id, question_id, card, due_at, counted_at FROM review.memory WHERE subject_id = $1 ORDER BY due_at, question_id`, [subjectId]);
  return rows.map((row) => memoryFrom(row, scheduler));
}
