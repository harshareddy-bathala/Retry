import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Db } from '@retry/db';

export function healthRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/health', async () => {
    await deps.db.execute(sql`SELECT 1`);
    return { status: 'ok' };
  });
}
