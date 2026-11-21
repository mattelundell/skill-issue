import type { ModuleManifest } from '../../core/registry.js';
import { readerRoutes } from './routes.js';

/** Shows source material with its origin. It owns no tables: it reads the core's catalogue. */
export const readerModule: ModuleManifest = {
  id: 'reader',
  migrations: [],
  routes: readerRoutes,
};
