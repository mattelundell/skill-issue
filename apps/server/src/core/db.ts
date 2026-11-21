import { Pool, type PoolClient } from 'pg';

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
