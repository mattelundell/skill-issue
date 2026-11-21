import { API_PREFIX, LessonViewSchema, ResumeSchema, SubjectPositionsSchema, type LessonView, type Resume, type SubjectPositions } from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';

const lessonPath = (subjectId: string, lessonId: string): string => `/lessons/subjects/${encodeURIComponent(subjectId)}/lessons/${encodeURIComponent(lessonId)}`;

export const fetchLesson = async (subjectId: string, lessonId: string, language: string, signal: AbortSignal): Promise<Fetched<LessonView>> =>
  getJson(`${lessonPath(subjectId, lessonId)}?language=${encodeURIComponent(language)}`, LessonViewSchema, signal);

export const fetchPositions = async (subjectId: string, signal: AbortSignal): Promise<Fetched<SubjectPositions>> =>
  getJson(`/lessons/subjects/${encodeURIComponent(subjectId)}/positions`, SubjectPositionsSchema, signal);

export const fetchResume = async (language: string, signal: AbortSignal): Promise<Fetched<Resume>> =>
  getJson(`/lessons/resume?language=${encodeURIComponent(language)}`, ResumeSchema, signal);

/** What saving where the learner is came to: kept, refused because the lesson changed underneath, or not reached. */
export type Saved = 'saved' | 'changed' | 'failed';

export async function savePosition(subjectId: string, lessonId: string, step: number, revision: number): Promise<Saved> {
  try {
    const response = await fetch(`${API_PREFIX}${lessonPath(subjectId, lessonId)}/position`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ step, revision }),
    });
    return response.ok ? 'saved' : response.status === 409 ? 'changed' : 'failed';
  } catch {
    // No connection: the learner goes on, and the next step's save tries again.
    return 'failed';
  }
}
