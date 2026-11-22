import type { OpenAPIHono } from '@hono/zod-openapi';
import { ModuleIdSchema } from '@skill-issue/contract';
import type { Catalogue } from './catalogue/catalogue.js';
import type { Db } from './db.js';
import type { Migration } from './migrate.js';
import type { LearningRecord } from './record/record.js';
import { err, ok, type Result } from './result.js';

/** What the core hands a module. A module reaches nothing else. */
export interface ModuleContext {
  readonly db: Db;
  /** Subject material: the only way a module stores or reads it. */
  readonly catalogue: Catalogue;
  /** What the learner did: appended to, never changed. */
  readonly record: LearningRecord;
}

/**
 * How a module declares itself. A module depends on the core and never on
 * another module; this manifest is the only thing the core knows about it.
 */
export interface ModuleManifest {
  /** Unique; also the path segment the module's routes are mounted under. */
  readonly id: string;
  /** Changes to tables the module owns. */
  readonly migrations: readonly { readonly name: string; readonly sql: string }[];
  /** The module's API, mounted under `/api/v1/<id>`. */
  readonly routes?: (context: ModuleContext) => OpenAPIHono;
  /**
   * The tables in the module's own schema that hold what the learner did or
   * wrote, as `<id>.<table>`, in the order they are restored: a table after the
   * tables it refers to. They go into a backup. A table the module can rebuild
   * from the learning record is left out, and rebuilt after a restore.
   */
  readonly personalData?: readonly string[];
}

export type RegistryError =
  | { readonly kind: 'invalid-id'; readonly id: string }
  | { readonly kind: 'reserved-id'; readonly id: string }
  | { readonly kind: 'duplicate-id'; readonly id: string }
  | { readonly kind: 'foreign-table'; readonly id: string; readonly table: string };

export interface Registry {
  readonly modules: readonly ModuleManifest[];
  readonly migrations: readonly Migration[];
}

/** Path segments and migration owners the core keeps for itself. */
const RESERVED_IDS: ReadonlySet<string> = new Set(['core', 'platform', 'health', 'openapi', 'backup']);

/** A table in the module's own schema, named so that it can stand in SQL as written. */
const ownTable = (id: string, table: string): boolean => {
  const [schema, name, ...rest] = table.split('.');
  return schema === id && name !== undefined && rest.length === 0 && /^[a-z][a-z0-9_]*$/.test(name);
};

export function createRegistry(modules: readonly ModuleManifest[]): Result<Registry, RegistryError> {
  const seen = new Set<string>();
  for (const { id } of modules) {
    if (!ModuleIdSchema.safeParse(id).success) {
      return err({ kind: 'invalid-id', id });
    }
    if (RESERVED_IDS.has(id)) {
      return err({ kind: 'reserved-id', id });
    }
    if (seen.has(id)) {
      return err({ kind: 'duplicate-id', id });
    }
    seen.add(id);
  }
  for (const { id, personalData = [] } of modules) {
    const foreign = personalData.find((table) => !ownTable(id, table));
    if (foreign !== undefined) {
      return err({ kind: 'foreign-table', id, table: foreign });
    }
  }
  return ok({
    modules,
    migrations: modules.flatMap((module) =>
      module.migrations.map((migration) => ({ owner: module.id, ...migration })),
    ),
  });
}
