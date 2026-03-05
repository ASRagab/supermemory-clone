import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pkg from 'pg'
const { Pool } = pkg
import * as schema from './schema/index.js'

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let pool: pkg.Pool | null = null

function parsePoolNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]
  if (!rawValue) return fallback

  const parsed = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getPostgresPoolConfig(): Pick<
  pkg.PoolConfig,
  'min' | 'max' | 'idleTimeoutMillis' | 'connectionTimeoutMillis'
> {
  return {
    min: parsePoolNumberEnv('SUPERMEMORY_PG_POOL_MIN', 10),
    max: parsePoolNumberEnv('SUPERMEMORY_PG_POOL_MAX', 100),
    idleTimeoutMillis: parsePoolNumberEnv('SUPERMEMORY_PG_POOL_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: parsePoolNumberEnv('SUPERMEMORY_PG_POOL_CONNECTION_TIMEOUT_MS', 2000),
  }
}

export function createPostgresDatabase(connectionString: string) {
  // Create connection pool
  pool = new Pool({
    connectionString,
    ...getPostgresPoolConfig(),
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
