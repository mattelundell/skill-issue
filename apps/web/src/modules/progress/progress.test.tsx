import type { SubjectOutline, SubjectProgress, SubjectSummary } from '@skill-issue/contract';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import type { WebModule } from '../../shell/contract.js';
import { catalogueFaults } from '../../shell/messages.js';
import { assessmentModule } from '../assessment/index.js';
import { lessonsModule } from '../lessons/index.js';
import { percent } from './api.js';
import { progressModule } from './index.js';
import { catalogues } from './messages.js';

const SUBJECT: SubjectSummary = { id: 'example-subject', defaultLanguage: 'sv', languages: ['sv'], title: 'Exempelämne', summary: 'Energi.' };
const OUTLINE: SubjectOutline = {
  ...SUBJECT,
  language: 'sv',
  areas: [
    {
      id: 'grunder',
      language: 'sv',
      title: 'Grunder',
      summary: 'Storheterna.',
      requires: [],
      lessons: [
        { id: 'energi-och-effekt', language: 'sv', title: 'Energi och effekt', summary: 'kWh och kW.' },
        { id: 'enhetsprefix', language: 'sv', title: 'Enhetsprefix', summary: 'Kilo och mega.' },
      ],
    },
    { id: 'fordjupning', language: 'sv', title: 'Fördjupning', summary: 'Balansen.', requires: ['grunder'], lessons: [{ id: 'energibalans', language: 'sv', title: 'Energibalans', summary: 'In och ut.' }] },
  ],
};

const days = (filled: Readonly<Record<number, { answers: number; correct: number; recall: number }>>): SubjectProgress['days'] =>
  Array.from({ length: 30 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 9, 24 + index)).toISOString().slice(0, 10);
    return { day, answers: 0, correct: 0, recall: 0, ...filled[index] };
  });

const PROGRESS: SubjectProgress = {
  subjectId: 'example-subject',
  target: 0.9,
  recall: 0.4129,
  questions: 8,
  met: 5,
  areas: [
    {
      areaId: 'grunder',
      recall: 0.5506,
      questions: 6,
      met: 5,
      lessons: [
        // Short of the target by a hair: it must not read "90 %".
        { lessonId: 'energi-och-effekt', recall: 0.8996, questions: 3, met: 3, passed: true, mastered: false },
        { lessonId: 'enhetsprefix', recall: 0.95, questions: 3, met: 2, passed: true, mastered: true },
      ],
    },
    { areaId: 'fordjupning', recall: 0, questions: 2, met: 0, lessons: [{ lessonId: 'energibalans', recall: 0, questions: 2, met: 0, passed: false, mastered: false }] },
  ],
  days: days({ 27: { answers: 4, correct: 3, recall: 0.2 }, 28: { answers: 2, correct: 1, recall: 0.35 }, 29: { answers: 1, correct: 1, recall: 0.4129 } }),
  weakSpots: [{ concept: 'si-prefix', name: 'SI-prefix', wrong: 2, answers: 3, lessonId: 'enhetsprefix' }],
};

const NOTHING_YET: SubjectProgress = {
  ...PROGRESS,
  recall: 0,
  met: 0,
  areas: PROGRESS.areas.map((area) => ({ ...area, recall: 0, met: 0, lessons: area.lessons.map((lesson) => ({ ...lesson, recall: 0, met: 0, passed: false, mastered: false })) })),
  days: days({}),
  weakSpots: [],
};

const api: { progress: SubjectProgress | 'down'; passed: readonly string[]; requested: string[] } = { progress: PROGRESS, passed: [], requested: [] };

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  api.progress = PROGRESS;
  api.passed = [];
  api.requested = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
    api.requested.push(`${url.pathname}${url.search}`);
    switch (url.pathname) {
      case '/api/v1/health':
        return json({ status: 'ok', version: 'test', database: 'up', modules: ['content', 'lessons', 'assessment', 'progress'] });
      case '/api/v1/content/subjects':
        return json([SUBJECT]);
      case '/api/v1/content/subjects/example-subject':
        return json(OUTLINE);
      case '/api/v1/progress/subjects/example-subject':
        return api.progress === 'down' ? json({ type: 'about:blank', title: 'Down', status: 503 }, 503) : json(api.progress);
      case '/api/v1/assessment/subjects/example-subject/passed':
        return json({ subjectId: 'example-subject', lessons: api.passed, areas: [] });
      default:
        return json({ type: 'about:blank', title: 'Not found', status: 404 }, 404);
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string, modules: readonly WebModule[] = [lessonsModule, assessmentModule, progressModule]): void {
  window.history.replaceState(null, '', path);
  render(<App modules={modules} />);
}

describe('the Progress tab', () => {
  it('says how much of the subject is remembered now, and how many of its questions have been answered', async () => {
    open('/subjects/example-subject/progress');

    const summary = await screen.findByText('av ämnets frågor minns du just nu');
    expect(summary.closest('p')?.textContent).toBe(`${percent(0.4129, 'sv', 0.9)} av ämnets frågor minns du just nu`);
    expect(percent(0.4129, 'sv', 0.9)).toBe('41 %');
    // To the nearest percent: every question remembered, a moment after, is 100 %, not 99 %.
    expect(percent(0.996, 'sv', 0.9)).toBe('100 %');
    expect(percent(0.4171, 'sv', 0.9)).toBe('42 %');
    // But never up to the target from below it: 89.96 % of a 90 % target is not on it.
    expect(percent(0.8996, 'sv', 0.9)).toBe('89 %');
    expect(percent(0.9, 'sv', 0.9)).toBe('90 %');
    expect(screen.getByText('Du har svarat på 5 av 8 frågor.')).toBeTruthy();
    expect(screen.getByText(/minst 90 % av dess frågor/)).toBeTruthy();
    // The tab is named in the subject's tabs.
    expect(screen.getByRole('link', { name: 'Framsteg' }).getAttribute('href')).toBe('/subjects/example-subject/progress');
  });

  it('gives each area and lesson its share remembered, to the nearest percent but never up to the target from below, so a lesson short of it never reads as on it, with which are passed and mastered, each lesson linked', async () => {
    open('/subjects/example-subject/progress');

    const grunder = await screen.findByRole('region', { name: 'Grunder' });
    expect(within(grunder).getByRole('heading', { level: 3 }).textContent).toBe('Grunder55 %');
    const rows = within(grunder).getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toEqual(['Energi och effektGodkänd89 %', 'EnhetsprefixBehärskad95 %']);
    expect(within(grunder).getByRole('link', { name: 'Energi och effekt' }).getAttribute('href')).toBe('/subjects/example-subject/lessons/energi-och-effekt');
    expect(within(screen.getByRole('region', { name: 'Fördjupning' })).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['Energibalans0 %']);
  });

  it('sums up the last thirty days, how the share remembered has moved, and names each day for a screen reader', async () => {
    open('/subjects/example-subject/progress');

    const time = await screen.findByRole('region', { name: 'Över tid' });
    expect(within(time).getByText(/De senaste 30 dagarna/).textContent).toBe('De senaste 30 dagarna: 7 svar, 71 % rätt. Vad du minns av ämnet har gått från 0 % till 41 %.');
    const named = within(time).getAllByRole('listitem').map((day) => day.textContent);
    expect(named).toHaveLength(30);
    expect(named.slice(-3)).toEqual(['20 nov.: 4 svar, 3 rätt, minns 20 %', '21 nov.: 2 svar, 1 rätt, minns 35 %', '22 nov.: 1 svar, 1 rätt, minns 41 %']);
    // One column for each day with answers, and nothing drawn for the others.
    expect(time.querySelectorAll('rect.answers')).toHaveLength(3);
  });

  it('names the weak spots with how often each was answered wrongly, linked to the lesson that teaches it', async () => {
    open('/subjects/example-subject/progress');

    const weak = await screen.findByRole('region', { name: 'Svaga punkter' });
    expect(within(weak).getAllByRole('listitem').map((spot) => spot.textContent)).toEqual(['SI-prefix2 fel av 3 svarEnhetsprefix']);
    // Asked in the language the subject is read in, so the weak spots are named in it.
    expect(api.requested).toContain(`/api/v1/progress/subjects/example-subject?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}&language=sv`);
    expect(within(weak).getByRole('link', { name: 'Enhetsprefix' }).getAttribute('href')).toBe('/subjects/example-subject/lessons/enhetsprefix');
  });

  it('says there is nothing to show before a question has been answered', async () => {
    api.progress = NOTHING_YET;
    open('/subjects/example-subject/progress');

    expect(await screen.findByRole('heading', { name: 'Inget att visa än' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Över tid' })).toBeNull();
  });

  it('says so, with a way to try again, when progress cannot be read', async () => {
    api.progress = 'down';
    open('/subjects/example-subject/progress');

    expect(await screen.findByRole('heading', { name: 'Framstegen går inte att hämta just nu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Försök igen' })).toBeTruthy();
  });

  it('names a lesson without a link when no module draws lessons', async () => {
    open('/subjects/example-subject/progress', [progressModule]);

    const grunder = await screen.findByRole('region', { name: 'Grunder' });
    expect(within(grunder).getByText('Energi och effekt').closest('a')).toBeNull();
  });
});

describe('the path with progress', () => {
  it('marks a mastered lesson as mastered, over the passed mark assessment gives it, and leaves a lesson only passed as passed', async () => {
    api.passed = ['energi-och-effekt', 'enhetsprefix'];
    open('/subjects/example-subject');

    const area = await screen.findByRole('region', { name: 'Grunder' });
    await vi.waitFor(() => expect(area.querySelector('li[data-lesson="enhetsprefix"]')?.getAttribute('data-state')).toBe('mastered'));
    expect(area.querySelector('li[data-lesson="energi-och-effekt"]')?.getAttribute('data-state')).toBe('passed');
  });
});

describe('on the start screen', () => {
  it('gives each subject the share of it remembered now', async () => {
    open('/');

    expect(await screen.findByText('Minns 41 %')).toBeTruthy();
  });

  it('says nothing before a question has been answered', async () => {
    api.progress = NOTHING_YET;
    open('/');

    await screen.findByText('Exempelämne');
    await vi.waitFor(() => expect(api.requested.some((request) => request.startsWith('/api/v1/progress/subjects/example-subject'))).toBe(true));
    expect(screen.queryByText(/^Minns/)).toBeNull();
  });
});

describe('without the progress module', () => {
  it('has no tab, no figure and no mastered mark, and asks nothing of progress', async () => {
    api.passed = ['enhetsprefix'];
    open('/subjects/example-subject', [lessonsModule, assessmentModule]);

    const area = await screen.findByRole('region', { name: 'Grunder' });
    await vi.waitFor(() => expect(area.querySelector('li[data-lesson="enhetsprefix"]')?.getAttribute('data-state')).toBe('passed'));
    expect(screen.queryByRole('link', { name: 'Framsteg' })).toBeNull();
    expect(api.requested.some((request) => request.startsWith('/api/v1/progress'))).toBe(false);
  });
});

describe('the progress module’s text', () => {
  it('has every message in both languages, with the same placeholders', () => {
    expect(catalogueFaults(catalogues)).toEqual([]);
  });
});
