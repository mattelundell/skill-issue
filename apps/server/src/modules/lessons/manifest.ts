import type { ModuleManifest } from '../../core/registry.js';
import { positionMigrations } from './position.js';
import { lessonsRoutes } from './routes.js';

/** Runs a lesson step by step and tracks where the learner is. */
export const lessonsModule: ModuleManifest = {
  id: 'lessons',
  migrations: positionMigrations,
  routes: lessonsRoutes,
  personalData: ['lessons.position'],
};
