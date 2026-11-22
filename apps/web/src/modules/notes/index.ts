import type { WebModule } from '../../shell/contract.js';
import { catalogues } from './messages.js';
import { NotebookPage } from './NotebookPage.js';
import { NotebooksLine, NotebooksPage } from './NotebooksPage.js';
import { NotebookSpread } from './NotebookSpread.js';
import { NotesBlock } from './NotesBlock.js';
import { NOTE_KEY } from './place.js';
import './notes.css';

/**
 * A notebook per subject: the spread in a lesson, the Notes tab that reads it
 * as one document, a block on the subject home, and every notebook from the
 * start screen.
 */
export const notesModule: WebModule = {
  id: 'notes',
  page: { label: { sv: catalogues.sv.tab, en: catalogues.en.tab }, Page: NotebookPage },
  appPage: { Page: NotebooksPage },
  StartLine: NotebooksLine,
  homeBlocks: [{ placement: 'side', Block: NotesBlock }],
  lessonSide: {
    label: {
      sv: { open: catalogues.sv['toggle.open'], close: catalogues.sv['toggle.close'], hint: catalogues.sv['toggle.hint'] },
      en: { open: catalogues.en['toggle.open'], close: catalogues.en['toggle.close'], hint: catalogues.en['toggle.hint'] },
    },
    key: NOTE_KEY,
    Side: NotebookSpread,
    presentation: 'spread',
  },
};
