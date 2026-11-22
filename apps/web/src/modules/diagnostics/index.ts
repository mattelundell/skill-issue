import type { WebModule } from '../../shell/contract.js';
import { DiagnosticsPage, RecordingFooter } from './Diagnostics.js';
import './diagnostics.css';

/**
 * Recording a study session for finding faults: a way to it in the footer,
 * which says plainly while a session is recorded and follows it, and a page at
 * `/diagnostics` to start, stop, export and remove recordings.
 */
export const diagnosticsModule: WebModule = {
  id: 'diagnostics',
  appPage: { Page: DiagnosticsPage },
  Footer: RecordingFooter,
};
