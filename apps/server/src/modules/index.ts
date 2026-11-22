import type { ModuleManifest } from '../core/registry.js';
import { assessmentModule } from './assessment/manifest.js';
import { contentModule } from './content/manifest.js';
import { diagnosticsModule } from './diagnostics/manifest.js';
import { glossaryModule } from './glossary/manifest.js';
import { lessonsModule } from './lessons/manifest.js';
import { notesModule } from './notes/manifest.js';
import { progressModule } from './progress/manifest.js';
import { readerModule } from './reader/manifest.js';
import { reviewModule } from './review/manifest.js';

/**
 * Every module the application runs. This list is the only place that names
 * them: removing a line removes the function.
 */
export const modules: readonly ModuleManifest[] = [
  contentModule,
  readerModule,
  glossaryModule,
  lessonsModule,
  assessmentModule,
  reviewModule,
  notesModule,
  progressModule,
  diagnosticsModule,
];
