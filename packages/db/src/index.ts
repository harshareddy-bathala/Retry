import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>['db'];

export function createDb(options: { connectionString: string; poolMax?: number }) {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.poolMax ?? 10,
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}

export * as schema from './schema.js';
export * from './schema.js';
