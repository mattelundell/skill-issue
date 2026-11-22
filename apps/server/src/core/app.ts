import { DEFAULT_LIMITS } from '@skill-issue/pack';
import { serveStatic } from '@hono/node-server/serve-static';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { API_PREFIX, HealthResponseSchema, ProblemSchema } from '@skill-issue/contract';
import { backupRoutes } from './backup/routes.js';
import { createCatalogue } from './catalogue/catalogue.js';
import type { Db } from './db.js';
import { createLearningRecord } from './record/record.js';
import { describeThrown, log } from './log.js';
import { problem } from './problem.js';
import type { AnsweredRequest, Registry } from './registry.js';

export interface AppDependencies {
  readonly db: Db;
  readonly registry: Registry;
  readonly version: string;
  /** Folder with the built browser app; omitted when only the API is served. */
  readonly webDir?: string;
  /** The largest request body taken, in bytes: by default what a pack may hold. */
  readonly maxBodyBytes?: number;
}


/** Methods that change something. A removal is not among them: no browser sends one to another site without asking first, which this server never answers. */
const WRITES: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

/**
 * The only bodies a write is taken in. A page on any site open in the learner's
 * browser may send a POST unasked if its body is plain text, a form or nothing,
 * and a server that read such a body as JSON would act on it. Every other type
 * makes the browser ask first, and this server never answers that question, so
 * only the application, the command-line tool or a script on this machine can
 * send JSON or a zip archive. A route that takes no zip refuses one itself.
 */
const WRITABLE: ReadonlySet<string> = new Set(['application/json', 'application/zip']);

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

export function buildApp({ db, registry, version, webDir, maxBodyBytes = DEFAULT_LIMITS.maxTotalBytes }: AppDependencies): OpenAPIHono {
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

  api.route('/', backupRoutes(db, registry, version));

  const context = { db, catalogue: createCatalogue(db), record: createLearningRecord(db), maxBodyBytes, version };
  for (const module of registry.modules) {
    if (module.routes !== undefined) {
      api.route(`/${module.id}`, module.routes(context));
    }
  }

  api.doc('/openapi.json', { openapi: '3.1.0', info: { title: 'Skill Issue', version } });

  const app = new OpenAPIHono();

  const observers = registry.modules.flatMap(({ id, observeRequests }) => (observeRequests === undefined ? [] : [{ id, observe: observeRequests(context) }]));
  if (observers.length > 0) {
    app.use(`${API_PREFIX}/*`, async (c, next) => {
      const at = new Date();
      const started = performance.now();
      await next();
      const answered = await describeAnswer({ method: c.req.method, url: c.req.url, response: c.res, thrown: c.error }, at, Math.round(performance.now() - started));
      for (const { id, observe } of observers) {
        if (c.req.path === `${API_PREFIX}/${id}` || c.req.path.startsWith(`${API_PREFIX}/${id}/`)) {
          continue;
        }
        try {
          await observe(answered);
        } catch (thrown) {
          // Observing is never the caller's problem: the answer stands.
          log.error('request.observer-failed', { module: id, reason: describeThrown(thrown) });
        }
      }
    });
  }

  app.use(`${API_PREFIX}/*`, async (c, next) => {
    if (!WRITES.has(c.req.method)) {
      return next();
    }
    const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!WRITABLE.has(type)) {
      // Not read, let alone acted on: see WRITABLE.
      return c.json(problem(415, 'Send the request as application/json', `Content-Type was ${JSON.stringify(c.req.header('content-type') ?? '')}. A write is taken as application/json; a pack may also be sent as application/zip.`), 415);
    }
    return next();
  });

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

/** What an observer is told of an answered request: the problem of a refused one, and what was thrown in a failed one. */
async function describeAnswer(
  { method, url, response, thrown }: { readonly method: string; readonly url: string; readonly response: Response; readonly thrown: unknown },
  at: Date,
  durationMs: number,
): Promise<AnsweredRequest> {
  const { status } = response;
  const address = new URL(url);
  const answered = { at, method, url: `${address.pathname}${address.search}`, status, durationMs };
  const error = thrown === undefined ? {} : { error: describeThrown(thrown) };
  if (status < 400 || !(response.headers.get('content-type') ?? '').includes('json')) {
    return { ...answered, ...error };
  }
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    // An answer that says JSON and is not: the status alone is what can be told.
    return { ...answered, ...error };
  }
  const parsed = ProblemSchema.safeParse(body);
  const given = parsed.success ? { problem: { title: parsed.data.title, ...(parsed.data.detail === undefined ? {} : { detail: parsed.data.detail }) } } : {};
  return { ...answered, ...given, ...error };
}
