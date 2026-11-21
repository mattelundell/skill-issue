import { err, ok, type ContentFault, type Result } from '@skill-issue/contract';
import { unzipSync, zipSync } from 'fflate';
import type { PackFiles } from './decode.js';
import { describeValue, fault } from './location.js';

/** How much one pack may hold, so that a hostile archive cannot exhaust memory. */
export interface PackLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_LIMITS: PackLimits = {
  maxFiles: 2000,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};

/**
 * Whether an entry name may become a path inside the pack: relative, `/`
 * between folders, no `..`, nothing that names a drive or a device.
 */
export function isSafePath(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) {
    return false;
  }
  return name.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Folders and files an archiving tool adds on its own: `__MACOSX/`, `.DS_Store`, `.git/`. */
const isClutter = (name: string): boolean => name.split('/').some((segment) => segment.startsWith('.') || segment === '__MACOSX');

const limitFault = (expected: string, found: string): ContentFault => fault('pack-too-large', '(archive)', null, '', expected, found);

/**
 * Reads a zip archive into pack files, refusing it whole if any entry would
 * land outside the pack or the archive exceeds the limits. A pack zipped as its
 * folder — every entry under one top-level folder — is read from inside it.
 */
export function readZip(archive: Uint8Array, limits: PackLimits = DEFAULT_LIMITS): Result<PackFiles, ContentFault[]> {
  const faults: ContentFault[] = [];
  let count = 0;
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive, {
      // Runs before an entry is inflated. Inflation writes into a buffer of the
      // declared size and never grows it, so bounding the declared sizes bounds memory.
      filter: (entry) => {
        // Safety first: ".." also starts with a dot, and must be refused, not skipped as clutter.
        const name = entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name;
        if (!isSafePath(name)) {
          faults.push(fault('unsafe-path', entry.name, null, '', 'a relative path inside the pack, without ".." or a leading "/"', describeValue(entry.name)));
          return false;
        }
        if (entry.name.endsWith('/') || isClutter(name)) {
          return false;
        }
        count += 1;
        total += entry.originalSize;
        if (entry.originalSize > limits.maxFileBytes) {
          faults.push(fault('pack-too-large', entry.name, null, '', `a file of at most ${limits.maxFileBytes} bytes`, `${entry.originalSize} bytes`));
          return false;
        }
        return count <= limits.maxFiles && total <= limits.maxTotalBytes;
      },
    });
  } catch (thrown) {
    // Not propagated: a damaged archive is the sender's to fix.
    return err([fault('invalid-archive', '(archive)', null, '', 'a zip archive', thrown instanceof Error ? thrown.message : String(thrown))]);
  }
  if (count > limits.maxFiles) {
    faults.push(limitFault(`at most ${limits.maxFiles} files`, `${count} files`));
  }
  if (total > limits.maxTotalBytes) {
    faults.push(limitFault(`at most ${limits.maxTotalBytes} bytes unpacked`, `${total} bytes`));
  }
  if (faults.length > 0) {
    return err(faults);
  }

  const names = Object.keys(entries);
  const top = names[0]?.split('/')[0];
  const wrapped = top !== undefined && !names.includes('subject.yaml') && names.every((name) => name.startsWith(`${top}/`));
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    files.set(wrapped ? name.slice(top.length + 1) : name, bytes);
  }
  return ok(files);
}

/** A fixed timestamp, so the same pack always gives the same archive; a day past the format's earliest date in every time zone. */
const EPOCH = new Date('1980-01-02T00:00:00Z');

/** Writes pack files as a zip archive with every entry under one folder named `folder`. */
export function writeZip(files: PackFiles, folder: string): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const [path, bytes] of [...files].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    entries[`${folder}/${path}`] = [bytes, { mtime: EPOCH }];
  }
  return zipSync(entries, { level: 6 });
}
