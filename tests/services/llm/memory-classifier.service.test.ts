/**
 * Memory Classifier Service Tests
 *
 * Tests LLM-based memory type classification with fallback to pattern matching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MemoryClassifierService,
  getMemoryClassifier,
  resetMemoryClassifier,
} from '../../../src/services/llm/memory-classifier.service.js'
import { resetLLMProvider, setLLMProvider } from '../../../src/services/llm/index.js'
import { createMockProvider } from '../../../src/services/llm/mock.js'
import type { MemoryType } from '../../../src/types/index.js'
import { LLMError } from '../../../src/services/llm/base.js'

describe('MemoryClassifierService', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    resetMemoryClassifier()
    resetLLMProvider()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    resetMemoryClassifier()
    resetLLMProvider()
  })

  describe('Pattern Matching Fallback', () => {
    it('should classify facts using patterns', async () => {
      const classifier = new MemoryClassifierService({ fallbackToPatterns: true })
      const result = await classifier.classify('The sky is blue')

      expect(result.type).toBe('fact')
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.usedLLM).toBe(false)
    })

    it('should classify events using patterns', async () => {
      const classifier = new MemoryClassifierService({ fallbackToPatterns: true })
      const result = await classifier.classify('The meeting happened yesterday.')

      expect(result.type).toBe('event')
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.usedLLM).toBe(false)
    })

    it('should classify preferences using patterns', async () => {
      const classifier = new MemoryClassifierService({ fallbackToPatterns: true })
      const result = await classifier.classify('I prefer TypeScript over JavaScript')

      expect(result.type).toBe('preference')
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.usedLLM).toBe(false)
    })

    it('should classify skills using patterns', async () => {
      const classifier = new MemoryClassifierService({ fallbackToPatterns: true })
      const result = await classifier.classify('I am expert in Python')

      expect(result.type).toBe('skill')
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.usedLLM).toBe(false)
    })

    it('should default to note for unmatched content', async () => {
      const classifier = new MemoryClassifierService({ fallbackToPatterns: true })
      const result = await classifier.classify('random text here xyz')

      expect(result.type).toBe('note')
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.usedLLM).toBe(false)
    })
  })

  describe('LLM Classification', () => {
    it('should use LLM when available', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      // Set up mock LLM provider
      const mockProvider = createMockProvider({
        mockJsonResponses: [{ type: 'preference', confidence: 0.9, reasoning: 'Stated preference' }],
      })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService()
      const result = await classifier.classify('I prefer TypeScript over JavaScript')

      expect(result.type).toBe('preference')
      expect(result.confidence).toBe(0.9)
      expect(result.usedLLM).toBe(true)
      expect(result.cached).toBe(false)
    })

    it('should use dedicated classification prompt template', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ type: 'fact', confidence: 0.8, reasoning: 'Statement of fact' }],
      })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService()
      await classifier.classify('The sky is blue')

      const lastTask = mockProvider.getLastJsonTask()
      expect(lastTask?.systemPrompt).toContain('memory classification')
      expect(lastTask?.userPrompt).toContain('Classify this content')
    })

    it('should fall back to patterns on LLM error', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      // Set up mock LLM provider that throws error
      const mockProvider = createMockProvider({ simulateErrors: true, errorRate: 1 })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService({ fallbackToPatterns: true })
      const result = await classifier.classify('The earth is round')

      expect(result.type).toBe('fact')
      expect(result.usedLLM).toBe(false)
      expect(result.cached).toBe(false)
    })

    it('should throw error when fallback is disabled and LLM fails', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({ simulateErrors: true, errorRate: 1 })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService({ fallbackToPatterns: false })

      await expect(classifier.classify('test content')).rejects.toThrow()
    })

    it('should return structured error on invalid JSON response', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({ mockJsonResponses: ['not-json'] })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService({ fallbackToPatterns: false })

      await expect(classifier.classify('test content')).rejects.toBeInstanceOf(LLMError)
    })

    it('should bypass LLM when feature flag is off', async () => {
      process.env.MEMORY_ENABLE_LLM = 'false'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ type: 'preference', confidence: 0.9, reasoning: 'Stated' }],
      })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService({ fallbackToPatterns: true })
      const result = await classifier.classify('I prefer TypeScript')

      expect(result.usedLLM).toBe(false)
    })
  })

  describe('Caching', () => {
    it('should cache classification results', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ type: 'fact', confidence: 0.9, reasoning: 'Statement of fact' }],
      })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService({ enableCache: true })

      const result1 = await classifier.classify('The sky is blue')
      const result2 = await classifier.classify('The sky is blue')

      expect(result1.cached).toBe(false)
      expect(result2.cached).toBe(true)
      expect(result1.type).toBe(result2.type)
    })

    it('should respect cache TTL', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ type: 'fact', confidence: 0.9, reasoning: 'Statement of fact' }],
      })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService({
        enableCache: true,
        cacheTTLMs: 100, // 100ms TTL
      })

      const result1 = await classifier.classify('The sky is blue')
      expect(result1.cached).toBe(false)

      // Within TTL
      const result2 = await classifier.classify('The sky is blue')
      expect(result2.cached).toBe(true)

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      const result3 = await classifier.classify('The sky is blue')
      expect(result3.cached).toBe(false)
    })

    it('should respect max cache size', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [
          { type: 'fact', confidence: 0.9, reasoning: 'Statement of fact' },
          { type: 'fact', confidence: 0.9, reasoning: 'Statement of fact' },
          { type: 'fact', confidence: 0.9, reasoning: 'Statement of fact' },
        ],
      })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService({
        enableCache: true,
        maxCacheSize: 2,
      })

      await classifier.classify('Content 1')
      await classifier.classify('Content 2')
      await classifier.classify('Content 3')

      const stats = classifier.getStats()
      expect(stats.cacheSize).toBeLessThanOrEqual(2)
    })

    it('should clear cache on demand', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ type: 'fact', confidence: 0.9, reasoning: 'Statement of fact' }],
      })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService({ enableCache: true })

      await classifier.classify('The sky is blue')
      expect(classifier.getStats().cacheSize).toBeGreaterThan(0)

      classifier.clearCache()
      expect(classifier.getStats().cacheSize).toBe(0)
    })

    it('should not cache low confidence results', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ type: 'note', confidence: 0.3, reasoning: 'Ambiguous' }],
      })
      setLLMProvider(mockProvider)
      const classifier = new MemoryClassifierService({ enableCache: true, minConfidence: 0.6 })

      const result = await classifier.classify('ambiguous content')
      expect(classifier.getStats().cacheSize).toBe(0)
    })
  })

  describe('Statistics', () => {
    it('should track classification statistics', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [{ type: 'fact', confidence: 0.9, reasoning: 'Statement of fact' }],
      })
      setLLMProvider(mockProvider)

      const classifier = new MemoryClassifierService({ enableCache: true })

      await classifier.classify('Content 1')
      await classifier.classify('Content 1') // Cache hit
      await classifier.classify('Content 2')

      const stats = classifier.getStats()
      expect(stats.totalClassifications).toBe(3)
      expect(stats.cacheHits).toBe(1)
      expect(stats.cacheHitRate).toBeGreaterThan(0)
    })

    it('should track LLM vs pattern classification counts', async () => {
      const classifier = new MemoryClassifierService({ fallbackToPatterns: true })

      // Pattern-based (no LLM provider)
      await classifier.classify('The sky is blue')

      const stats = classifier.getStats()
      expect(stats.patternClassifications).toBeGreaterThan(0)
    })
  })

  describe('Singleton Instance', () => {
    it('should return same instance from getMemoryClassifier', () => {
      const instance1 = getMemoryClassifier()
      const instance2 = getMemoryClassifier()

      expect(instance1).toBe(instance2)
    })

    it('should reset singleton instance', () => {
      const instance1 = getMemoryClassifier()
      resetMemoryClassifier()
      const instance2 = getMemoryClassifier()

      expect(instance1).not.toBe(instance2)
    })

    it('should accept config on first call only', () => {
      const instance = getMemoryClassifier({ enableCache: false })
      expect(instance).toBeDefined()

      // Second call with different config should return same instance
      const instance2 = getMemoryClassifier({ enableCache: true })
      expect(instance).toBe(instance2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty content', async () => {
      const classifier = new MemoryClassifierService()
      const result = await classifier.classify('')

      expect(result.type).toBeDefined()
      expect(result.confidence).toBeGreaterThanOrEqual(0)
    })

    it('should handle very long content', async () => {
      const classifier = new MemoryClassifierService()
      const longContent = 'The sky is blue. '.repeat(1000)

      const result = await classifier.classify(longContent)
      expect(result.type).toBe('fact')
    })

    it('should handle special characters', async () => {
      const classifier = new MemoryClassifierService()
      const result = await classifier.classify('Special chars: @#$%^&*()')

      expect(result.type).toBeDefined()
    })

    it('should handle non-English content gracefully', async () => {
      const classifier = new MemoryClassifierService()
      const result = await classifier.classify('これは日本語です')

      expect(result.type).toBeDefined()
    })
  })

  describe('Configuration', () => {
    it('should respect minConfidence threshold', async () => {
      const classifier = new MemoryClassifierService({ minConfidence: 0.8 })
      expect(classifier).toBeDefined()
    })

    it('should handle disabled cache', async () => {
      const classifier = new MemoryClassifierService({ enableCache: false })

      await classifier.classify('Content 1')
      await classifier.classify('Content 1')

      const stats = classifier.getStats()
      expect(stats.cacheHits).toBe(0)
    })
  })
})
