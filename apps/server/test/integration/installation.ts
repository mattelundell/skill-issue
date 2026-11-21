import type { OpenAPIHono } from '@hono/zod-openapi';
import { buildApp } from '../../src/core/app.js';
import { coreMigrations } from '../../src/core/migrations.js';
import type { DbConnection } from '../../src/core/db.js';
import { migrate } from '../../src/core/migrate.js';
import { createRegistry } from '../../src/core/registry.js';
import { modules } from '../../src/modules/index.js';
import { createScratchDatabase } from './database.js';

export interface Installation {
  readonly app: OpenAPIHono;
  readonly db: DbConnection;
  readonly drop: () => Promise<void>;
}

/** A fresh database with the application's migrations applied, and the application on it. */
export async function install(): Promise<Installation> {
  const { db, drop } = await createScratchDatabase();
  const registry = createRegistry(modules);
  if (!registry.ok) {
    throw new Error(`modules do not register: ${registry.error.kind}`);
  }
  const migrated = await migrate(db, [...coreMigrations, ...registry.value.migrations]);
  if (!migrated.ok) {
    throw new Error(`migrations failed: ${JSON.stringify(migrated.error)}`);
  }
  return { app: buildApp({ db, registry: registry.value, version: 'test' }), db, drop };
}
