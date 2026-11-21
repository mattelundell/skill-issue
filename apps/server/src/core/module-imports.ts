import { posix } from 'node:path';

/** One import that crosses from one module's folder into another's. */
export interface CrossImport {
  readonly file: string;
  readonly specifier: string;
  readonly reaches: string;
}

/** `from '…'`, `import '…'`, `import('…')` and `require('…')`, static or dynamic. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

/**
 * Every import in the given module sources that resolves into a different
 * module's folder. Paths are relative to the modules folder, `/`-separated:
 * `notes/routes.ts`. The linter cannot express "never into a sibling folder",
 * so this is checked by a test over the real sources.
 */
export function findCrossModuleImports(sources: ReadonlyMap<string, string>): CrossImport[] {
  const found: CrossImport[] = [];
  for (const [file, text] of sources) {
    // A file beside the module folders, such as the list that registers them, belongs to no module.
    if (!file.includes('/')) {
      continue;
    }
    const own = file.split('/')[0];
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? '';
      if (!specifier.startsWith('.')) {
        continue;
      }
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      const reaches = target.split('/')[0] ?? '';
      // Inside its own folder, or up into the core: both allowed. Into a sibling: not.
      if (reaches !== own && reaches !== '..' && target.includes('/')) {
        found.push({ file, specifier, reaches });
      }
    }
  }
  return found;
}
