import type { ModuleManifest } from '../../core/registry.js';
import { glossaryRoutes } from './routes.js';

/** A subject's glossary, read for marking terms in lessons. It owns no tables: it reads the core's catalogue. */
export const glossaryModule: ModuleManifest = {
  id: 'glossary',
  migrations: [],
  routes: glossaryRoutes,
};
