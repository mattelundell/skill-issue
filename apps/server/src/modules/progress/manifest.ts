import type { ModuleManifest } from '../../core/registry.js';
import { progressRoutes } from './routes.js';

/** Mastery per lesson and area, and learning over time. It owns no tables: every figure is computed from the learning record when asked for. */
export const progressModule: ModuleManifest = {
  id: 'progress',
  migrations: [],
  routes: progressRoutes,
};
