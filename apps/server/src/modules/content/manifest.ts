import type { ModuleManifest } from '../../core/registry.js';
import { contentRoutes } from './routes.js';

/** Accepts, validates, versions and exports subject material. It owns no tables: the material lives in the core's catalogue. */
export const contentModule: ModuleManifest = {
  id: 'content',
  migrations: [],
  routes: contentRoutes,
};
