import type { ModuleManifest } from '../../core/registry.js';
import { notesRoutes } from './routes.js';
import { noteMigrations } from './store.js';

/** A notebook per subject: a section for each area and lesson, the images added to them, browsing, search and export. */
export const notesModule: ModuleManifest = {
  id: 'notes',
  migrations: noteMigrations,
  routes: notesRoutes,
  personalData: ['notes.section', 'notes.image'],
};
