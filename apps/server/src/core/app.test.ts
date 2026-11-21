import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import { contentModule } from '../modules/content/manifest.js';
import { modules } from '../modules/index.js';
import { buildApp } from './app.js';
import type { Db } from './db.js';
import { createRegistry, type ModuleManifest, type Registry } from './registry.js';

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
  it('describes the health endpoint', async () => {
    const response = await appWith([]).request('/api/v1/openapi.json');
    const document = (await response.json()) as { info: unknown; paths: Record<string, unknown> };

    expect(document.info).toEqual({ title: 'Skill Issue', version: '9.9.9' });
    expect(Object.keys(document.paths)).toEqual(['/health']);
  });
});

describe('the content module', () => {
  it('has its routes described in the OpenAPI document', async () => {
    const response = await appWith([contentModule]).request('/api/v1/openapi.json');
    const document = (await response.json()) as { paths: Record<string, Record<string, unknown>> };

    expect(Object.fromEntries(Object.entries(document.paths).map(([path, methods]) => [path, Object.keys(methods)]))).toEqual({
      '/health': ['get'],
      '/content/packs': ['post'],
      '/content/subjects': ['get'],
      '/content/subjects/{subjectId}/pack': ['get'],
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
