import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const ASSET = '/api/v1/content/subjects/example-subject/assets/energiflode.png';

let example: PackFiles;
let png: Uint8Array;

beforeAll(async () => {
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(read.error)}`);
  }
  example = read.value;
  png = new Uint8Array(await readFile(join(EXAMPLE, 'assets', 'energiflode.png')));
});

let here: Installation;

beforeEach(async () => {
  here = await install();
});

afterEach(async () => {
  await here.drop();
});

async function load(files: PackFiles): Promise<void> {
  const response = await here.app.request('/api/v1/content/packs', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: new Uint8Array(writeZip(files, 'example-subject')).buffer,
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`pack refused: ${response.status} ${await response.text()}`);
  }
}

describe('a subject’s assets', () => {
  it('serves a file with its bytes and media type, and nothing the browser could run', async () => {
    await load(example);

    const response = await here.app.request(ASSET);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it('answers a request that already holds the file with 304 and no body', async () => {
    await load(example);
    const etag = (await here.app.request(ASSET)).headers.get('etag');
    expect(etag).not.toBeNull();

    const again = await here.app.request(ASSET, { headers: { 'if-none-match': etag ?? '' } });

    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(again.headers.get('etag')).toBe(etag);
  });

  it('sends the file again when the copy the browser holds is not the current one', async () => {
    await load(example);

    const stale = await here.app.request(ASSET, { headers: { 'if-none-match': `"${'0'.repeat(64)}"` } });

    expect(stale.status).toBe(200);
    expect(new Uint8Array(await stale.arrayBuffer())).toEqual(png);
  });

  it('refuses a file the subject does not carry, a subject that does not exist, and a path out of assets', async () => {
    await load(example);

    const cases = [
      ['/api/v1/content/subjects/example-subject/assets/saknas.png', 'No such file'],
      ['/api/v1/content/subjects/finns-inte/assets/energiflode.png', 'No such file'],
      ['/api/v1/content/subjects/example-subject/assets/..%2Fsubject.yaml', 'No such file'],
    ] as const;
    for (const [path, title] of cases) {
      const response = await here.app.request(path);
      expect({ path, status: response.status, title: ((await response.json()) as { title: string }).title }).toEqual({ path, status: 404, title });
    }
  });

  it('stops serving a file once the subject is reloaded without it', async () => {
    await load(example);
    const withoutImage = new Map(example);
    withoutImage.delete('assets/energiflode.png');
    const lesson = 'areas/fordjupning/lessons/energibalans/lesson.md';
    const text = new TextDecoder().decode(withoutImage.get(lesson));
    withoutImage.set(lesson, new TextEncoder().encode(text.replace('![Energiflöde genom en byggnad](assets/energiflode.png)\n', '')));
    await load(withoutImage);

    const response = await here.app.request(ASSET);

    expect(response.status).toBe(404);
  });
});
