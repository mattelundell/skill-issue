import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPositions, fetchResume, savePosition } from './api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading where the learner is', () => {
  it('waits for a position still being saved, so leaving a lesson for the start screen never reads the state before it', async () => {
    const asked: string[] = [];
    const save = Promise.withResolvers<Response>();
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = input;
      asked.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'PUT') {
        return save.promise;
      }
      return Response.json(url.endsWith('/resume') ? { offer: null, started: ['kom-igang'], finished: ['kom-igang'] } : { subjectId: 'kom-igang', lessons: {} });
    });

    const saving = savePosition('kom-igang', 'sen', 4, 1);
    const resume = fetchResume(new AbortController().signal);
    const positions = fetchPositions('kom-igang', new AbortController().signal);
    await Promise.resolve();
    // Nothing is read while the save is on its way.
    expect(asked).toEqual(['PUT /api/v1/lessons/subjects/kom-igang/lessons/sen/position']);

    save.resolve(new Response(JSON.stringify({}), { status: 200 }));
    expect(await saving).toBe('saved');
    expect((await resume).kind).toBe('ok');
    expect((await positions).kind).toBe('ok');
    expect(asked.slice(1).toSorted()).toEqual(['GET /api/v1/lessons/resume', 'GET /api/v1/lessons/subjects/kom-igang/positions']);
  });

  it('still reads when the save failed', async () => {
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        throw new TypeError('no connection');
      }
      return Response.json(input.endsWith('/resume') ? { offer: null, started: [], finished: [] } : {});
    });

    expect(await savePosition('kom-igang', 'sen', 4, 1)).toBe('failed');
    expect(await fetchResume(new AbortController().signal)).toEqual({ kind: 'ok', value: { offer: null, started: [], finished: [] } });
  });
});
