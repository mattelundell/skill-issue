import { API_PREFIX, LessonViewSchema, ResumeSchema, SubjectPositionsSchema, type LessonView, type Resume, type SubjectPositions } from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';
import { learnerTimeZone } from '../../shell/timeZone.js';

const lessonPath = (subjectId: string, lessonId: string): string => `/lessons/subjects/${encodeURIComponent(subjectId)}/lessons/${encodeURIComponent(lessonId)}`;

export const fetchLesson = async (subjectId: string, lessonId: string, language: string, signal: AbortSignal): Promise<Fetched<LessonView>> =>
  getJson(`${lessonPath(subjectId, lessonId)}?language=${encodeURIComponent(language)}`, LessonViewSchema, signal);

/**
 * The position saves still on their way. A lesson shows its next step, or its end,
 * before the save lands, and the learner may leave for the start screen at once;
 * a read of where they are waits for these, so it never shows the state before.
 */
let saving: Promise<unknown> = Promise.resolve();

export const fetchPositions = async (subjectId: string, signal: AbortSignal): Promise<Fetched<SubjectPositions>> =>
  saving.then(async () => getJson(`/lessons/subjects/${encodeURIComponent(subjectId)}/positions`, SubjectPositionsSchema, signal));

/** Each offered lesson comes in its own subject's default language: content language is a choice of its own, not the interface's. */
export const fetchResume = async (signal: AbortSignal): Promise<Fetched<Resume>> => saving.then(async () => getJson('/lessons/resume', ResumeSchema, signal));

/** What saving where the learner is came to: kept, refused because the lesson changed underneath, or not reached. */
export type Saved = 'saved' | 'changed' | 'failed';

export async function savePosition(subjectId: string, lessonId: string, step: number, revision: number): Promise<Saved> {
  const saved = put(subjectId, lessonId, step, revision);
  saving = Promise.all([saving, saved]);
  return saved;
}

async function put(subjectId: string, lessonId: string, step: number, revision: number): Promise<Saved> {
  try {
    const response = await fetch(`${API_PREFIX}${lessonPath(subjectId, lessonId)}/position`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ step, revision, timeZone: learnerTimeZone() }),
    });
    return response.ok ? 'saved' : response.status === 409 ? 'changed' : 'failed';
  } catch {
    // No connection: the learner goes on, and the next step's save tries again.
    return 'failed';
  }
}
