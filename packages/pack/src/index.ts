import { err, ok, PackSchema, type ContentFault, type Pack, type Result } from '@skill-issue/contract';
import { decodePack, type PackFiles } from './decode.js';
import { sortFaults } from './location.js';
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
