import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { buildApp } from './core/app.js';
import { coreMigrations } from './core/migrations.js';
import { createCatalogue } from './core/catalogue/catalogue.js';
import { connect } from './core/db.js';
import { introduce } from './core/introduction.js';
import { parseEnv } from './core/env.js';
import { describeThrown, log } from './core/log.js';
import { migrate } from './core/migrate.js';
import { createRegistry } from './core/registry.js';
import { modules } from './modules/index.js';

const VERSION = '0.1.0';

async function start(): Promise<void> {
  const env = parseEnv(process.env);
  if (!env.ok) {
    const details = env.error.issues.map((issue) => `${issue.variable}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment — ${details}`);
  }

  const registry = createRegistry(modules);
  if (!registry.ok) {
    throw new Error(`Module "${registry.error.id}" cannot be registered: ${registry.error.kind}`);
  }

  const password = (await readFile(env.value.DB_PASSWORD_FILE, 'utf8')).trim();
  const db = connect({
    host: env.value.DB_HOST,
    port: env.value.DB_PORT,
    database: env.value.DB_NAME,
    user: env.value.DB_USER,
    password,
  });

  const migrated = await migrate(db, [...coreMigrations, ...registry.value.migrations]);
  if (!migrated.ok) {
    await db.close();
    const { owner, name, kind } = migrated.error;
    throw new Error(`Migration ${owner}/${name} could not be applied: ${kind}`);
  }
  log.info('migrations.applied', { applied: migrated.value.applied });

  if (env.value.INTRODUCTION_DIR !== undefined) {
    await introduce(db, createCatalogue(db), env.value.INTRODUCTION_DIR);
  }

  const app = buildApp({
    db,
    registry: registry.value,
    version: VERSION,
    ...(env.value.WEB_DIR === undefined ? {} : { webDir: env.value.WEB_DIR }),
  });

  const server = serve({ fetch: app.fetch, hostname: env.value.HOST, port: env.value.PORT }, (address) => {
    log.info('server.listening', { host: address.address, port: address.port });
  });

  const stop = (signal: string): void => {
    log.info('server.stopping', { signal });
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

start().catch((thrown: unknown) => {
  log.error('server.start-failed', { reason: describeThrown(thrown) });
  process.exit(1);
});
