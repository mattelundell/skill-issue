import { z } from 'zod';

/**
 * A backup of one installation: every subject with every revision it has held,
 * the learning record, and what each module keeps about the learner. Restoring
 * it into an empty installation of the same version reproduces the learner's
 * state exactly.
 *
 * A pack is not enough for this, because it carries only each item's current
 * revision, while the learning record names the revision that was answered.
 */

/** Who owns a table: the core, or a module by its id. */
export const BackupOwnerSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

/** A table as `schema.table`, both in lower case. */
export const BackupTableNameSchema = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);

/**
 * One table's rows, each as PostgreSQL writes a row as JSON: column names as
 * keys, times with their full precision, binary data as `\x`-prefixed hex.
 */
export const BackupTableSchema = z.strictObject({
  owner: BackupOwnerSchema,
  table: BackupTableNameSchema,
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type BackupTable = z.infer<typeof BackupTableSchema>;

export const BACKUP_FORMAT = 'skill-issue-backup';
export const BACKUP_FORMAT_VERSION = 1;

export const BackupSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  /** The application version that wrote it. */
  application: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  /** The migrations applied when it was written, by owner, in the order applied: the shape every table's rows have. */
  migrations: z.record(BackupOwnerSchema, z.array(z.string())),
  /** Every table, in the order it is restored: a table comes after the tables it refers to. */
  tables: z.array(BackupTableSchema),
});
export type Backup = z.infer<typeof BackupSchema>;

/** What a restore wrote, or with a dry run would have written: every table, with how many rows. */
export const RestoreResultSchema = z.object({
  dryRun: z.boolean(),
  tables: z.array(z.object({ owner: BackupOwnerSchema, table: BackupTableNameSchema, rows: z.number().int().min(0) })),
});
export type RestoreResult = z.infer<typeof RestoreResultSchema>;
