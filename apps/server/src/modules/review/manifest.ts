import type { ModuleManifest } from '../../core/registry.js';
import { memoryMigrations } from './memory.js';
import { reviewRoutes } from './routes.js';

/** Schedules questions to come back, from the learning record, and says which are due. */
export const reviewModule: ModuleManifest = {
  id: 'review',
  migrations: memoryMigrations,
  routes: reviewRoutes,
};
