/**
 * Tests for LLM feature flag defaults
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

describe('LLM feature flags', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
  })

  it('should disable LLM availability when flag is off', async () => {
    process.env.MEMORY_ENABLE_LLM = 'false'
    process.env.OPENAI_API_KEY = 'test-key'

    const { isLLMAvailable } = await import('../../../src/services/llm/index.js')

    expect(isLLMAvailable()).toBe(false)
  })

  it('should allow LLM availability when flag is on', async () => {
    process.env.MEMORY_ENABLE_LLM = 'true'
    process.env.OPENAI_API_KEY = 'test-key'

    const { isLLMAvailable } = await import('../../../src/services/llm/index.js')

    expect(isLLMAvailable()).toBe(true)
  })

  it('should limit available providers to mock when flag is off', async () => {
    process.env.MEMORY_ENABLE_LLM = 'false'
    process.env.OPENAI_API_KEY = 'test-key'

    const { getAvailableProviders } = await import('../../../src/services/llm/index.js')

    expect(getAvailableProviders()).toEqual(['mock'])
  })
})
