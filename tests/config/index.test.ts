import { afterEach, describe, expect, it, vi } from 'vitest'

describe('config loading', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('treats blank LLM_PROVIDER as unset', async () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = 'postgresql://supermemory:supermemory_secret@localhost:15432/supermemory'
    process.env.LLM_PROVIDER = ''

    const { config } = await import('../../src/config/index.js')

    expect(config.llmProvider).toBeUndefined()
  })

  it('treats blank LOG_LEVEL as unset and falls back to defaults', async () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = 'postgresql://supermemory:supermemory_secret@localhost:15432/supermemory'
    process.env.LOG_LEVEL = '   '

    const { config } = await import('../../src/config/index.js')

    expect(config.logLevel).toBe('info')
  })

  it('pins embedding dimensions to 1536', async () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = 'postgresql://supermemory:supermemory_secret@localhost:15432/supermemory'

    const { config } = await import('../../src/config/index.js')

    expect(config.embeddingDimensions).toBe(1536)
    expect(config.vectorDimensions).toBe(1536)
  })

  it('rejects unsupported dimension overrides', async () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = 'postgresql://supermemory:supermemory_secret@localhost:15432/supermemory'
    process.env.EMBEDDING_DIMENSIONS = '384'

    await expect(import('../../src/config/index.js')).rejects.toThrow(
      'EMBEDDING_DIMENSIONS is pinned to 1536. Dimension overrides are not supported.'
    )
  })
})
