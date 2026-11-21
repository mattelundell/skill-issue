import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { err, ok, type ContentFault, type Result } from '@skill-issue/contract';
import type { PackFiles } from './decode.js';
import { describeValue, fault } from './location.js';
import { DEFAULT_LIMITS, type PackLimits } from './zip.js';

/**
 * Reads a pack folder into pack files. Hidden files and folders are skipped,
 * and a symbolic link is refused rather than followed, so nothing outside the
 * folder can be read into a pack.
 */
export async function readFolder(root: string, limits: PackLimits = DEFAULT_LIMITS): Promise<Result<PackFiles, ContentFault[]>> {
  const files = new Map<string, Uint8Array>();
  const faults: ContentFault[] = [];
  let total = 0;

  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const full = join(folder, entry.name);
      const path = relative(root, full).split(sep).join('/');
      if (entry.isSymbolicLink()) {
        faults.push(fault('unsafe-path', path, null, '', 'a regular file or folder, not a symbolic link', describeValue(path)));
      } else if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const { size } = await lstat(full);
        total += size;
        if (size > limits.maxFileBytes) {
          faults.push(fault('pack-too-large', path, null, '', `a file of at most ${limits.maxFileBytes} bytes`, `${size} bytes`));
        } else if (files.size < limits.maxFiles && total <= limits.maxTotalBytes) {
          files.set(path, new Uint8Array(await readFile(full)));
        }
      }
    }
  };

  await walk(root);
  if (files.size >= limits.maxFiles || total > limits.maxTotalBytes) {
    faults.push(fault('pack-too-large', '(folder)', null, '', `at most ${limits.maxFiles} files and ${limits.maxTotalBytes} bytes`, `more, from ${total} bytes read`));
  }
  return faults.length > 0 ? err(faults) : ok(files);
}

/** Writes pack files into `root`, creating folders as needed. */
export async function writeFolder(root: string, files: PackFiles): Promise<void> {
  for (const [path, bytes] of files) {
    const target = join(root, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}
