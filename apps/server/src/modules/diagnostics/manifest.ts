import { withoutQueryValues, type ApiCall } from '@skill-issue/contract';
import type { ModuleManifest } from '../../core/registry.js';
import { diagnosticsRoutes } from './routes.js';
import { appendEvents, diagnosticsMigrations } from './store.js';

/**
 * Opt-in local recording of a study session, for finding faults: the browser's
 * interface events, every API call the server answers, and every error. A
 * recording is not study data, so it is not in a backup.
 */
export const diagnosticsModule: ModuleManifest = {
  id: 'diagnostics',
  migrations: diagnosticsMigrations,
  routes: diagnosticsRoutes,
  observeRequests:
    ({ db }) =>
    async ({ at, url, ...answered }) => {
      const event: ApiCall = { kind: 'call', at: at.toISOString(), url: withoutQueryValues(url), ...answered };
      await appendEvents(db, undefined, [{ source: 'api', event }]);
    },
};
