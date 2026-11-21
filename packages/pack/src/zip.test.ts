import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { isSafePath, readZip, writeZip, type PackLimits } from './zip.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const files = new Map([
  ['subject.yaml', bytes('id: x\n')],
  ['areas/a/area.yaml', bytes('id: a\n')],
]);

const limits: PackLimits = { maxFiles: 3, maxFileBytes: 1000, maxTotalBytes: 1500 };

describe('writeZip and readZip', () => {
  it('give back the same files, read from inside the folder the archive wraps them in', () => {
    const archive = writeZip(files, 'my-subject');

    expect(readZip(archive)).toEqual({ ok: true, value: files });
  });

  it('write the same bytes for the same files', () => {
    expect(writeZip(files, 'x')).toEqual(writeZip(new Map([...files].toReversed()), 'x'));
  });

  it('read an archive whose files sit at its root', () => {
    expect(readZip(zipSync({ 'subject.yaml': bytes('id: x\n') }))).toEqual({ ok: true, value: new Map([['subject.yaml', bytes('id: x\n')]]) });
  });

  it('skip what archiving tools add on their own', () => {
    const archive = zipSync({ 'subject.yaml': bytes('a'), '__MACOSX/._subject.yaml': bytes('b'), '.DS_Store': bytes('c') });

    expect(readZip(archive)).toEqual({ ok: true, value: new Map([['subject.yaml', bytes('a')]]) });
  });
});

describe('readZip refuses the whole archive', () => {
  it.each(['../outside.yaml', 'areas/../../outside.yaml', '/etc/passwd', 'C:/windows.yaml', 'areas\\a.yaml'])(
    'when an entry is named %j',
    (name) => {
      const archive = zipSync({ 'subject.yaml': bytes('a'), [name]: bytes('b') });

      expect(readZip(archive)).toEqual({
        ok: false,
        error: [
          {
            code: 'unsafe-path',
            file: name,
            item: null,
            field: '',
            expected: 'a relative path inside the pack, without ".." or a leading "/"',
            found: JSON.stringify(name),
          },
        ],
      });
    },
  );

  it('when one file is larger than allowed', () => {
    const archive = zipSync({ 'subject.yaml': bytes('a'), 'assets/big.png': new Uint8Array(1001) });

    expect(readZip(archive, limits)).toEqual({
      ok: false,
      error: [{ code: 'pack-too-large', file: 'assets/big.png', item: null, field: '', expected: 'a file of at most 1000 bytes', found: '1001 bytes' }],
    });
  });

  it('when the files together are larger than allowed', () => {
    const archive = zipSync({ 'a.png': new Uint8Array(800), 'b.png': new Uint8Array(800) });

    expect(readZip(archive, limits)).toEqual({
      ok: false,
      error: [{ code: 'pack-too-large', file: '(archive)', item: null, field: '', expected: 'at most 1500 bytes unpacked', found: '1600 bytes' }],
    });
  });

  it('when it holds more files than allowed', () => {
    const archive = zipSync({ a: bytes('1'), b: bytes('2'), c: bytes('3'), d: bytes('4') });

    expect(readZip(archive, limits)).toEqual({
      ok: false,
      error: [{ code: 'pack-too-large', file: '(archive)', item: null, field: '', expected: 'at most 3 files', found: '4 files' }],
    });
  });

  it('when it is not a zip archive', () => {
    expect(readZip(bytes('not a zip'))).toMatchObject({ ok: false, error: [{ code: 'invalid-archive', file: '(archive)' }] });
  });
});

describe('readZip against an archive that lies about its sizes', () => {
  it('never unpacks more than the declared size', () => {
    const archive = zipSync({ 'bomb.png': new Uint8Array(5_000_000) }, { level: 9 });
    // The central directory entry: signature, then the uncompressed size 24 bytes in.
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    let entry = archive.length - 22;
    while (view.getUint32(entry, true) !== 0x02014b50) {
      entry -= 1;
    }
    view.setUint32(entry + 24, 10, true);

    // A cap above the compressed size, so the entry is inflated and the declared size is what bounds it.
    const result = readZip(archive, { maxFiles: 3, maxFileBytes: 100_000, maxTotalBytes: 100_000 });

    expect(result.ok ? result.value.get('bomb.png')?.length : result).toBe(10);
  });
});

describe('readZip against a stored entry that lies about its size', () => {
  it('counts the stored bytes, which are what gets copied, not the declared unpacked size', () => {
    // Stored entries are copied by their compressed size, so a header claiming 1 byte unpacked must not let 2,000 through.
    const archive = zipSync({ 'assets/stored.png': [new Uint8Array(2000).fill(7), { level: 0 }] });
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    let entry = archive.length - 22;
    while (view.getUint32(entry, true) !== 0x02014b50) {
      entry -= 1;
    }
    view.setUint32(entry + 24, 1, true);

    expect(readZip(archive, { ...limits, maxTotalBytes: 5000 })).toEqual({
      ok: false,
      error: [{ code: 'pack-too-large', file: 'assets/stored.png', item: null, field: '', expected: 'a file of at most 1000 bytes', found: '2000 bytes' }],
    });
  });
});

describe('isSafePath', () => {
  it.each(['subject.yaml', 'areas/a/lessons/b/lesson.md', 'assets/fig-1.png'])('accepts %j', (name) => {
    expect(isSafePath(name)).toBe(true);
  });

  it.each(['', '.', 'a/./b', 'a//b', '..', 'a/..', 'a\0b'])('refuses %j', (name) => {
    expect(isSafePath(name)).toBe(false);
  });
});
