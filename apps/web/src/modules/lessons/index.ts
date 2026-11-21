import type { WebModule } from '../../shell/contract.js';
import { subjectPath } from '../../shell/router.js';
import { fetchPositions, fetchResume } from './api.js';
import { LessonPage } from './LessonPage.js';
import { marksFrom } from './progress.js';
import { ContinueBlock, ResumePanel } from './Resume.js';
import './lessons.css';

/**
 * Takes a lesson step by step and keeps where the learner is. Its page has no
 * tab: a lesson is reached from the path, the start screen and the material.
 */
export const lessonsModule: WebModule = {
  id: 'lessons',
  page: { Page: LessonPage },
  lessonLink: (subjectId, lessonId) => subjectPath(subjectId, 'lessons', [lessonId]),
  homeBlocks: [{ placement: 'lead', Block: ContinueBlock }],
  ResumePanel,
  startedSubjects: async (signal) => {
    const resume = await fetchResume(signal);
    if (resume.kind !== 'ok') {
      throw new Error('where the learner has begun could not be read');
    }
    return new Set(resume.value.started);
  },
  lessonMarks: async (subjectId, signal, language) => {
    const positions = await fetchPositions(subjectId, signal);
    if (positions.kind !== 'ok') {
      throw new Error('lesson positions could not be read');
    }
    return marksFrom(positions.value.lessons, language);
  },
};
