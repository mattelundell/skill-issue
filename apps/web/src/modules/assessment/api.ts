import {
  API_PREFIX,
  AskedQuestionsSchema,
  ExamResultSchema,
  GradedSchema,
  PassedSchema,
  SittingSchema,
  type AskedQuestions,
  type ExamResult,
  type ExamScope,
  type GivenAnswer,
  type Graded,
  type Passed,
  type Sitting,
} from '@skill-issue/contract';
import { getJson, type Fetched } from '../../api.js';

const base = (subjectId: string): string => `/assessment/subjects/${encodeURIComponent(subjectId)}`;

export const fetchQuestions = async (subjectId: string, ids: readonly string[], language: string, signal: AbortSignal): Promise<Fetched<AskedQuestions>> =>
  getJson(`${base(subjectId)}/questions?ids=${ids.map(encodeURIComponent).join(',')}&language=${encodeURIComponent(language)}`, AskedQuestionsSchema, signal);

export const fetchPassed = async (subjectId: string, signal: AbortSignal): Promise<Fetched<Passed>> => getJson(`${base(subjectId)}/passed`, PassedSchema, signal);

/** A write to the API: the parsed answer, or undefined when it failed for any reason. */
async function postJson<T>(path: string, body: unknown, parser: { safeParse(input: unknown): { success: true; data: T } | { success: false } }): Promise<T | undefined> {
  try {
    const response = await fetch(`${API_PREFIX}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      return undefined;
    }
    const parsed = parser.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export const postAnswer = async (subjectId: string, questionId: string, answer: GivenAnswer, language: string): Promise<Graded | undefined> =>
  postJson(`${base(subjectId)}/questions/${encodeURIComponent(questionId)}/answers?language=${encodeURIComponent(language)}`, { answer }, GradedSchema);

export const startExam = async (subjectId: string, scope: ExamScope, language: string): Promise<Sitting | undefined> =>
  postJson(`${base(subjectId)}/exams?language=${encodeURIComponent(language)}`, { scope }, SittingSchema);

export const handIn = async (subjectId: string, sittingId: string, answers: readonly { questionId: string; answer: GivenAnswer }[]): Promise<ExamResult | undefined> =>
  postJson(`${base(subjectId)}/exams/${encodeURIComponent(sittingId)}`, { answers }, ExamResultSchema);
