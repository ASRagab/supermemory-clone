/**
 * Unified Database Client
 * Automatically selects between SQLite and PostgreSQL based on DATABASE_URL
 */

import {
  getDatabase as getSqliteDatabase,
  runMigrations as runSqliteMigrations,
  closeDatabase as closeSqliteDatabase,
  type DatabaseInstance as SqliteDatabaseInstance,
} from './index.js';

import {
  getPostgresDatabase,
  runPostgresMigrations,
  closePostgresDatabase,
  type PostgresDatabaseInstance,
} from './postgres.js';

export type DatabaseInstance = SqliteDatabaseInstance | PostgresDatabaseInstance;

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? './data/supermemory.db';
}

export function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgresql://') || url.startsWith('postgres://');
}

function assertPostgresUrlAllowed(url: string): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  if (!isPostgresUrl(url)) {
    throw new Error(
      'DATABASE_URL must use postgres:// or postgresql:// outside tests. SQLite is only allowed when NODE_ENV=test.'
    );
  }
}

export function getDatabase(): DatabaseInstance {
  const url = getDatabaseUrl();
  const isPostgres = isPostgresUrl(url);

  assertPostgresUrlAllowed(url);

  if (isPostgres) {
    return getPostgresDatabase(url) as DatabaseInstance;
  } else {
    return getSqliteDatabase(url) as DatabaseInstance;
  }
}

export async function runMigrations(): Promise<void> {
  const url = getDatabaseUrl();
  const isPostgres = isPostgresUrl(url);

  assertPostgresUrlAllowed(url);

  if (isPostgres) {
    await runPostgresMigrations(url);
  } else {
    runSqliteMigrations(url);
  }
}

export async function closeDatabase(): Promise<void> {
  const url = getDatabaseUrl();
  const isPostgres = isPostgresUrl(url);

  assertPostgresUrlAllowed(url);

  if (isPostgres) {
    await closePostgresDatabase();
  } else {
    closeSqliteDatabase();
  }
}

export function getDatabaseInfo() {
  const url = getDatabaseUrl();
  const isPostgres = isPostgresUrl(url);

  assertPostgresUrlAllowed(url);

  return {
    type: isPostgres ? 'postgresql' : 'sqlite',
    url: isPostgres ? url.replace(/:[^:@]+@/, ':****@') : url, // Mask password
    isProduction: isPostgres,
  };
}
