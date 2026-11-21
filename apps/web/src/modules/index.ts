import { checkModules, type WebModule } from '../shell/contract.js';

/**
 * The browser side of every module that puts something on screen. This list is
 * the only place that names them: removing a line removes the module's pages,
 * tabs, blocks, figures and lesson marks, and nothing else.
 *
 * Empty until a module has a screen of its own; the shell draws the start
 * screen and the path from the catalogue alone.
 */
export const webModules: readonly WebModule[] = [];

const fault = checkModules(webModules);
if (fault !== undefined) {
  throw new Error(`Browser module "${fault.id}" cannot be registered: ${fault.kind}`);
}
