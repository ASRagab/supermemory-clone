import { defineConfig } from 'drizzle-kit';

// Determine database type from DATABASE_URL
const databaseUrl = process.env.DATABASE_URL ?? './data/supermemory.db';
const isPostgres = databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://');

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: isPostgres ? 'postgresql' : 'sqlite',
  dbCredentials: isPostgres
    ? {
        url: databaseUrl,
      }
    : {
        url: databaseUrl,
      },
  verbose: true,
  strict: true,
});
