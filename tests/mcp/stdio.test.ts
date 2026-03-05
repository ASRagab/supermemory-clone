import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import pg from 'pg'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const execFileAsync = promisify(execFile)
const { Client: PgClient } = pg

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })

const repoRoot = resolve(import.meta.dirname, '../..')
const tsxBin = resolve(repoRoot, 'node_modules/.bin/tsx')

interface ToolEnvelope<T> {
  ok: boolean
  data: T
  warnings?: Array<{ message: string }>
  errors?: Array<{ code: string; message: string }>
  meta?: Record<string, unknown>
}

interface AddToolData {
  success: boolean
  documentId: string
  memoriesExtracted: number
}

interface SearchToolData {
  totalCount: number
  results: Array<{ id: string; content: string }>
}

interface DeleteToolData {
  success: boolean
  documentsDeleted: number
  memoriesDeleted: number
  vectorsDeleted: number
  profileFactsDeleted: number
}

interface RecallToolData {
  facts: Array<{ id: string; content: string }>
  totalFound: number
}

interface FactsResourceData {
  totalCount: number
}

interface StatsResourceData {
  totalDocuments: number
}

let databaseName: string
let databaseUrl: string
let client: Client
let transport: StdioClientTransport
let stderrOutput = ''

function getBaseDatabaseUrl(): string {
  if (process.env.SUPERMEMORY_TEST_DATABASE_URL) {
    return process.env.SUPERMEMORY_TEST_DATABASE_URL
  }

  const envPath = resolve(repoRoot, '.env')
  if (existsSync(envPath)) {
    const envFile = readFileSync(envPath, 'utf8')
    const databaseUrlLine = envFile
      .split('\n')
      .find((line) => line.startsWith('DATABASE_URL=') && !line.startsWith('DATABASE_URL=postgresql://localhost:5432'))

    if (databaseUrlLine) {
      const value = databaseUrlLine.slice('DATABASE_URL='.length).trim()
      if (value) {
        return value
      }
    }
  }

  return (
    process.env.TEST_POSTGRES_URL ||
    process.env.DATABASE_URL ||
    'postgresql://supermemory:supermemory_secret@localhost:15432/supermemory'
  )
}

function getAdminDatabaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = '/postgres'
  return url.toString()
}

async function createTempDatabase(baseUrl: string): Promise<{ databaseName: string; databaseUrl: string }> {
  const admin = new PgClient({ connectionString: getAdminDatabaseUrl(baseUrl) })
  await admin.connect()

  const nextDatabaseName = `supermemory_mcp_${randomUUID().replace(/-/g, '')}`
  await admin.query(`CREATE DATABASE "${nextDatabaseName}"`)
  await admin.end()

  const nextDatabaseUrl = new URL(baseUrl)
  nextDatabaseUrl.pathname = `/${nextDatabaseName}`

  const setupClient = new PgClient({ connectionString: nextDatabaseUrl.toString() })
  await setupClient.connect()
  await setupClient.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  await setupClient.query('CREATE EXTENSION IF NOT EXISTS vector')
  await setupClient.end()

  await execFileAsync('npm', ['run', 'db:migrate'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: nextDatabaseUrl.toString(),
    },
  })

  return {
    databaseName: nextDatabaseName,
    databaseUrl: nextDatabaseUrl.toString(),
  }
}

async function dropTempDatabase(baseUrl: string, dbName: string): Promise<void> {
  const admin = new PgClient({ connectionString: getAdminDatabaseUrl(baseUrl) })
  await admin.connect()
  await admin.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName]
  )
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`)
  await admin.end()
}

function getEnvelopeData<T>(result: { structuredContent?: unknown }): ToolEnvelope<T> {
  const structuredContent = result.structuredContent as ToolEnvelope<T> | undefined
  if (!structuredContent) {
    throw new Error('Expected structuredContent in MCP tool result')
  }
  return structuredContent
}

async function readJsonResource<T>(uri: string): Promise<T> {
  const resource = await client.readResource({ uri })
  const text = resource.contents[0] && 'text' in resource.contents[0] ? resource.contents[0].text : undefined
  if (!text) {
    throw new Error(`Expected JSON text for resource ${uri}`)
  }
  return JSON.parse(text) as T
}

describe('Real MCP stdio integration', () => {
  beforeAll(async () => {
    const created = await createTempDatabase(getBaseDatabaseUrl())
    databaseName = created.databaseName
    databaseUrl = created.databaseUrl

    stderrOutput = ''
    transport = new StdioClientTransport({
      command: tsxBin,
      args: ['src/mcp/index.ts'],
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'development',
        AUTH_ENABLED: 'false',
        CSRF_ALLOW_MISSING_ORIGIN: 'true',
        SUPERMEMORY_PG_POOL_MIN: '0',
        SUPERMEMORY_PG_POOL_MAX: '2',
        SUPERMEMORY_PG_POOL_IDLE_TIMEOUT_MS: '5000',
        OPENAI_API_KEY: '',
      },
      stderr: 'pipe',
    })

    transport.stderr?.on('data', (chunk) => {
      stderrOutput += chunk.toString()
    })

    client = new Client({
      name: 'supermemory-mcp-stdio-test',
      version: '1.0.0',
    })

    await client.connect(transport)
  })

  afterAll(async () => {
    if (transport) {
      await transport.close()
    }
    if (databaseName) {
      await dropTempDatabase(getBaseDatabaseUrl(), databaseName)
    }
  })

  it('lists the real tool surface over stdio', async () => {
    const result = await client.listTools()
    const toolNames = result.tools.map((tool) => tool.name)

    expect(toolNames).toContain('supermemory_add')
    expect(toolNames).toContain('supermemory_delete')
    expect(toolNames).toContain('supermemory_recall')
  })

  it('returns InvalidParams for bad tool input', async () => {
    await expect(
      client.callTool({
        name: 'supermemory_add',
        arguments: {
          content: 'bad url',
          sourceUrl: 'ftp://invalid.example.com/bad',
        },
      })
    ).rejects.toMatchObject({
      code: -32602,
    })
  })

  it('adds, searches, deletes, and removes sourced profile facts through the real server', async () => {
    const suffix = randomUUID()
    const containerTag = `delete-${suffix.replace(/-/g, '').slice(0, 12)}`
    const customId = `delete-demo-${suffix}`
    const content = 'I am a Rust developer. I prefer Rust for CLI tools.'

    const addResult = getEnvelopeData<AddToolData>(
      await client.callTool({
        name: 'supermemory_add',
        arguments: {
          customId,
          content,
          containerTag,
        },
      })
    )

    expect(addResult.ok).toBe(true)
    expect(addResult.data.documentId).toBeDefined()
    expect(addResult.data.memoriesExtracted).toBeGreaterThan(0)

    const searchBeforeDelete = getEnvelopeData<SearchToolData>(
      await client.callTool({
        name: 'supermemory_search',
        arguments: {
          query: 'Rust CLI tools',
          containerTag,
        },
      })
    )

    expect(searchBeforeDelete.data.totalCount).toBeGreaterThan(0)

    const factsBeforeDelete = await readJsonResource<FactsResourceData>(`memory://facts/${containerTag}`)
    expect(factsBeforeDelete.totalCount).toBeGreaterThan(0)

    const deleteResult = getEnvelopeData<DeleteToolData>(
      await client.callTool({
        name: 'supermemory_delete',
        arguments: {
          id: addResult.data.documentId,
          confirm: true,
        },
      })
    )

    expect(deleteResult.data.documentsDeleted).toBe(1)
    expect(deleteResult.data.memoriesDeleted).toBeGreaterThan(0)
    expect(deleteResult.data.vectorsDeleted).toBeGreaterThan(0)
    expect(deleteResult.data.profileFactsDeleted).toBeGreaterThan(0)

    const searchAfterDelete = getEnvelopeData<SearchToolData>(
      await client.callTool({
        name: 'supermemory_search',
        arguments: {
          query: 'Rust CLI tools',
          containerTag,
        },
      })
    )

    expect(searchAfterDelete.data.totalCount).toBe(0)

    const factsAfterDelete = await readJsonResource<FactsResourceData>(`memory://facts/${containerTag}`)
    expect(factsAfterDelete.totalCount).toBe(0)
  })

  it('recalls remembered facts without provider keys', async () => {
    const containerTag = `recall-${randomUUID().replace(/-/g, '').slice(0, 12)}`

    const rememberResult = getEnvelopeData<{ success: boolean }>(
      await client.callTool({
        name: 'supermemory_remember',
        arguments: {
          fact: 'I enjoy hiking on weekends.',
          containerTag,
        },
      })
    )

    expect(rememberResult.ok).toBe(true)

    const recallResult = getEnvelopeData<RecallToolData>(
      await client.callTool({
        name: 'supermemory_recall',
        arguments: {
          query: 'hiking',
          containerTag,
        },
      })
    )

    expect(recallResult.data.totalFound).toBeGreaterThan(0)
    expect(recallResult.data.facts.some((fact) => fact.content.includes('hiking'))).toBe(true)
  })

  it('keeps resources/list bounded and resources/read useful on populated data', async () => {
    for (let index = 0; index < 8; index++) {
      await client.callTool({
        name: 'supermemory_add',
        arguments: {
          content: `Document ${index} about MCP integration`,
          customId: `resource-demo-${index}`,
          containerTag: `resource-${index}`,
        },
      })
    }

    const resources = await client.listResources()
    const resourceUris = resources.resources.map((resource) => resource.uri)
    const documentResources = resourceUris.filter((uri) => uri.startsWith('memory://documents/'))

    expect(resources.resources.length).toBeLessThanOrEqual(17)
    expect(resourceUris).toContain('memory://stats')
    expect(resourceUris).toContain('memory://search')
    expect(documentResources.length).toBeLessThanOrEqual(5)

    const stats = await readJsonResource<StatsResourceData>('memory://stats')
    expect(stats.totalDocuments).toBeGreaterThan(0)
  })

  it('does not emit fatal stderr during normal protocol use', () => {
    expect(stderrOutput).not.toContain('Fatal error')
  })
})
