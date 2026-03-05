import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pkg from 'pg'
const { Pool } = pkg
import * as schema from './schema/index.js'

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let pool: pkg.Pool | null = null

export function createPostgresDatabase(connectionString: string) {
  // Create connection pool
  pool = new Pool({
    connectionString,
    // Production-ready pool settings
    min: 10, // Minimum connections
    max: 100, // Maximum connections
    idleTimeoutMillis: 30000, // Close idle connections after 30s
    connectionTimeoutMillis: 2000, // Timeout for acquiring connection
  })

  // Enable pgvector extension on connection
  pool.on('connect', async (client) => {
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector')
    } catch (error) {
      console.error('Error enabling pgvector extension:', error)
    }
  })

  return drizzle(pool, { schema })
}

export function getPostgresDatabase(connectionString: string) {
  if (!db) {
    db = createPostgresDatabase(connectionString)
  }
  return db
}

export async function runPostgresMigrations(connectionString: string) {
  const database = getPostgresDatabase(connectionString)
  await migrate(database, { migrationsFolder: './drizzle' })
  console.log('PostgreSQL migrations completed successfully')
}

export async function closePostgresDatabase() {
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}

export type PostgresDatabaseInstance = ReturnType<typeof createPostgresDatabase>

export { schema }
