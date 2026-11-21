import { join } from 'node:path';
import { LessonPositionSchema, LessonViewSchema, ResumeSchema, SubjectPositionsSchema } from '@skill-issue/contract';
import { readFolder, writeZip, type PackFiles } from '@skill-issue/pack';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { install, type Installation } from './installation.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', '..', '..', 'examples', 'example-subject');
const LESSON = '/api/v1/lessons/subjects/example-subject/lessons/energi-och-effekt';
const LESSON_FILE = 'areas/grunder/lessons/energi-och-effekt/lesson.md';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

let example: PackFiles;

beforeAll(async () => {
  const read = await readFolder(EXAMPLE);
  if (!read.ok) {
    throw new Error(`example pack unreadable: ${JSON.stringify(read.error)}`);
  }
  example = read.value;
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

const view = async (query = '') => {
  const response = await here.app.request(`${LESSON}${query}`);
  const json: unknown = await response.json();
  if (response.status !== 200) {
    throw new Error(`lesson answered ${response.status}: ${JSON.stringify(json)}`);
  }
  return LessonViewSchema.parse(json);
};

async function put(step: number, revision = 1, lesson = LESSON): Promise<{ status: number; json: unknown }> {
  const response = await here.app.request(`${lesson}/position`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step, revision }),
  });
  return { status: response.status, json: await response.json() };
}

const resume = async () => ResumeSchema.parse(await (await here.app.request('/api/v1/lessons/resume')).json());

/** The example lesson with its middle step removed: two steps, a changed revision. */
function withoutExampleStep(files: PackFiles): Map<string, Uint8Array> {
  const text = decode(files.get(LESSON_FILE));
  const step = '---step---\ntype: example\n\nEn värmefläkt på 2 kW som går i 3 timmar använder 2 kW × 3 h = 6 kWh.\n\n';
  if (!text.includes(step)) {
    throw new Error(`${LESSON_FILE} no longer holds the example step these tests remove`);
  }
  // The English translation must keep the same shape, so it goes too.
  const english = new Map(files);
  english.delete('areas/grunder/lessons/energi-och-effekt/lesson.en.md');
  return english.set(LESSON_FILE, encode(text.replace(step, '')));
}

describe('one lesson', () => {
  it('gives its steps in order, its area and its sources, not yet begun', async () => {
    await load(example);

    const { lesson, position, resumeAt, changedSince } = await view();

    expect(lesson).toEqual({
      subjectId: 'example-subject',
      id: 'energi-och-effekt',
      language: 'sv',
      revision: 1,
      title: 'Energi och effekt',
      summary: 'Skillnaden mellan kWh och kW, och varför båda spelar roll.',
      area: { id: 'grunder', language: 'sv', title: 'Grunder' },
      steps: [
        {
          type: 'text',
          body: '**Effekt** är hur fort energi används, och mäts i watt (W) eller kilowatt (kW).\n**Energi** är hur mycket som används totalt, och mäts i kilowattimmar (kWh).',
        },
        { type: 'example', body: 'En värmefläkt på 2 kW som går i 3 timmar använder 2 kW × 3 h = 6 kWh.' },
        { type: 'check', questions: ['kwh-eller-kw', 'berakna-energi'] },
      ],
      sources: [{ id: 'exempelkalla', title: 'Exempelkälla om energi och effekt', publisher: 'Exempelförlaget' }],
    });
    expect({ position, resumeAt, changedSince }).toEqual({ position: null, resumeAt: 0, changedSince: false });
  });

  it('gives the translation’s text at the same steps, and the area in the default language where it has none', async () => {
    await load(example);

    const { lesson } = await view('?language=en');

    expect(lesson.language).toBe('en');
    expect(lesson.title).toBe('Energy and power');
    expect(lesson.revision).toBe(1);
    expect(lesson.area).toEqual({ id: 'grunder', language: 'sv', title: 'Grunder' });
    expect(lesson.steps.map((step) => step.type)).toEqual(['text', 'example', 'check']);
    expect(lesson.steps[1]).toEqual({ type: 'example', body: 'A 2 kW fan heater running for 3 hours uses 2 kW × 3 h = 6 kWh.' });
  });

  it('shows the default language whole when a translation’s steps do not line up with the original’s', async () => {
    const files = new Map(example);
    const en = 'areas/grunder/lessons/energi-och-effekt/lesson.en.md';
    files.set(en, encode(decode(files.get(en)).replace(/---step---\ntype: example\n\n[^\n]*\n\n/, '')));
    await load(files);

    const { lesson } = await view('?language=en');

    expect(lesson.language).toBe('sv');
    expect(lesson.title).toBe('Energi och effekt');
    expect(lesson.steps).toHaveLength(3);
  });

  it('answers a subject or a lesson that does not exist with 404', async () => {
    await load(example);

    const missing = [
      ['/api/v1/lessons/subjects/finns-inte/lessons/energi-och-effekt', 'No such subject'],
      ['/api/v1/lessons/subjects/example-subject/lessons/finns-inte', 'No such lesson'],
    ] as const;
    for (const [path, title] of missing) {
      const response = await here.app.request(path);
      expect({ path, status: response.status, title: ((await response.json()) as { title: string }).title }).toEqual({ path, status: 404, title });
    }
  });
});

describe('where the learner is', () => {
  it('opens a lesson again at the step it was left on', async () => {
    await load(example);

    const saved = await put(2);
    const { position, resumeAt } = await view();

    expect(saved.status).toBe(200);
    expect(LessonPositionSchema.parse(saved.json)).toMatchObject({ step: 2, steps: 3, revision: 1, finishedAt: null });
    expect(position).toMatchObject({ step: 2, steps: 3, revision: 1, finishedAt: null });
    expect(resumeAt).toBe(2);
  });

  it('marks the lesson gone through at the step after the last, opens it from the start, and keeps the mark when it is gone through again', async () => {
    await load(example);

    const end = LessonPositionSchema.parse((await put(3)).json);
    const reopened = await view();
    const again = LessonPositionSchema.parse((await put(1)).json);

    expect(end.finishedAt).not.toBeNull();
    expect(reopened.resumeAt).toBe(0);
    expect(again).toMatchObject({ step: 1, finishedAt: end.finishedAt });
    expect((await view()).resumeAt).toBe(1);
  });

  it('refuses a step beyond the end, a body that is not a position, and a revision that is not the current one', async () => {
    await load(example);

    const beyond = await put(4);
    const notAPosition = await here.app.request(`${LESSON}/position`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"step":-1,"revision":1}' });
    const stale = await put(1, 2);

    expect(beyond).toMatchObject({ status: 400, json: { title: 'No such step' } });
    expect({ status: notAPosition.status, title: ((await notAPosition.json()) as { title: string }).title }).toEqual({ status: 400, title: 'The body is not a position' });
    expect(stale).toMatchObject({ status: 409, json: { title: 'The lesson has changed' } });
    expect((await view()).position).toBeNull();
  });

  it('after a reload that shortened the lesson, says it changed and resumes at its last step', async () => {
    await load(example);
    await put(2);
    await load(withoutExampleStep(example));

    const { lesson, position, resumeAt, changedSince } = await view();

    expect(lesson.revision).toBe(2);
    expect(lesson.steps.map((step) => step.type)).toEqual(['text', 'check']);
    expect(position).toMatchObject({ step: 2, steps: 3, revision: 1 });
    expect({ resumeAt, changedSince }).toEqual({ resumeAt: 1, changedSince: true });
    expect((await put(1, 1)).status).toBe(409);
    expect((await put(1, 2)).status).toBe(200);
    expect((await view()).changedSince).toBe(false);
  });

  it('lists the positions of a subject’s lessons, leaving out a lesson the subject no longer offers', async () => {
    await load(example);
    await put(1);
    await put(2, 1, '/api/v1/lessons/subjects/example-subject/lessons/energibalans');
    const files = new Map(example);
    for (const path of [...files.keys()].filter((p) => p.startsWith('areas/fordjupning/'))) {
      files.delete(path);
    }
    for (const subject of ['subject.yaml', 'subject.en.yaml']) {
      files.set(subject, encode(decode(files.get(subject)).replace('  - fordjupning\n', '')));
    }
    await load(files);

    const response = await here.app.request('/api/v1/lessons/subjects/example-subject/positions');
    const positions = SubjectPositionsSchema.parse(await response.json());

    expect(Object.keys(positions.lessons)).toEqual(['energi-och-effekt']);
    expect(positions.lessons['energi-och-effekt']).toMatchObject({ step: 1 });
    expect((await here.app.request('/api/v1/lessons/subjects/finns-inte/positions')).status).toBe(404);
  });
});

describe('where to take up', () => {
  it('offers nothing and lists no subject before any lesson is begun', async () => {
    await load(example);

    expect(await resume()).toEqual({ offer: null, started: [] });
  });

  it('offers to continue the lesson last moved in, at its step', async () => {
    await load(example);
    await put(1, 1, '/api/v1/lessons/subjects/example-subject/lessons/enhetsprefix');
    await put(1);

    expect(await resume()).toEqual({
      offer: { kind: 'continue', subjectId: 'example-subject', lessonId: 'energi-och-effekt', language: 'sv', title: 'Energi och effekt', areaTitle: 'Grunder', step: 1, steps: 3 },
      started: ['example-subject'],
    });
  });

  it('after the last lesson moved in is gone through, offers the next one on the path not yet gone through', async () => {
    await load(example);
    const prefix = '/api/v1/lessons/subjects/example-subject/lessons/enhetsprefix';
    const steps = LessonViewSchema.parse(await (await here.app.request(prefix)).json()).lesson.steps.length;
    await put(steps, 1, prefix);
    await put(3);

    expect((await resume()).offer).toEqual({ kind: 'next', subjectId: 'example-subject', lessonId: 'energibalans', language: 'sv', title: 'Energibalans', areaTitle: 'Fördjupning' });
  });

  it('offers nothing once the last lesson on the path is gone through', async () => {
    await load(example);
    const last = '/api/v1/lessons/subjects/example-subject/lessons/energibalans';
    const steps = LessonViewSchema.parse(await (await here.app.request(last)).json()).lesson.steps.length;
    await put(steps, 1, last);

    expect(await resume()).toEqual({ offer: null, started: ['example-subject'] });
  });
});
