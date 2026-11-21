import { createHash } from 'node:crypto';
import type { Db } from './db.js';
import { describeThrown } from './log.js';
import { err, ok, type Result } from './result.js';

/** One schema change, owned by the core or by a module. */
export interface Migration {
  /** Who owns the tables it touches: `core` or a module id. */
  readonly owner: string;
  /** Sorts within the owner; by convention `0001_what-it-does`. */
  readonly name: string;
  readonly sql: string;
}

export type MigrationError =
  /** An applied migration no longer matches its source. History is never rewritten. */
  | { readonly kind: 'changed-after-apply'; readonly owner: string; readonly name: string }
  | { readonly kind: 'failed'; readonly owner: string; readonly name: string; readonly reason: string };

export interface MigrationRun {
  readonly applied: readonly { readonly owner: string; readonly name: string }[];
}

/** Any fixed number: it only has to be the same in every process that migrates this database. */
const MIGRATION_LOCK = 4747;

const checksum = (sql: string): string => createHash('sha256').update(sql).digest('hex');

class MigrationAbort extends Error {
  constructor(readonly reason: MigrationError) {
    super(reason.kind);
  }
}

/** The owner of the catalogue and the learning record, which modules' tables may refer to. */
export const CORE_OWNER = 'core';

/** Code-unit order: the same on every machine, unlike a comparison that follows the locale. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The order migrations are applied in: the core's first, then by owner, then by name. */
export function orderMigrations(migrations: readonly Migration[]): Migration[] {
  return migrations.toSorted((a, b) => {
    const coreFirst = Number(b.owner === CORE_OWNER) - Number(a.owner === CORE_OWNER);
    if (coreFirst !== 0) {
      return coreFirst;
    }
    const byOwner = byCodeUnit(a.owner, b.owner);
    return byOwner !== 0 ? byOwner : byCodeUnit(a.name, b.name);
  });
}

/**
 * Applies every migration not yet applied, in the order above, in one
 * transaction: either all of them land or none does.
 */
export async function migrate(
  db: Db,
  migrations: readonly Migration[],
): Promise<Result<MigrationRun, MigrationError>> {
  const ordered = orderMigrations(migrations);

  try {
    const applied = await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      await tx.query('CREATE SCHEMA IF NOT EXISTS platform');
      await tx.query(`
        CREATE TABLE IF NOT EXISTS platform.migration (
          owner      text        NOT NULL,
          name       text        NOT NULL,
          checksum   text        NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (owner, name)
        )`);

      const done: { owner: string; name: string }[] = [];
      for (const migration of ordered) {
        const { owner, name, sql } = migration;
        const existing = await tx.query(
          'SELECT checksum FROM platform.migration WHERE owner = $1 AND name = $2',
          [owner, name],
        );
        const recorded = existing[0];
        if (recorded !== undefined) {
          if (recorded['checksum'] !== checksum(sql)) {
            throw new MigrationAbort({ kind: 'changed-after-apply', owner, name });
          }
          continue;
        }
        try {
          await tx.query(sql);
        } catch (thrown) {
          throw new MigrationAbort({ kind: 'failed', owner, name, reason: describeThrown(thrown) });
        }
        await tx.query('INSERT INTO platform.migration (owner, name, checksum) VALUES ($1, $2, $3)', [
          owner,
          name,
          checksum(sql),
        ]);
        done.push({ owner, name });
      }
      return done;
    });
    return ok({ applied });
  } catch (thrown) {
    if (thrown instanceof MigrationAbort) {
      return err(thrown.reason);
    }
    throw thrown;
  }
}
