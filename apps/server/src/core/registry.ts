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
}

export type RegistryError =
  | { readonly kind: 'invalid-id'; readonly id: string }
  | { readonly kind: 'reserved-id'; readonly id: string }
  | { readonly kind: 'duplicate-id'; readonly id: string };

export interface Registry {
  readonly modules: readonly ModuleManifest[];
  readonly migrations: readonly Migration[];
}

/** Path segments and migration owners the core keeps for itself. */
const RESERVED_IDS: ReadonlySet<string> = new Set(['core', 'platform', 'health', 'openapi']);

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
  return ok({
    modules,
    migrations: modules.flatMap((module) =>
      module.migrations.map((migration) => ({ owner: module.id, ...migration })),
    ),
  });
}
