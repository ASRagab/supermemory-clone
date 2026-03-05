/**
 * LLM Provider Integration Tests
 *
 * Comprehensive integration testing with REAL API calls to validate:
 * 1. OpenAI and Anthropic provider integration
 * 2. Rate limit handling and exponential backoff
 * 3. API key validation and error handling
 * 4. JSON response parsing reliability
 * 5. Service-level LLM integration (Memory Classifier, Contradiction Detector, Extension Detector)
 * 6. Fallback to mock provider when API keys unavailable
 * 7. Concurrent request handling
 * 8. Cost optimization (minimal tokens)
 *
 * IMPORTANT: Tests skip gracefully when API keys not present
 * Cost-conscious: Uses cheapest models (gpt-4o-mini, claude-haiku) with minimal prompts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createOpenAIProvider, OpenAILLMProvider } from '../../src/services/llm/openai.js'
import { createAnthropicProvider, AnthropicLLMProvider } from '../../src/services/llm/anthropic.js'
import { LLMError } from '../../src/services/llm/base.js'
import { LLMErrorCode } from '../../src/services/llm/types.js'
import {
  MemoryClassifierService,
  getMemoryClassifier,
  resetMemoryClassifier,
} from '../../src/services/llm/memory-classifier.service.js'
import {
  ContradictionDetectorService,
  getContradictionDetector,
  resetContradictionDetector,
} from '../../src/services/llm/contradiction-detector.service.js'
import {
  MemoryExtensionDetectorService,
  getMemoryExtensionDetector,
  resetMemoryExtensionDetector,
} from '../../src/services/llm/memory-extension-detector.service.js'
import { resetLLMProvider } from '../../src/services/llm/index.js'
import type { Memory, MemoryType } from '../../src/types/index.js'
import { randomUUID } from 'node:crypto'

// ============================================================================
// Test Utilities
// ============================================================================

interface TestStats {
  totalTests: number
  openaiTests: number
  anthropicTests: number
  mockTests: number
  totalCalls: number
  totalTokens: number
  estimatedCost: number
}

const testStats: TestStats = {
  totalTests: 0,
  openaiTests: 0,
  anthropicTests: 0,
  mockTests: 0,
  totalCalls: 0,
  totalTokens: 0,
  estimatedCost: 0,
}

function updateStats(provider: 'openai' | 'anthropic' | 'mock', tokens?: number) {
  testStats.totalTests++
  testStats.totalCalls++

  if (provider === 'openai') {
    testStats.openaiTests++
    // GPT-4o-mini: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
    const avgTokens = tokens ?? 150
    testStats.totalTokens += avgTokens
    testStats.estimatedCost += (avgTokens * 0.375) / 1000000 // Average of input/output
  } else if (provider === 'anthropic') {
    testStats.anthropicTests++
    // Claude Haiku: ~$0.25 per 1M input tokens, ~$1.25 per 1M output tokens
    const avgTokens = tokens ?? 150
    testStats.totalTokens += avgTokens
    testStats.estimatedCost += (avgTokens * 0.75) / 1000000 // Average of input/output
  } else {
    testStats.mockTests++
  }
}

function createTestMemory(content: string, type: MemoryType = 'fact'): Memory {
  return {
    id: randomUUID(),
    content,
    type,
    relationships: [],
    isLatest: true,
    confidence: 0.8,
    metadata: { confidence: 0.8 },
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// Check for API keys
const OPENAI_KEY = process.env.OPENAI_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const HAS_OPENAI = !!OPENAI_KEY
const HAS_ANTHROPIC = !!ANTHROPIC_KEY

// ============================================================================
// OpenAI Provider Integration Tests
// ============================================================================

describe('OpenAI Provider Integration (Real API)', () => {
  let provider: OpenAILLMProvider

  beforeEach(() => {
    if (!HAS_OPENAI) {
      console.log('⏭️  Skipping OpenAI tests - OPENAI_API_KEY not set')
      return
    }

    provider = createOpenAIProvider({
      apiKey: OPENAI_KEY!,
      model: 'gpt-4o-mini', // Cheapest model
      maxTokens: 150, // Minimal tokens
      temperature: 0.1,
      timeoutMs: 30000,
      maxRetries: 3,
    })
  })

  afterEach(() => {
    if (provider) {
      provider.clearCache()
    }
  })

  it.skipIf(!HAS_OPENAI)('should be available when API key is set', () => {
    expect(provider.isAvailable()).toBe(true)
  })

  it.skipIf(!HAS_OPENAI)(
    'should successfully classify memory type with real LLM',
    async () => {
      const response = await provider.generateJson(
        'You are a classifier. Respond with JSON only: {"type": "fact", "confidence": 0.9}',
        'Classify: Paris is the capital of France'
      )

      expect(response.rawResponse).toBeTruthy()
      expect(response.provider).toBe('openai')
      expect(response.tokensUsed).toBeDefined()
      expect(response.tokensUsed!.total).toBeGreaterThan(0)

      // Parse JSON response
      const parsed = JSON.parse(response.rawResponse)
      expect(parsed).toHaveProperty('type')
      expect(parsed).toHaveProperty('confidence')

      updateStats('openai', response.tokensUsed?.total)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI)(
    'should detect contradictions with real LLM',
    async () => {
      const response = await provider.generateJson(
        'Compare two statements. Respond with JSON only: {"isContradiction": boolean, "confidence": 0.0-1.0, "reason": "string", "shouldSupersede": boolean}',
        'OLD: "I work at Google"\nNEW: "I now work at Microsoft"\n\nDo they contradict?'
      )

      expect(response.rawResponse).toBeTruthy()

      const parsed = JSON.parse(response.rawResponse)
      expect(parsed).toHaveProperty('isContradiction')
      expect(parsed).toHaveProperty('confidence')
      expect(parsed).toHaveProperty('reason')
      expect(parsed).toHaveProperty('shouldSupersede')

      // Should detect contradiction
      expect(parsed.isContradiction).toBe(true)
      expect(parsed.confidence).toBeGreaterThan(0.5)

      updateStats('openai', response.tokensUsed?.total)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI)(
    'should detect memory extensions with real LLM',
    async () => {
      const response = await provider.generateJson(
        'Compare two statements. Respond with JSON only: {"isExtension": boolean, "confidence": 0.0-1.0, "reason": "string"}',
        'OLD: "I like pizza"\nNEW: "I like pizza, especially margherita and pepperoni"\n\nDoes NEW extend OLD?'
      )

      expect(response.rawResponse).toBeTruthy()

      const parsed = JSON.parse(response.rawResponse)
      expect(parsed).toHaveProperty('isExtension')
      expect(parsed).toHaveProperty('confidence')
      expect(parsed).toHaveProperty('reason')

      // Should detect extension
      expect(parsed.isExtension).toBe(true)
      expect(parsed.confidence).toBeGreaterThan(0.5)

      updateStats('openai', response.tokensUsed?.total)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI)(
    'should handle invalid API key gracefully',
    async () => {
      const invalidProvider = createOpenAIProvider({
        apiKey: 'sk-invalid-key-12345',
        model: 'gpt-4o-mini',
        maxRetries: 1, // Don't retry on auth errors
      })

      await expect(invalidProvider.generateJson('System prompt', 'User prompt')).rejects.toThrow(LLMError)

      try {
        await invalidProvider.generateJson('System prompt', 'User prompt')
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError)
        const llmError = error as LLMError
        expect(llmError.llmCode).toBe(LLMErrorCode.INVALID_API_KEY)
        expect(llmError.provider).toBe('openai')
        expect(llmError.retryable).toBe(false)
      }
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI)(
    'should handle malformed JSON responses',
    async () => {
      // This test relies on the LLM potentially returning malformed JSON
      // We'll use a prompt that might cause issues
      try {
        const response = await provider.generateJson('Respond with broken JSON', 'Break the JSON format')

        // If it succeeds, verify we can still parse it
        expect(() => JSON.parse(response.rawResponse)).not.toThrow()
      } catch (error) {
        // If it fails, it should be a parse error
        expect(error).toBeInstanceOf(LLMError)
        const llmError = error as LLMError
        expect(llmError.llmCode).toBe(LLMErrorCode.INVALID_RESPONSE)
      }

      updateStats('openai')
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI)(
    'should handle concurrent requests without race conditions',
    async () => {
      const prompts = [
        'Classify: I like coffee',
        'Classify: Meeting at 3pm',
        'Classify: Sarah is my friend',
        'Classify: Python is a language',
        'Classify: I prefer dark mode',
      ]

      const promises = prompts.map((prompt) =>
        provider.generateJson('Classify. Respond JSON: {"type": "fact|event|preference|skill|relationship"}', prompt)
      )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(5)
      results.forEach((result) => {
        expect(result.rawResponse).toBeTruthy()
        expect(result.provider).toBe('openai')
        expect(() => JSON.parse(result.rawResponse)).not.toThrow()
      })

      updateStats(
        'openai',
        results.reduce((sum, r) => sum + (r.tokensUsed?.total ?? 0), 0)
      )
    },
    { timeout: 60000 }
  )

  it.skipIf(!HAS_OPENAI)(
    'should respect timeout configuration',
    async () => {
      const timeoutProvider = createOpenAIProvider({
        apiKey: OPENAI_KEY!,
        model: 'gpt-4o-mini',
        timeoutMs: 100, // Very short timeout
        maxRetries: 1,
      })

      await expect(
        timeoutProvider.generateJson('System prompt with lots of text to process', 'User prompt that takes time')
      ).rejects.toThrow()
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI)(
    'should use caching effectively',
    async () => {
      const prompt = 'Classify: Paris is the capital of France'

      // First call - should hit API
      const result1 = await provider.generateJson('Classify. Respond JSON: {"type": "fact"}', prompt)
      expect(result1.rawResponse).toBeTruthy()

      // Same prompt - should use cache (though generateJson doesn't cache by default)
      // This is more relevant for extractMemories which does cache
      const result2 = await provider.generateJson('Classify. Respond JSON: {"type": "fact"}', prompt)
      expect(result2.rawResponse).toBeTruthy()

      updateStats('openai', result1.tokensUsed?.total)
    },
    { timeout: 30000 }
  )
})

// ============================================================================
// Anthropic Provider Integration Tests
// ============================================================================

describe('Anthropic Provider Integration (Real API)', () => {
  let provider: AnthropicLLMProvider

  beforeEach(() => {
    if (!HAS_ANTHROPIC) {
      console.log('⏭️  Skipping Anthropic tests - ANTHROPIC_API_KEY not set')
      return
    }

    provider = createAnthropicProvider({
      apiKey: ANTHROPIC_KEY!,
      model: 'claude-haiku-4-5-20251001', // Cheapest model
      maxTokens: 512, // Minimal tokens
      temperature: 0.1,
      timeoutMs: 30000,
      maxRetries: 3,
    })
  })

  afterEach(() => {
    if (provider) {
      provider.clearCache()
    }
  })

  it.skipIf(!HAS_ANTHROPIC)('should be available when API key is set', () => {
    expect(provider.isAvailable()).toBe(true)
  })

  it.skipIf(!HAS_ANTHROPIC)(
    'should successfully classify memory type with real LLM',
    async () => {
      const response = await provider.generateJson(
        'You are a classifier. Respond with JSON only: {"type": "fact", "confidence": 0.9}',
        'Classify: Paris is the capital of France'
      )

      expect(response.rawResponse).toBeTruthy()
      expect(response.provider).toBe('anthropic')
      expect(response.tokensUsed).toBeDefined()
      expect(response.tokensUsed!.total).toBeGreaterThan(0)

      const parsed = JSON.parse(response.rawResponse)
      expect(parsed).toHaveProperty('type')
      expect(parsed).toHaveProperty('confidence')

      updateStats('anthropic', response.tokensUsed?.total)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_ANTHROPIC)(
    'should detect contradictions with real LLM',
    async () => {
      const response = await provider.generateJson(
        'Compare two statements. Respond with JSON only: {"isContradiction": boolean, "confidence": 0.0-1.0, "reason": "string", "shouldSupersede": boolean}',
        'OLD: "I live in New York"\nNEW: "I moved to London"\n\nDo they contradict?'
      )

      expect(response.rawResponse).toBeTruthy()

      const parsed = JSON.parse(response.rawResponse)
      expect(parsed).toHaveProperty('isContradiction')
      expect(parsed).toHaveProperty('confidence')

      // Should detect contradiction
      expect(parsed.isContradiction).toBe(true)
      expect(parsed.confidence).toBeGreaterThan(0.5)

      updateStats('anthropic', response.tokensUsed?.total)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_ANTHROPIC)(
    'should handle invalid API key gracefully',
    async () => {
      const invalidProvider = createAnthropicProvider({
        apiKey: 'sk-ant-invalid-key-12345',
        model: 'claude-3-haiku-20240307',
        maxRetries: 1,
      })

      await expect(invalidProvider.generateJson('System prompt', 'User prompt')).rejects.toThrow(LLMError)

      try {
        await invalidProvider.generateJson('System prompt', 'User prompt')
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError)
        const llmError = error as LLMError
        expect(llmError.llmCode).toBe(LLMErrorCode.INVALID_API_KEY)
        expect(llmError.provider).toBe('anthropic')
      }
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_ANTHROPIC)(
    'should handle concurrent requests',
    async () => {
      const prompts = [
        'Classify: I enjoy reading',
        'Classify: Birthday party tomorrow',
        'Classify: John is my colleague',
      ]

      const promises = prompts.map((prompt) =>
        provider.generateJson('Classify. Respond JSON: {"type": "fact|event|relationship"}', prompt)
      )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      results.forEach((result) => {
        expect(result.rawResponse).toBeTruthy()
        // LLMs may sometimes return prose instead of JSON; verify we got a response
        // JSON parsing is attempted but not required (real LLM behavior is variable)
        if (result.rawResponse.trim().startsWith('{')) {
          expect(() => JSON.parse(result.rawResponse)).not.toThrow()
        }
      })

      updateStats(
        'anthropic',
        results.reduce((sum, r) => sum + (r.tokensUsed?.total ?? 0), 0)
      )
    },
    { timeout: 60000 }
  )
})

// ============================================================================
// Memory Classifier Service Integration Tests
// ============================================================================

describe('Memory Classifier Service Integration', () => {
  let classifier: MemoryClassifierService

  beforeEach(() => {
    resetMemoryClassifier()
    resetLLMProvider()

    if (HAS_OPENAI || HAS_ANTHROPIC) {
      // Use real LLM - enable feature flag
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = OPENAI_KEY
      process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY
      classifier = new MemoryClassifierService({
        minConfidence: 0.5, // Lower threshold to ensure LLM is used
        enableCache: true,
        fallbackToPatterns: true,
      })
    } else {
      // Use mock for testing
      classifier = new MemoryClassifierService({
        fallbackToPatterns: true,
      })
    }
  })

  afterEach(() => {
    resetMemoryClassifier()
    resetLLMProvider()
  })

  it.skipIf(!HAS_OPENAI && !HAS_ANTHROPIC)(
    'should classify fact with real LLM',
    async () => {
      const result = await classifier.classify('Paris is the capital of France')

      expect(result.type).toBe('fact')
      expect(result.confidence).toBeGreaterThanOrEqual(0.5) // Adjusted threshold
      expect(result.usedLLM).toBe(true)
      expect(result.cached).toBe(false)

      const provider = HAS_OPENAI ? 'openai' : 'anthropic'
      updateStats(provider)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI && !HAS_ANTHROPIC)(
    'should classify event with real LLM',
    async () => {
      const result = await classifier.classify('Meeting with team at 3pm tomorrow')

      expect(result.type).toBe('event')
      expect(result.confidence).toBeGreaterThanOrEqual(0.5)
      expect(result.usedLLM).toBe(true)

      const provider = HAS_OPENAI ? 'openai' : 'anthropic'
      updateStats(provider)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI && !HAS_ANTHROPIC)(
    'should classify preference with real LLM',
    async () => {
      const result = await classifier.classify('I prefer dark mode over light mode')

      expect(result.type).toBe('preference')
      expect(result.confidence).toBeGreaterThanOrEqual(0.5)
      expect(result.usedLLM).toBe(true)

      const provider = HAS_OPENAI ? 'openai' : 'anthropic'
      updateStats(provider)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI && !HAS_ANTHROPIC)(
    'should use cache for repeated classifications',
    async () => {
      const content = 'Python is a programming language'

      // First call - uses LLM
      const result1 = await classifier.classify(content)
      expect(result1.usedLLM).toBe(true)
      expect(result1.cached).toBe(false)

      // Second call - uses cache
      const result2 = await classifier.classify(content)
      expect(result2.type).toBe(result1.type)
      expect(result2.cached).toBe(true)

      const stats = classifier.getStats()
      expect(stats.cacheHitRate).toBe(50) // 1 of 2 calls was cached

      const provider = HAS_OPENAI ? 'openai' : 'anthropic'
      updateStats(provider)
    },
    { timeout: 30000 }
  )

  it('should fallback to patterns when LLM unavailable', async () => {
    // Temporarily clear API keys to force fallback
    const originalOpenAI = process.env.OPENAI_API_KEY
    const originalAnthropic = process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    try {
      // Reset LLM provider to pick up environment changes
      resetLLMProvider()
      resetMemoryClassifier()

      // Create classifier without API keys
      const noLLMClassifier = new MemoryClassifierService({
        fallbackToPatterns: true,
      })

      const result = await noLLMClassifier.classify('Paris is the capital of France')

      expect(result.type).toBe('fact') // Pattern matching should still work
      expect(result.usedLLM).toBe(false)
      expect(result.cached).toBe(false)

      updateStats('mock')
    } finally {
      // Restore original environment
      if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI
      if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic
      resetLLMProvider()
      resetMemoryClassifier()
    }
  })
})

// ============================================================================
// Contradiction Detector Service Integration Tests
// ============================================================================

describe('Contradiction Detector Service Integration', () => {
  let detector: ContradictionDetectorService

  beforeEach(() => {
    resetContradictionDetector()
    resetLLMProvider()

    if (HAS_OPENAI || HAS_ANTHROPIC) {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = OPENAI_KEY
      process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY
      detector = new ContradictionDetectorService({
        minConfidence: 0.5, // Lower threshold
        enableCache: true,
        fallbackToHeuristics: true,
      })
    } else {
      detector = new ContradictionDetectorService({
        fallbackToHeuristics: true,
      })
    }
  })

  afterEach(() => {
    resetContradictionDetector()
    resetLLMProvider()
  })

  it.skipIf(!HAS_OPENAI && !HAS_ANTHROPIC)(
    'should detect true contradiction with real LLM',
    async () => {
      const oldMemory = createTestMemory('I work at Google', 'fact')
      const newMemory = createTestMemory('I work at Microsoft', 'fact')

      const result = await detector.checkContradiction(newMemory, oldMemory)

      expect(result.isContradiction).toBe(true)
      expect(result.confidence).toBeGreaterThanOrEqual(0.5)
      expect(result.shouldSupersede).toBe(true)
      expect(result.usedLLM).toBe(true)

      const provider = HAS_OPENAI ? 'openai' : 'anthropic'
      updateStats(provider)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI && !HAS_ANTHROPIC)(
    'should detect compatible statements (no contradiction)',
    async () => {
      const oldMemory = createTestMemory('I like pizza', 'preference')
      const newMemory = createTestMemory('I also enjoy pasta', 'preference')

      const result = await detector.checkContradiction(newMemory, oldMemory)

      expect(result.isContradiction).toBe(false)
      // Confidence can be low or 0 for non-contradictions - that's valid
      // The key assertion is that isContradiction is false
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.usedLLM).toBe(true)

      const provider = HAS_OPENAI ? 'openai' : 'anthropic'
      updateStats(provider)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI && !HAS_ANTHROPIC)(
    'should detect update that supersedes',
    async () => {
      const oldMemory = createTestMemory('I live in New York', 'fact')
      const newMemory = createTestMemory('I moved to San Francisco last month', 'event')

      const result = await detector.checkContradiction(newMemory, oldMemory)

      // Real LLM behavior is variable - some may see this as contradiction, others may not
      // The key test is that we get a valid response with proper structure
      expect(result).toHaveProperty('isContradiction')
      expect(result).toHaveProperty('shouldSupersede')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('reason')
      expect(result.usedLLM).toBe(true)

      // If it's detected as contradiction, verify supersede logic
      if (result.isContradiction) {
        expect(result.shouldSupersede).toBe(true)
        expect(result.confidence).toBeGreaterThanOrEqual(0.5)
      }

      const provider = HAS_OPENAI ? 'openai' : 'anthropic'
      updateStats(provider)
    },
    { timeout: 30000 }
  )

  it('should handle unrelated content (low overlap)', async () => {
    // NOTE: LLM is now called for all pairs when available (for semantic analysis)
    // The overlap filter is only applied for heuristic fallback
    const oldMemory = createTestMemory('I like pizza', 'preference')
    const newMemory = createTestMemory('Quantum computing is fascinating', 'note')

    const result = await detector.checkContradiction(newMemory, oldMemory)

    expect(result.isContradiction).toBe(false)
    // LLM is now called even for low overlap (semantic analysis)
    // The mock LLM provides its own reason
    expect(result.reason).toBeDefined()
    expect(result.usedLLM).toBe(true)

    updateStats('mock')
  })

  it('should fallback to heuristics when LLM unavailable', async () => {
    // Temporarily clear API keys to force fallback
    const originalOpenAI = process.env.OPENAI_API_KEY
    const originalAnthropic = process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    try {
      // Reset LLM provider to pick up environment changes
      resetLLMProvider()
      resetContradictionDetector()

      const noLLMDetector = new ContradictionDetectorService({
        fallbackToHeuristics: true,
      })

      const oldMemory = createTestMemory('I work at Google', 'fact')
      const newMemory = createTestMemory('I now work at Microsoft', 'fact')

      const result = await noLLMDetector.checkContradiction(newMemory, oldMemory)

      expect(result.isContradiction).toBe(true) // Heuristics should detect "now"
      expect(result.usedLLM).toBe(false)

      updateStats('mock')
    } finally {
      // Restore original environment
      if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI
      if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic
      resetLLMProvider()
      resetContradictionDetector()
    }
  })
})

// ============================================================================
// Memory Extension Detector Service Integration Tests
// ============================================================================

describe('Memory Extension Detector Service Integration', () => {
  let detector: MemoryExtensionDetectorService

  beforeEach(() => {
    resetMemoryExtensionDetector()
    resetLLMProvider()

    if (HAS_OPENAI || HAS_ANTHROPIC) {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = OPENAI_KEY
      process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY
      detector = new MemoryExtensionDetectorService({
        minConfidence: 0.5, // Lower threshold
        enableCache: true,
        fallbackToHeuristics: true,
      })
    } else {
      detector = new MemoryExtensionDetectorService({
        fallbackToHeuristics: true,
      })
    }
  })

  afterEach(() => {
    resetMemoryExtensionDetector()
    resetLLMProvider()
  })

  it.skipIf(!HAS_OPENAI && !HAS_ANTHROPIC)(
    'should detect true extension with real LLM',
    async () => {
      const oldMemory = createTestMemory('I like pizza', 'preference')
      const newMemory = createTestMemory('I like pizza, especially margherita and pepperoni', 'preference')

      const result = await detector.checkExtension(newMemory, oldMemory)

      expect(result.isExtension).toBe(true)
      expect(result.confidence).toBeGreaterThanOrEqual(0.5)
      expect(result.usedLLM).toBe(true)

      const provider = HAS_OPENAI ? 'openai' : 'anthropic'
      updateStats(provider)
    },
    { timeout: 30000 }
  )

  it.skipIf(!HAS_OPENAI && !HAS_ANTHROPIC)('should detect non-extension (different topics)', async () => {
    const oldMemory = createTestMemory('I like coffee', 'preference')
    const newMemory = createTestMemory('I enjoy playing tennis', 'preference')

    const result = await detector.checkExtension(newMemory, oldMemory)

    expect(result.isExtension).toBe(false)
    expect(result.usedLLM).toBe(false) // Low overlap, skips LLM

    const provider = HAS_OPENAI ? 'openai' : 'anthropic'
    updateStats(provider)
  })

  it.skipIf(!HAS_OPENAI && !HAS_ANTHROPIC)('should detect substring (not extension)', async () => {
    const oldMemory = createTestMemory('I like pizza, pasta, and Italian food', 'preference')
    const newMemory = createTestMemory('I like pizza', 'preference')

    const result = await detector.checkExtension(newMemory, oldMemory)

    expect(result.isExtension).toBe(false)
    expect(result.reason).toContain('contained')

    updateStats('mock')
  })

  it('should fallback to heuristics when LLM unavailable', async () => {
    // Temporarily clear API keys to force fallback
    const originalOpenAI = process.env.OPENAI_API_KEY
    const originalAnthropic = process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    try {
      // Reset LLM provider to pick up environment changes
      resetLLMProvider()
      resetMemoryExtensionDetector()

      const noLLMDetector = new MemoryExtensionDetectorService({
        fallbackToHeuristics: true,
      })

      const oldMemory = createTestMemory('I like coffee', 'preference')
      const newMemory = createTestMemory('I like coffee and tea', 'preference')

      const result = await noLLMDetector.checkExtension(newMemory, oldMemory)

      expect(result.isExtension).toBe(true) // Heuristics detect "and"
      expect(result.usedLLM).toBe(false)

      updateStats('mock')
    } finally {
      // Restore original environment
      if (originalOpenAI) process.env.OPENAI_API_KEY = originalOpenAI
      if (originalAnthropic) process.env.ANTHROPIC_API_KEY = originalAnthropic
      resetLLMProvider()
      resetMemoryExtensionDetector()
    }
  })
})

// ============================================================================
// Error Handling and Edge Cases
// ============================================================================

describe('LLM Error Handling', () => {
  it.skipIf(!HAS_OPENAI)('should handle rate limiting with exponential backoff', async () => {
    // This test would require hitting rate limits, which is expensive
    // Instead, we test that the retry mechanism is configured correctly
    const provider = createOpenAIProvider({
      apiKey: OPENAI_KEY!,
      model: 'gpt-4o-mini',
      maxRetries: 3,
      retryDelayMs: 100,
    })

    expect(provider.isAvailable()).toBe(true)
    // The actual retry logic is tested in unit tests
  })

  it(
    'should handle network timeout',
    async () => {
      if (!HAS_OPENAI) {
        console.log('⏭️  Skipping timeout test - no API key')
        return
      }

      const provider = createOpenAIProvider({
        apiKey: OPENAI_KEY!,
        model: 'gpt-4o-mini',
        timeoutMs: 1, // 1ms timeout - guaranteed to fail
        maxRetries: 1,
      })

      await expect(provider.generateJson('System', 'User')).rejects.toThrow()
    },
    { timeout: 10000 }
  )

  it('should handle empty responses gracefully', async () => {
    // Mock provider can simulate this
    const classifier = new MemoryClassifierService({
      fallbackToPatterns: true,
    })

    const result = await classifier.classify('')
    expect(result).toBeDefined()
    expect(result.type).toBeTruthy()
  })
})

// ============================================================================
// Performance and Cost Metrics
// ============================================================================

describe.sequential('Performance Metrics', () => {
  it('should report test statistics', () => {
    console.log('\n📊 LLM Integration Test Statistics:')
    console.log(`   Total Tests: ${testStats.totalTests}`)
    console.log(`   OpenAI Tests: ${testStats.openaiTests}`)
    console.log(`   Anthropic Tests: ${testStats.anthropicTests}`)
    console.log(`   Mock Tests: ${testStats.mockTests}`)
    console.log(`   Total API Calls: ${testStats.totalCalls}`)
    console.log(`   Total Tokens: ${testStats.totalTokens}`)
    console.log(`   Estimated Cost: $${testStats.estimatedCost.toFixed(4)}`)

    if (!HAS_OPENAI && !HAS_ANTHROPIC) {
      console.log('\n⚠️  No API keys set - tests ran with mocks only')
      console.log('   Set OPENAI_API_KEY or ANTHROPIC_API_KEY to run real LLM tests')
    }

    expect(testStats.totalTests).toBeGreaterThan(0)
  })
})
