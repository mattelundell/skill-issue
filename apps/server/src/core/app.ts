import { serveStatic } from '@hono/node-server/serve-static';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { API_PREFIX, HealthResponseSchema, type Problem } from '@skill-issue/contract';
import type { Db } from './db.js';
import { describeThrown, log } from './log.js';
import type { Registry } from './registry.js';

export interface AppDependencies {
  readonly db: Db;
  readonly registry: Registry;
  readonly version: string;
  /** Folder with the built browser app; omitted when only the API is served. */
  readonly webDir?: string;
}

const problem = (status: number, title: string): Problem => ({ type: 'about:blank', title, status });

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  summary: 'Whether the application and its database are up, and which modules are loaded.',
  responses: {
    200: { description: 'Up.', content: { 'application/json': { schema: HealthResponseSchema } } },
    503: {
      description: 'The database cannot be reached.',
      content: { 'application/json': { schema: HealthResponseSchema } },
    },
  },
});

export function buildApp({ db, registry, version, webDir }: AppDependencies): OpenAPIHono {
  const api = new OpenAPIHono();

  api.openapi(healthRoute, async (c) => {
    try {
      await db.query('SELECT 1');
    } catch (thrown) {
      // Not propagated: an unreachable database is an answer the caller asked for.
      log.error('health.database-unreachable', { reason: describeThrown(thrown) });
      return c.json({ status: 'unavailable' as const, version, database: 'down' as const }, 503);
    }
    const modules = registry.modules.map((module) => module.id);
    return c.json({ status: 'ok' as const, version, database: 'up' as const, modules }, 200);
  });

  for (const module of registry.modules) {
    if (module.routes !== undefined) {
      api.route(`/${module.id}`, module.routes({ db }));
    }
  }

  api.doc('/openapi.json', { openapi: '3.1.0', info: { title: 'Skill Issue', version } });

  const app = new OpenAPIHono();
  app.route(API_PREFIX, api);

  app.all(`${API_PREFIX}/*`, (c) => c.json(problem(404, 'No such endpoint'), 404));

  if (webDir !== undefined) {
    app.use('*', serveStatic({ root: webDir }));
    // The browser app routes on the client, so any other path gets its entry page.
    app.get('*', serveStatic({ root: webDir, path: 'index.html' }));
  }

  app.notFound((c) => c.json(problem(404, 'Not found'), 404));

  app.onError((thrown, c) => {
    // The caller learns that it failed; the reason stays in the log.
    log.error('request.failed', { method: c.req.method, path: c.req.path, reason: describeThrown(thrown) });
    return c.json(problem(500, 'Internal error'), 500);
  });

  return app;
}
