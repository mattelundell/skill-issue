import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findCrossModuleImports } from './module-imports.js';

const MODULES = join(import.meta.dirname, '..', 'modules');

function moduleSources(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const entry of readdirSync(MODULES, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      const full = join(entry.parentPath, entry.name);
      sources.set(relative(MODULES, full).split(sep).join('/'), readFileSync(full, 'utf8'));
    }
  }
  return sources;
}

describe('findCrossModuleImports', () => {
  it('finds no module importing another in the application', () => {
    const sources = moduleSources();

    expect(sources.has('content/routes.ts')).toBe(true);
    expect(findCrossModuleImports(sources)).toEqual([]);
  });

  it('allows imports within a module, from the core, and by the list that registers the modules', () => {
    const sources = new Map([
      ['notes/routes.ts', "import { x } from './search.js';\nimport type { Db } from '../../core/db.js';\nimport { z } from 'zod';"],
      ['notes/deep/a.ts', "export { y } from '../search.js';"],
      ['index.ts', "import { notesModule } from './notes/manifest.js';"],
    ]);

    expect(findCrossModuleImports(sources)).toEqual([]);
  });

  it('reports every form of import that reaches into a sibling module', () => {
    const sources = new Map([
      [
        'review/schedule.ts',
        [
          "import { grade } from '../assessment/grade.js';",
          "import type { Note } from '../notes/types.js';",
          "export * from '../progress/index.js';",
          "const lazy = await import('../lessons/run.js');",
          "import '../diagnostics/side-effect.js';",
        ].join('\n'),
      ],
      ['review/deep/x.ts', "import { a } from '../../reader/a.js';"],
    ]);

    expect(findCrossModuleImports(sources)).toEqual([
      { file: 'review/schedule.ts', specifier: '../assessment/grade.js', reaches: 'assessment' },
      { file: 'review/schedule.ts', specifier: '../notes/types.js', reaches: 'notes' },
      { file: 'review/schedule.ts', specifier: '../progress/index.js', reaches: 'progress' },
      { file: 'review/schedule.ts', specifier: '../lessons/run.js', reaches: 'lessons' },
      { file: 'review/schedule.ts', specifier: '../diagnostics/side-effect.js', reaches: 'diagnostics' },
      { file: 'review/deep/x.ts', specifier: '../../reader/a.js', reaches: 'reader' },
    ]);
  });
});
