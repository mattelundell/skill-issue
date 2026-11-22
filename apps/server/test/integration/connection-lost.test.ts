import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, type DbConnection } from '../../src/core/db.js';
import { createScratchDatabase, testServer } from './database.js';

/**
 * A database that restarts closes every connection the server holds, idle ones
 * included. An idle connection's error has nobody waiting on it, so unless the
 * pool listens, Node treats it as uncaught and the whole server exits.
 */

let scratch: Awaited<ReturnType<typeof createScratchDatabase>>;
let admin: DbConnection;
let logged: string[];

beforeEach(async () => {
  scratch = await createScratchDatabase();
  admin = connect({ ...testServer, database: 'postgres' });
  logged = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    logged.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await admin.close();
  await scratch.drop();
});

/** Waits, at most two seconds, for a line in the error log naming `event`. */
async function loggedEvent(event: string): Promise<Record<string, unknown> | undefined> {
  for (let tries = 0; tries < 40; tries += 1) {
    const line = logged.find((text) => text.includes(`"event":"${event}"`));
    if (line !== undefined) {
      return JSON.parse(line) as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

describe('the database closing the server’s idle connections', () => {
  it('is logged, not thrown, and the next query opens a new connection', async () => {
    const [own] = await scratch.db.query('SELECT pg_backend_pid() AS pid');

    // What a restart does to every connection: the server process ends it.
    await admin.query('SELECT pg_terminate_backend($1)', [own?.['pid']]);

    const event = await loggedEvent('database.connection-lost');
    expect(event).toMatchObject({ level: 'error', event: 'database.connection-lost' });
    expect(String(event?.['reason'])).toMatch(/terminat/i);
    expect(await scratch.db.query('SELECT 41 + 1 AS answer')).toEqual([{ answer: 42 }]);
  });
});
