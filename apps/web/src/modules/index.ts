import { checkModules, type WebModule } from '../shell/contract.js';
import { assessmentModule } from './assessment/index.js';
import { diagnosticsModule } from './diagnostics/index.js';
import { glossaryModule } from './glossary/index.js';
import { lessonsModule } from './lessons/index.js';
import { notesModule } from './notes/index.js';
import { progressModule } from './progress/index.js';
import { readerModule } from './reader/index.js';
import { reviewModule } from './review/index.js';

/**
 * The browser side of every module that puts something on screen. This list is
 * the only place that names them: removing a line removes the module's pages,
 * tabs, blocks, figures and lesson marks, and nothing else.
 */
export const webModules: readonly WebModule[] = [readerModule, lessonsModule, assessmentModule, reviewModule, notesModule, glossaryModule, progressModule, diagnosticsModule];

const fault = checkModules(webModules);
if (fault !== undefined) {
  throw new Error(`Browser module "${fault.id}" cannot be registered: ${fault.kind}`);
}
