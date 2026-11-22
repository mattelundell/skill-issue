import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, type Backup, type BackupTable, type RestoreResult } from '@skill-issue/contract';
import { z } from 'zod';
import type { Db } from '../db.js';
import { describeThrown } from '../log.js';
import { APPEND_LOCK } from '../record/record.js';
import type { Registry } from '../registry.js';
import { err, ok, type Result } from '../result.js';

/** The core's tables, in the order they restore: the catalogue before the record that refers to it. */
const CORE_TABLES = ['catalogue.subject', 'catalogue.item', 'catalogue.entry', 'catalogue.revision', 'catalogue.asset', 'record.event'] as const;

const CORE_OWNER = 'core';

/** A row as `to_jsonb` writes it: an object keyed by column. */
const RowSchema = z.record(z.string(), z.unknown());

interface OwnedTable {
  readonly owner: string;
  readonly table: string;
}

/**
 * Every table a backup holds, in restore order: the core's, then each module's
 * that names tables as the learner's own, in the order the modules run. A
 * table a module can rebuild from the record, such as review's memory, is not
 * among them, and is rebuilt on its first read after a restore.
 */
function tablesOf(registry: Registry): readonly OwnedTable[] {
  return [
    ...CORE_TABLES.map((table) => ({ owner: CORE_OWNER, table })),
    ...registry.modules.flatMap((module) => (module.personalData ?? []).map((table) => ({ owner: module.id, table }))),
  ];
}

/** The migrations applied, by owner, in the order applied. */
async function migrationsApplied(db: Db): Promise<Record<string, string[]>> {
  const rows = await db.query('SELECT owner, name FROM platform.migration ORDER BY applied_at, owner, name');
  const byOwner: Record<string, string[]> = {};
  for (const row of rows) {
    const owner = String(row['owner']);
    (byOwner[owner] ??= []).push(String(row['name']));
  }
  return byOwner;
}

/**
 * Writes the installation as a backup. Every table is read in one snapshot, so
 * an answer given while the backup is written is either in every table it
 * touches or in none.
 */
export async function writeBackup(db: Db, registry: Registry, application: string): Promise<Backup> {
  return db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const migrations = await migrationsApplied(tx);
    const tables: BackupTable[] = [];
    for (const { owner, table } of tablesOf(registry)) {
      // The table name is one the code declares, never one read from a request.
      const order = table === 'record.event' ? ' ORDER BY seq' : '';
      const rows = await tx.query(`SELECT to_jsonb(t) AS row FROM ${table} t${order}`);
      tables.push({ owner, table, rows: rows.map((row) => RowSchema.parse(row['row'])) });
    }
    return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, application, createdAt: new Date().toISOString(), migrations, tables };
  });
}

export type RestoreError =
  | { readonly kind: 'not-empty'; readonly table: string }
  | { readonly kind: 'other-migrations'; readonly owners: readonly string[] }
  | { readonly kind: 'unowned-table'; readonly owner: string; readonly table: string }
  | { readonly kind: 'does-not-restore'; readonly table: string | undefined; readonly reason: string };

/** Thrown inside the restoring transaction to roll it back with a reason; never leaves this file. */
class RestoreAbort extends Error {
  constructor(readonly reason: RestoreError) {
    super(reason.kind);
  }
}

/** Thrown to roll back a dry run that went through. */
class DryRunDone extends Error {
  constructor(readonly result: RestoreResult) {
    super('dry run');
  }
}

/**
 * Owners whose migrations differ between the backup and this installation. An
 * owner present here and absent from the backup is fine — a module added since
 * starts with empty tables — but one whose tables are in the backup must have
 * exactly the migrations applied here, or its rows could be of another shape.
 */
function differingOwners(backup: Backup, here: Record<string, string[]>, owners: ReadonlySet<string>): string[] {
  return [...owners].filter((owner) => JSON.stringify(backup.migrations[owner] ?? []) !== JSON.stringify(here[owner] ?? []));
}

/**
 * Restores a backup into an empty installation, in one transaction: either all
 * of it is written or none of it is. A dry run does the same and rolls back, so
 * it finds every fault a real restore would, the database's own checks included.
 */
export async function restoreBackup(db: Db, registry: Registry, backup: Backup, options: { readonly dryRun: boolean }): Promise<Result<RestoreResult, RestoreError>> {
  const declared = tablesOf(registry);
  const isDeclared = (owner: string, table: string): boolean => declared.some((d) => d.owner === owner && d.table === table);
  const unowned = backup.tables.find((t) => !isDeclared(t.owner, t.table));
  if (unowned !== undefined) {
    return err({ kind: 'unowned-table', owner: unowned.owner, table: unowned.table });
  }

  try {
    const result = await db.transaction(async (tx) => {
      // No answer may be appended while the record is being filled.
      await tx.query('SELECT pg_advisory_xact_lock($1::bigint)', [APPEND_LOCK]);
      const differing = differingOwners(backup, await migrationsApplied(tx), new Set([CORE_OWNER, ...backup.tables.map((t) => t.owner)]));
      if (differing.length > 0) {
        throw new RestoreAbort({ kind: 'other-migrations', owners: differing });
      }
      for (const { table } of declared) {
        const held = await tx.query(`SELECT EXISTS (SELECT 1 FROM ${table}) AS held`);
        if (held[0]?.['held'] === true) {
          throw new RestoreAbort({ kind: 'not-empty', table });
        }
      }
      // Restored in the order declared here, whatever order the backup lists them in.
      const restored: { owner: string; table: string; rows: number }[] = [];
      for (const { owner, table } of declared) {
        const rows = backup.tables.filter((t) => t.owner === owner && t.table === table).flatMap((t) => t.rows);
        if (rows.length > 0) {
          await insertRows(tx, table, rows);
        }
        if (backup.tables.some((t) => t.owner === owner && t.table === table)) {
          restored.push({ owner, table, rows: rows.length });
        }
      }
      // The record's next row is numbered after the last one restored.
      await tx.query("SELECT setval(pg_get_serial_sequence('record.event', 'seq'), COALESCE((SELECT max(seq) FROM record.event), 1), (SELECT count(*) > 0 FROM record.event))");
      // A deferred check would otherwise fail at commit, out of reach of the table it belongs to.
      await checkDeferred(tx);
      const done = { dryRun: options.dryRun, tables: restored };
      if (options.dryRun) {
        throw new DryRunDone(done);
      }
      return done;
    });
    return ok(result);
  } catch (thrown) {
    if (thrown instanceof DryRunDone) {
      return ok(thrown.result);
    }
    if (thrown instanceof RestoreAbort) {
      return err(thrown.reason);
    }
    throw thrown;
  }
}

async function insertRows(tx: Db, table: string, rows: readonly Record<string, unknown>[]): Promise<void> {
  try {
    await tx.query(
      // OVERRIDING SYSTEM VALUE keeps the record's row numbers, which review's memory and the lesson passes refer to.
      `INSERT INTO ${table} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`,
      [JSON.stringify(rows)],
    );
  } catch (thrown) {
    throw new RestoreAbort({ kind: 'does-not-restore', table, reason: describeThrown(thrown) });
  }
}

/** Runs the checks deferred to commit now, so a fault in them is reported like any other. */
async function checkDeferred(tx: Db): Promise<void> {
  try {
    await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch (thrown) {
    throw new RestoreAbort({ kind: 'does-not-restore', table: undefined, reason: describeThrown(thrown) });
  }
}
