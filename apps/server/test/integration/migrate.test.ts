import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbConnection } from '../../src/core/db.js';
import { migrate, type Migration } from '../../src/core/migrate.js';
import { createScratchDatabase } from './database.js';

let db: DbConnection;
let drop: () => Promise<void>;

beforeEach(async () => {
  ({ db, drop } = await createScratchDatabase());
});

afterEach(async () => {
  await drop();
});

const notesInit: Migration = {
  owner: 'notes',
  name: '0001_init',
  sql: 'CREATE SCHEMA notes; CREATE TABLE notes.note (id int PRIMARY KEY, body text NOT NULL)',
};
const notesTitle: Migration = {
  owner: 'notes',
  name: '0002_title',
  sql: 'ALTER TABLE notes.note ADD COLUMN title text',
};
const coreInit: Migration = { owner: 'core', name: '0001_init', sql: 'CREATE SCHEMA core' };

const recorded = async (): Promise<readonly unknown[]> =>
  db.query('SELECT owner, name FROM platform.migration ORDER BY owner, name');

const tableExists = async (qualifiedName: string): Promise<boolean> => {
  const rows = await db.query('SELECT to_regclass($1) AS found', [qualifiedName]);
  return rows[0]?.['found'] !== null;
};

describe('migrate', () => {
  it('applies migrations in owner-then-name order whatever order they are given in', async () => {
    const result = await migrate(db, [notesTitle, notesInit, coreInit]);

    expect(result).toEqual({
      ok: true,
      value: {
        applied: [
          { owner: 'core', name: '0001_init' },
          { owner: 'notes', name: '0001_init' },
          { owner: 'notes', name: '0002_title' },
        ],
      },
    });
    await db.query('INSERT INTO notes.note (id, body, title) VALUES ($1, $2, $3)', [1, 'body', 'title']);
    expect(await db.query('SELECT id, body, title FROM notes.note')).toEqual([{ id: 1, body: 'body', title: 'title' }]);
  });

  it('applies only what is new on a second run', async () => {
    await migrate(db, [notesInit]);

    const second = await migrate(db, [notesInit, notesTitle]);

    expect(second).toEqual({ ok: true, value: { applied: [{ owner: 'notes', name: '0002_title' }] } });
    expect(await recorded()).toEqual([
      { owner: 'notes', name: '0001_init' },
      { owner: 'notes', name: '0002_title' },
    ]);
  });

  it('refuses a migration that was edited after it was applied', async () => {
    await migrate(db, [notesInit]);

    const result = await migrate(db, [{ ...notesInit, sql: `${notesInit.sql}; CREATE TABLE notes.extra (id int)` }]);

    expect(result).toEqual({ ok: false, error: { kind: 'changed-after-apply', owner: 'notes', name: '0001_init' } });
    expect(await tableExists('notes.extra')).toBe(false);
  });

  it('leaves nothing behind when one migration in the run fails', async () => {
    const broken: Migration = { owner: 'notes', name: '0002_broken', sql: 'ALTER TABLE notes.missing ADD COLUMN x int' };

    const result = await migrate(db, [notesInit, broken]);

    expect(result).toMatchObject({ ok: false, error: { kind: 'failed', owner: 'notes', name: '0002_broken' } });
    expect(result.ok ? '' : 'reason' in result.error ? result.error.reason : '').toContain('notes.missing');
    expect(await tableExists('notes.note')).toBe(false);
    expect(await tableExists('platform.migration')).toBe(false);
  });
});
