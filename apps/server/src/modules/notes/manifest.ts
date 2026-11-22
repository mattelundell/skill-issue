import type { ModuleManifest } from '../../core/registry.js';
import { notesRoutes } from './routes.js';
import { noteMigrations } from './store.js';

/** Notes written beside a lesson, filed by lesson and step; browsing and search. */
export const notesModule: ModuleManifest = {
  id: 'notes',
  migrations: noteMigrations,
  routes: notesRoutes,
  personalData: ['notes.note'],
};
