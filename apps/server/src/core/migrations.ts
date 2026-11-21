import { catalogueMigrations } from './catalogue/migrations.js';
import type { Migration } from './migrate.js';
import { recordMigrations } from './record/migrations.js';

/** The core's tables: the catalogue, then the learning record, which refers to it. */
export const coreMigrations: readonly Migration[] = [...catalogueMigrations, ...recordMigrations];
