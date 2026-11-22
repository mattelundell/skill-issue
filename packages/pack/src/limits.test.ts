import { join } from 'node:path';
import type { Pack } from '@skill-issue/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkPackFiles, DEFAULT_LIMITS, encodePack, limitFaults, readFolder } from './index.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', 'examples', 'example-subject');

let example: Pack;

beforeAll(async () => {
  const read = await readFolder(EXAMPLE);
  const checked = read.ok ? checkPackFiles(read.value) : read;
  if (!checked.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(checked.error)}`);
  }
  example = checked.value;
});

/** The example's files as a pack folder: how many, the largest, and all together. */
function measured(pack: Pack): { readonly files: number; readonly largest: number; readonly total: number } {
  const sizes = [...encodePack(pack).values()].map((bytes) => bytes.length);
  return { files: sizes.length, largest: Math.max(...sizes), total: sizes.reduce((sum, size) => sum + size, 0) };
}

describe('the limits a pack is held to, measured on its files', () => {
  it('finds nothing in a pack within them', () => {
    expect(limitFaults(example, DEFAULT_LIMITS)).toEqual([]);
  });

  it('names a file larger than one file may be', () => {
    const { largest, files, total } = measured(example);
    const faults = limitFaults(example, { maxFiles: files, maxFileBytes: largest - 1, maxTotalBytes: total });
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ code: 'pack-too-large', item: null, expected: `a file of at most ${largest - 1} bytes`, found: `${largest} bytes` });
  });

  it('says when the pack as a whole holds too many files or bytes', () => {
    const { largest, files, total } = measured(example);
    expect(limitFaults(example, { maxFiles: files - 1, maxFileBytes: largest, maxTotalBytes: total })).toEqual([
      { code: 'pack-too-large', file: '(pack)', item: null, field: '', expected: `at most ${files - 1} files and ${total} bytes`, found: `${files} files and ${total} bytes` },
    ]);
    expect(limitFaults(example, { maxFiles: files, maxFileBytes: largest, maxTotalBytes: total - 1 })).toEqual([
      { code: 'pack-too-large', file: '(pack)', item: null, field: '', expected: `at most ${files} files and ${total - 1} bytes`, found: `${files} files and ${total} bytes` },
    ]);
  });
});
