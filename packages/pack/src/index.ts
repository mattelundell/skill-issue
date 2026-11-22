import { err, ok, PackSchema, type ContentFault, type Pack, type Result } from '@skill-issue/contract';
import { decodePack, type PackFiles } from './decode.js';
import { encodePack } from './encode.js';
import { fault, sortFaults } from './location.js';
import { DEFAULT_LIMITS, type PackLimits } from './zip.js';
import { ruleFaults } from './rules.js';
import { schemaFaults } from './schema-faults.js';

export { decodePack, type PackFiles } from './decode.js';
export { encodePack } from './encode.js';
export { readFolder, writeFolder } from './folder.js';
export { fileOf, layoutOf } from './location.js';
export { DEFAULT_LIMITS, isSafePath, readZip, writeZip, type PackLimits } from './zip.js';

/**
 * Checks a pack sent as JSON against the schema and then the rules. Returns
 * the pack as the application stores it, or every fault found.
 */
export function checkPack(input: unknown): Result<Pack, ContentFault[]> {
  const parsed = PackSchema.safeParse(input);
  if (!parsed.success) {
    return err(sortFaults(schemaFaults(input, parsed.error)));
  }
  const faults = ruleFaults(parsed.data);
  return faults.length > 0 ? err(sortFaults(faults)) : ok(parsed.data);
}

/** Checks a pack given as the files of a pack folder. */
export function checkPackFiles(files: PackFiles): Result<Pack, ContentFault[]> {
  const decoded = decodePack(files);
  if (!decoded.readable) {
    return err(sortFaults(decoded.faults));
  }
  const checked = checkPack(decoded.pack);
  if (decoded.faults.length === 0) {
    return checked;
  }
  // A fault in the files often causes schema faults downstream; both are reported.
  return err(sortFaults([...decoded.faults, ...(checked.ok ? [] : checked.error)]));
}

/**
 * Whether a pack, written out as a folder, stays within the limits a pack is
 * read under: so that what is stored can always be exported and loaded again,
 * here or anywhere else. A pack sent whole is bounded by its size on the wire;
 * a subject grown an item at a time is not, and is measured here.
 */
export function limitFaults(pack: Pack, limits: PackLimits = DEFAULT_LIMITS): ContentFault[] {
  const faults: ContentFault[] = [];
  let total = 0;
  const files = encodePack(pack);
  for (const [path, bytes] of files) {
    total += bytes.length;
    if (bytes.length > limits.maxFileBytes) {
      faults.push(fault('pack-too-large', path, null, '', `a file of at most ${limits.maxFileBytes} bytes`, `${bytes.length} bytes`));
    }
  }
  if (files.size > limits.maxFiles || total > limits.maxTotalBytes) {
    faults.push(fault('pack-too-large', '(pack)', null, '', `at most ${limits.maxFiles} files and ${limits.maxTotalBytes} bytes`, `${files.size} files and ${total} bytes`));
  }
  return faults;
}
