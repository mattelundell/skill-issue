import { randomBytes } from 'node:crypto';
import { connect, type DbConnection, type DbSettings } from '../../src/core/db.js';

/**
 * The throwaway PostgreSQL started by `docker-compose.test.yml`: bound to
 * loopback, kept in memory, and holding nothing but what these tests create.
 */
const server: Omit<DbSettings, 'database'> = {
  host: '127.0.0.1',
  port: 54747,
  user: 'test',
  password: 'test',
};

/** A fresh, empty database, so tests cannot see each other's tables. */
export async function createScratchDatabase(): Promise<{ db: DbConnection; drop: () => Promise<void> }> {
  // CREATE DATABASE takes no bound parameter; the name is hex generated here, never input.
  const name = `scratch_${randomBytes(8).toString('hex')}`;
  const admin = connect({ ...server, database: 'postgres' });
  await admin.query(`CREATE DATABASE ${name}`);
  const db = connect({ ...server, database: name });
  return {
    db,
    drop: async () => {
      await db.close();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.close();
    },
  };
}
