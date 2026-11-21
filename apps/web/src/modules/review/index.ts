import type { WebModule } from '../../shell/contract.js';
import { catalogues } from './messages.js';
import { DueBlock, DueEverywhere, DueFigures, ReviewEverythingPage, ReviewPage } from './Review.js';
import './review.css';

/**
 * Questions coming back when they are about to be forgotten: what is due on the
 * subject home and the start screen, a session in one subject, and one across
 * every subject at `/review`.
 */
export const reviewModule: WebModule = {
  id: 'review',
  page: { label: { sv: catalogues.sv.tab, en: catalogues.en.tab }, Page: ReviewPage },
  homeBlocks: [{ placement: 'lead', Block: DueBlock }],
  appPage: { Page: ReviewEverythingPage },
  StartFigures: DueFigures,
  StartLine: DueEverywhere,
};
