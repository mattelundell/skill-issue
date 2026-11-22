import type { WebModule } from '../../shell/contract.js';
import { catalogues } from './messages.js';
import { masteredMarks, ProgressPage, RecallFigure } from './Progress.js';
import './progress.css';

/** What the learner remembers: the Progress tab, the share remembered on each start-screen row, and which lessons on the path are mastered. */
export const progressModule: WebModule = {
  id: 'progress',
  page: { label: { sv: catalogues.sv.tab, en: catalogues.en.tab }, Page: ProgressPage },
  StartFigures: RecallFigure,
  lessonMarks: masteredMarks,
};
