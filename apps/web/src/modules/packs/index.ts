import type { WebModule } from '../../shell/contract.js';
import { PacksFooter, PacksPage } from './Packs.js';
import './packs.css';

/**
 * Loading a subject pack from the browser: a zip dropped or chosen on the page
 * at `/packs`, checked first, and loaded on the learner's word. The same
 * request the command-line tool makes; a way to it in the footer.
 */
export const packsModule: WebModule = {
  id: 'packs',
  appPage: { Page: PacksPage },
  Footer: PacksFooter,
};
