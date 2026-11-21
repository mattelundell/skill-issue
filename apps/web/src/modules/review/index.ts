import type { WebModule } from '../../shell/contract.js';
import { catalogues } from './messages.js';
import { DueBlock, DueFigures, ReviewPage } from './Review.js';
import './review.css';

/** Questions coming back when they are about to be forgotten: what is due on the subject home and the start screen, and the session itself. */
export const reviewModule: WebModule = {
  id: 'review',
  page: { label: { sv: catalogues.sv.tab, en: catalogues.en.tab }, Page: ReviewPage },
  homeBlocks: [{ placement: 'lead', Block: DueBlock }],
  StartFigures: DueFigures,
};
