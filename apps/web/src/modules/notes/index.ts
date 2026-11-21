import type { WebModule } from '../../shell/contract.js';
import { catalogues } from './messages.js';
import { NotePane } from './NotePane.js';
import { NotesBlock } from './NotesBlock.js';
import { NotesPage } from './NotesPage.js';
import { NOTE_KEY } from './place.js';
import './notes.css';

/** Notes written beside a lesson: the note pane, the Notes tab with browsing and search, and a block on the subject home. */
export const notesModule: WebModule = {
  id: 'notes',
  page: { label: { sv: catalogues.sv.tab, en: catalogues.en.tab }, Page: NotesPage },
  homeBlocks: [{ placement: 'side', Block: NotesBlock }],
  lessonSide: {
    label: {
      sv: { open: catalogues.sv['toggle.open'], close: catalogues.sv['toggle.close'], hint: catalogues.sv['toggle.hint'] },
      en: { open: catalogues.en['toggle.open'], close: catalogues.en['toggle.close'], hint: catalogues.en['toggle.hint'] },
    },
    key: NOTE_KEY,
    Side: NotePane,
  },
};
