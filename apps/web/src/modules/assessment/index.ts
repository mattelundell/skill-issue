import type { WebModule } from '../../shell/contract.js';
import { fetchPassed } from './api.js';
import { CheckStep } from './CheckStep.js';
import { AreaExamOffer, ExamPage, LessonExamOffer } from './ExamPage.js';
import './assessment.css';

/** Checks inside lessons, and lesson and area exams. Its page has no tab: an exam is reached from a lesson's end and the path. */
export const assessmentModule: WebModule = {
  id: 'assessment',
  page: { Page: ExamPage },
  steps: { check: CheckStep },
  LessonEnd: LessonExamOffer,
  AreaFooter: AreaExamOffer,
  // A lesson whose exam has been passed is "passed"; mastery is for the module that knows what is remembered.
  lessonMarks: async (subjectId, signal) => {
    const passed = await fetchPassed(subjectId, signal);
    if (passed.kind !== 'ok') {
      throw new Error('passed exams could not be read');
    }
    return new Map(passed.value.lessons.map((lessonId) => [lessonId, { state: 'passed' as const }]));
  },
};
