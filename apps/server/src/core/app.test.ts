import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import { contentModule } from '../modules/content/manifest.js';
import { modules } from '../modules/index.js';
import { buildApp } from './app.js';
import type { Db } from './db.js';
import { createRegistry, type AnsweredRequest, type ModuleManifest, type Registry } from './registry.js';

const workingDb: Db = {
  query: async () => [],
  transaction: (work) => work(workingDb),
};

const brokenDb: Db = {
  query: async () => {
    throw new Error('connection refused at 10.0.0.5:5432');
  },
  transaction: (work) => work(brokenDb),
};

function registryOf(manifests: readonly ModuleManifest[]): Registry {
  const result = createRegistry(manifests);
  if (!result.ok) {
    throw new Error(`test registry rejected: ${result.error.kind} ${result.error.id}`);
  }
  return result.value;
}

const appWith = (manifests: readonly ModuleManifest[], db: Db = workingDb) =>
  buildApp({ db, registry: registryOf(manifests), version: '9.9.9' });

describe('GET /api/v1/health', () => {
  it('reports the version and the loaded modules when the database answers', async () => {
    const response = await appWith([{ id: 'notes', migrations: [] }, { id: 'review', migrations: [] }]).request('/api/v1/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', version: '9.9.9', database: 'up', modules: ['notes', 'review'] });
  });

  it('answers 503 without leaking the reason when the database does not answer', async () => {
    const response = await appWith([], brokenDb).request('/api/v1/health');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable', version: '9.9.9', database: 'down' });
  });
});

describe('module routes', () => {
  const greeter: ModuleManifest = {
    id: 'greeter',
    migrations: [],
    routes: () => {
      const routes = new OpenAPIHono();
      routes.get('/hello', (c) => c.json({ greeting: 'hej' }));
      return routes;
    },
  };

  it('are mounted under the module id', async () => {
    const response = await appWith([greeter]).request('/api/v1/greeter/hello');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ greeting: 'hej' });
  });

  it('are gone when the module is not registered', async () => {
    const response = await appWith([]).request('/api/v1/greeter/hello');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ type: 'about:blank', title: 'No such endpoint', status: 404 });
  });
});

describe('errors', () => {
  it('turns a thrown error into a 500 that says nothing about its cause', async () => {
    const failing: ModuleManifest = {
      id: 'failing',
      migrations: [],
      routes: () => {
        const routes = new OpenAPIHono();
        routes.get('/boom', () => {
          throw new Error('SELECT secret FROM vault');
        });
        return routes;
      },
    };

    const response = await appWith([failing]).request('/api/v1/failing/boom');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ type: 'about:blank', title: 'Internal error', status: 500 });
  });
});

describe('OpenAPI document', () => {
  it('describes the core’s own endpoints: health and backup', async () => {
    const response = await appWith([]).request('/api/v1/openapi.json');
    const document = (await response.json()) as { info: unknown; paths: Record<string, unknown> };

    expect(document.info).toEqual({ title: 'Skill Issue', version: '9.9.9' });
    expect(Object.keys(document.paths)).toEqual(['/health', '/backup']);
  });
});

describe('the content module', () => {
  it('has its routes described in the OpenAPI document', async () => {
    const response = await appWith([contentModule]).request('/api/v1/openapi.json');
    const document = (await response.json()) as { paths: Record<string, Record<string, unknown>> };

    expect(Object.fromEntries(Object.entries(document.paths).map(([path, methods]) => [path, Object.keys(methods)]))).toEqual({
      '/health': ['get'],
      '/backup': ['get', 'post'],
      '/content/packs': ['post'],
      '/content/subjects': ['get'],
      '/content/subjects/{subjectId}': ['get'],
      '/content/subjects/{subjectId}/assets/{file}': ['get'],
      '/content/subjects/{subjectId}/pack': ['get'],
      '/content/subjects/{subjectId}/{collection}/{itemId}': ['put'],
      '/content/schema/pack.json': ['get'],
    });
  });

  it('publishes the JSON Schema of a pack', async () => {
    const response = await appWith([contentModule]).request('/api/v1/content/schema/pack.json');
    const schema = (await response.json()) as { $schema: string; required: string[]; properties: Record<string, unknown> };

    expect(response.headers.get('content-type')).toBe('application/schema+json');
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.required).toEqual(['formatVersion', 'subject', 'areas', 'lessons']);
    expect(Object.keys(schema.properties)).toEqual(['formatVersion', 'subject', 'sources', 'glossary', 'areas', 'lessons', 'questions', 'assets']);
  });
});

describe('module isolation', () => {
  it.each(modules.map((module) => module.id))('the application runs without the %s module', async (removed) => {
    const remaining = modules.filter((module) => module.id !== removed);

    const response = await appWith(remaining).request('/api/v1/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      version: '9.9.9',
      database: 'up',
      modules: remaining.map((module) => module.id),
    });
  });

  it('the shipped modules register together', () => {
    expect(createRegistry(modules)).toMatchObject({ ok: true });
  });
});

/** A module that keeps every request it is told of, and has one route of its own. */
function observer(): { readonly module: ModuleManifest; readonly told: AnsweredRequest[] } {
  const told: AnsweredRequest[] = [];
  return {
    told,
    module: {
      id: 'watcher',
      migrations: [],
      routes: () => {
        const routes = new OpenAPIHono();
        routes.get('/own', (c) => c.json({ own: true }));
        return routes;
      },
      observeRequests: () => async (request) => {
        told.push(request);
      },
    },
  };
}

describe('modules observing requests', () => {
  const thrower: ModuleManifest = {
    id: 'thrower',
    migrations: [],
    routes: () => {
      const routes = new OpenAPIHono();
      routes.get('/boom', () => {
        throw new Error('disk on fire at /var/lib/x');
      });
      return routes;
    },
  };

  it('are told of an answered call: its method, its address with the query, and its status', async () => {
    const { module, told } = observer();

    await appWith([module]).request('/api/v1/health?verbose=1');

    expect(told.map(({ method, url, status }) => ({ method, url, status }))).toEqual([{ method: 'GET', url: '/api/v1/health?verbose=1', status: 200 }]);
    expect(told[0]?.problem).toBeUndefined();
    expect(told[0]?.error).toBeUndefined();
  });

  it('are told the problem a refused call was given', async () => {
    const { module, told } = observer();

    await appWith([module]).request('/api/v1/nowhere');

    expect(told).toMatchObject([{ method: 'GET', url: '/api/v1/nowhere', status: 404, problem: { title: 'No such endpoint' } }]);
  });

  it('are told what was thrown in a failed call, which the caller is not', async () => {
    const { module, told } = observer();

    const response = await appWith([module, thrower]).request('/api/v1/thrower/boom');

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('disk on fire');
    expect(told).toMatchObject([{ url: '/api/v1/thrower/boom', status: 500, problem: { title: 'Internal error' }, error: 'disk on fire at /var/lib/x' }]);
  });

  it('are not told of calls to their own routes', async () => {
    const { module, told } = observer();
    const app = appWith([module]);

    await app.request('/api/v1/watcher/own');
    await app.request('/api/v1/watcher');
    await app.request('/api/v1/watchers');

    expect(told.map(({ url }) => url)).toEqual(['/api/v1/watchers']);
  });

  it('are not told of the browser app’s own files', async () => {
    const { module, told } = observer();

    await appWith([module]).request('/subjects/energi');

    expect(told).toEqual([]);
  });

  it('cannot fail the call they observe', async () => {
    const failing: ModuleManifest = {
      id: 'failing',
      migrations: [],
      observeRequests: () => async () => {
        throw new Error('observer broke');
      },
    };
    const { module, told } = observer();

    const response = await appWith([failing, module]).request('/api/v1/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
    expect(told.map(({ url }) => url)).toEqual(['/api/v1/health']);
  });
});

/** Every route that changes something, as the application with every module mounts it, with each parameter filled. */
const writes = (): readonly { method: string; path: string }[] => {
  const seen = new Set<string>();
  return appWith(modules)
    .routes.filter(({ method, path }) => ['POST', 'PUT', 'PATCH'].includes(method) && path.startsWith('/api/v1/'))
    .map(({ method, path }) => ({ method, path: path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, '1') }))
    .filter(({ method, path }) => !seen.has(`${method} ${path}`) && Boolean(seen.add(`${method} ${path}`)));
};

describe('writes from another site', () => {
  it('are found on every module that writes', () => {
    const owners = new Set(writes().map(({ path }) => path.split('/')[3]));
    expect([...owners].toSorted((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual(['assessment', 'backup', 'content', 'diagnostics', 'lessons', 'notes']);
  });

  it.each(writes().map(({ method, path }) => [`${method} ${path}`, method, path]))('%s refuses a body sent as plain text, a form or nothing', async (_name, method, path) => {
    const app = appWith(modules);
    const sent: { label: string; init: RequestInit }[] = [
      ...['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'].map((type) => ({ label: type, init: { method, headers: { 'content-type': type }, body: '{}' } })),
      // A string body is labelled text/plain by the Request itself; bytes, or no body, carry no type at all.
      { label: 'bytes with no type', init: { method, body: new TextEncoder().encode('{}') } },
      { label: 'no body', init: { method } },
    ];
    for (const { label, init } of sent) {
      const response = await app.request(path, init);
      const body: unknown = await response.json();
      expect({ label, status: response.status, body }).toMatchObject({ label, status: 415, body: { title: 'Send the request as application/json' } });
    }
  });

  it('lets JSON and a zip archive through to the route, and a removal, which a browser never sends unasked', async () => {
    const app = appWith(modules);

    const json = await app.request('/api/v1/diagnostics/recordings', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: 'not json' });
    const zip = await app.request('/api/v1/content/packs', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: 'not a zip' });
    const removal = await app.request('/api/v1/diagnostics/recordings/1', { method: 'DELETE' });

    // Each reached its route, which judged the body itself.
    expect([json.status, zip.status, removal.status]).toEqual([400, 422, 404]);
  });
});
