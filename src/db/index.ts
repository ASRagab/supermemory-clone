import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqliteInstance: Database.Database | null = null;

function createDatabase(databaseUrl: string) {
  // Ensure the directory exists
  const dir = dirname(databaseUrl);
  if (dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(databaseUrl);
  sqliteInstance = sqlite;

  // Enable WAL mode for better concurrent access
  sqlite.pragma('journal_mode = WAL');

  // Enable foreign keys
  sqlite.pragma('foreign_keys = ON');

  // Optimize for performance
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = -64000'); // 64MB cache
  sqlite.pragma('temp_store = MEMORY');

  return drizzle(sqlite, { schema });
}

export function getDatabase(databaseUrl: string) {
  if (!db) {
    db = createDatabase(databaseUrl);
  }
  return db;
}

export function runMigrations(databaseUrl: string) {
  const database = getDatabase(databaseUrl);
  migrate(database, { migrationsFolder: './drizzle' });
  console.log('Migrations completed successfully');
}

export function closeDatabase() {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    db = null;
  }
}

export function getSqliteInstance(): Database.Database | null {
  return sqliteInstance;
}

export type DatabaseInstance = ReturnType<typeof createDatabase>;

export { schema };
