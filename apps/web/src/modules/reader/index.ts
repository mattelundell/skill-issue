import type { WebModule } from '../../shell/contract.js';
import { MaterialBlock } from './MaterialBlock.js';
import { catalogues } from './messages.js';
import { ReaderPage } from './ReaderPage.js';
import './reader.css';

/** Shows a subject's source material: the Material tab, one source with its origin, and a block on the subject home. */
export const readerModule: WebModule = {
  id: 'reader',
  page: { label: { sv: catalogues.sv.tab, en: catalogues.en.tab }, Page: ReaderPage },
  homeBlocks: [{ placement: 'side', Block: MaterialBlock }],
};
