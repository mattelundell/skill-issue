/**
 * Starts the application as it ships — the built server serving the built
 * browser app — on a fresh database in the throwaway PostgreSQL from
 * `docker-compose.test.yml`, and drops that database when it stops.
 * Playwright runs this before the tests and stops it with SIGTERM after them.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';

const ROOT = join(import.meta.dirname, '..', '..');
const PORT = process.env['E2E_PORT'] ?? '4757';
// The test database's credentials protect nothing: it is loopback-only and kept in memory.
const DATABASE = { host: '127.0.0.1', port: 54747, user: 'test', password: 'test' };

// CREATE DATABASE takes no bound parameter; the name is hex generated here, never input.
const name = `e2e_${randomBytes(8).toString('hex')}`;
const admin = async (sql: string): Promise<void> => {
  const client = new Client({ ...DATABASE, database: 'postgres' });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
};

await admin(`CREATE DATABASE ${name}`);
const secrets = await mkdtemp(join(tmpdir(), 'skill-issue-e2e-'));
const passwordFile = join(secrets, 'db_password');
await writeFile(passwordFile, DATABASE.password, { mode: 0o600 });

const server = spawn(process.execPath, [join(ROOT, 'apps', 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT,
    DB_HOST: DATABASE.host,
    DB_PORT: String(DATABASE.port),
    DB_NAME: name,
    DB_USER: DATABASE.user,
    DB_PASSWORD_FILE: passwordFile,
    WEB_DIR: join(ROOT, 'apps', 'web', 'dist'),
  },
  stdio: 'inherit',
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => server.kill('SIGTERM'));
}

const cleanUp = async (): Promise<void> => {
  await rm(secrets, { recursive: true, force: true });
  await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
};

server.once('exit', (code) => {
  void cleanUp().finally(() => process.exit(code ?? 0));
});
