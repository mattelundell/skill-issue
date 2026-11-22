import { Pool, type PoolClient } from 'pg';
import { describeThrown, log } from './log.js';

export type Row = Readonly<Record<string, unknown>>;

/**
 * The database as the rest of the application sees it. A statement and its
 * values always travel separately, so a value can never become part of the SQL.
 */
export interface Db {
  query(text: string, values?: readonly unknown[]): Promise<readonly Row[]>;
  /** Runs `work` in one transaction: committed if it returns, rolled back if it throws. */
  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T>;
}

export interface DbConnection extends Db {
  close(): Promise<void>;
}

export interface DbSettings {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

function queryOn(target: Pool | PoolClient) {
  return async (text: string, values: readonly unknown[] = []): Promise<readonly Row[]> => {
    const result = await target.query<Record<string, unknown>>(text, [...values]);
    return result.rows;
  };
}

export function connect(settings: DbSettings): DbConnection {
  const pool = new Pool({ ...settings, max: 10 });
  // An idle connection the database closes, as a restart does to all of them, has nobody waiting on its error.
  // Unheard, Node would treat it as uncaught and end the server; the pool drops the connection and opens a new one
  // for the next query, and until the database is back, the health check says it is down.
  pool.on('error', (thrown) => {
    log.error('database.connection-lost', { reason: describeThrown(thrown) });
  });

  const transaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx: Db = {
        query: queryOn(client),
        // A nested call joins the transaction already open on this connection.
        transaction: (inner) => inner(tx),
      };
      const value = await work(tx);
      await client.query('COMMIT');
      return value;
    } catch (thrown) {
      await client.query('ROLLBACK');
      throw thrown;
    } finally {
      client.release();
    }
  };

  return { query: queryOn(pool), transaction, close: () => pool.end() };
}
