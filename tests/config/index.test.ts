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
})
