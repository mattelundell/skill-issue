import type { ModuleManifest } from '../../core/registry.js';
import { assessmentRoutes } from './routes.js';
import { sittingMigrations } from './sittings.js';

/** Checks inside lessons, and final exams per lesson and per area. Grades answers. */
export const assessmentModule: ModuleManifest = {
  id: 'assessment',
  migrations: sittingMigrations,
  routes: assessmentRoutes,
  personalData: ['assessment.sitting'],
};
