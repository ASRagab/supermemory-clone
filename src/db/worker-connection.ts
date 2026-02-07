/**
 * Shared Database Connection for Workers
 *
 * Provides a singleton database connection pool and Drizzle instance
 * for use across all BullMQ workers (extraction, chunking, embedding, indexing).
 *
 * Benefits:
 * - DRY: Single source of truth for worker database configuration
 * - Consistency: All workers use the same connection settings
 * - Maintainability: Easy to update connection logic in one place
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

/**
 * Database connection URL with default fallback
 */
export const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://supermemory:supermemory_secret@localhost:5432/supermemory';

/**
 * Shared PostgreSQL connection pool
 * Reused across all workers to prevent connection exhaustion
 */
export const workerPool = new Pool({ connectionString: DATABASE_URL });

/**
 * Shared Drizzle database instance with schema
 * Provides type-safe database operations for all workers
 */
export const workerDb = drizzle(workerPool, { schema });

/**
 * Extract transaction type from database instance for type safety
 * Use this type for transaction parameters in worker methods
 */
export type WorkerTransaction = Parameters<Parameters<typeof workerDb.transaction>[0]>[0];

/**
 * Gracefully close the worker database connection pool
 * Call this during worker shutdown to prevent hanging connections
 */
export async function closeWorkerDbConnection(): Promise<void> {
  await workerPool.end();
}
