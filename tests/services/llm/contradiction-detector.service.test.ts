/**
 * Contradiction Detector Service Tests
 *
 * Tests LLM-based contradiction detection with fallback to heuristics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ContradictionDetectorService,
  getContradictionDetector,
  resetContradictionDetector,
} from '../../../src/services/llm/contradiction-detector.service.js'
import { resetLLMProvider, setLLMProvider } from '../../../src/services/llm/index.js'
import { createMockProvider } from '../../../src/services/llm/mock.js'
import type { Memory } from '../../../src/types/index.js'
import { LLMError } from '../../../src/services/llm/base.js'

describe('ContradictionDetectorService', () => {
  const originalEnv = { ...process.env }
  const createMemory = (content: string, id: string = 'test-id'): Memory => ({
    id,
    content,
    type: 'fact' as const,
    containerTag: 'test',
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  })

  beforeEach(() => {
    resetContradictionDetector()
    resetLLMProvider()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    resetContradictionDetector()
    resetLLMProvider()
  })

  describe('Heuristic Detection', () => {
    it('should detect contradiction with indicators', async () => {
      const detector = new ContradictionDetectorService({ fallbackToHeuristics: true })

      const existing = createMemory('I use Python 3.9', 'old')
      const newMem = createMemory('I now use Python 3.11', 'new')

      const result = await detector.checkContradiction(newMem, existing)

      expect(result.isContradiction).toBe(true)
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.usedLLM).toBe(false)
    })

    it('should not detect contradiction for unrelated content', async () => {
      const detector = new ContradictionDetectorService({ fallbackToHeuristics: true })

      const existing = createMemory('I like coffee', 'old')
      const newMem = createMemory('The weather is nice', 'new')

      const result = await detector.checkContradiction(newMem, existing)

      expect(result.isContradiction).toBe(false)
      expect(result.confidence).toBeLessThan(0.5)
    })

    it('should skip check for low overlap', async () => {
      const detector = new ContradictionDetectorService({
        fallbackToHeuristics: true,
        minOverlapForCheck: 0.3,
      })

      const existing = createMemory('Python programming language', 'old')
      const newMem = createMemory('Java development environment', 'new')

      const result = await detector.checkContradiction(newMem, existing)

      expect(result.isContradiction).toBe(false)
      expect(result.reason).toContain('overlap')
    })

    it('should detect superseding with patterns', async () => {
      const detector = new ContradictionDetectorService({ fallbackToHeuristics: true })

      const existing = createMemory('The API version is 1.0 for the project', 'old')
      const newMem = createMemory('The API version 2.0 replaced version 1.0 for the project', 'new')

      const result = await detector.checkContradiction(newMem, existing)

      expect(result.shouldSupersede).toBe(true)
    })
  })

  describe('LLM Detection', () => {
    it('should use LLM when available', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      // Mock LLM provider with contradiction response
      const mockProvider = createMockProvider({
        mockJsonResponses: [
          {
            isContradiction: true,
            confidence: 0.9,
            reason: 'Version update',
            shouldSupersede: true,
          },
        ],
      })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService()

      const existing = createMemory('I use Python 3.9', 'old')
      const newMem = createMemory('I use Python 3.11', 'new')

      const result = await detector.checkContradiction(newMem, existing)

      expect(result.usedLLM).toBe(true)
      expect(result.isContradiction).toBe(true)
      expect(result.shouldSupersede).toBe(true)
    })

    it('should use dedicated contradiction prompt template', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [
          {
            isContradiction: false,
            confidence: 0.2,
            reason: 'Compatible',
            shouldSupersede: false,
          },
        ],
      })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService()

      const existing = createMemory('I use Python 3.9', 'old')
      const newMem = createMemory('I use Python 3.11', 'new')

      await detector.checkContradiction(newMem, existing)

      const lastTask = mockProvider.getLastJsonTask()
      expect(lastTask?.systemPrompt).toContain('contradictions and updates')
      expect(lastTask?.userPrompt).toContain('Compare these statements')
    })

    it('should fall back to heuristics on LLM error', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({ simulateErrors: true, errorRate: 1 })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService({ fallbackToHeuristics: true })

      const existing = createMemory('I use Python for data tasks', 'old')
      const newMem = createMemory('I use Python for data tasks', 'new')

      const result = await detector.checkContradiction(newMem, existing)

      expect(result.usedLLM).toBe(false)
      expect(result.isContradiction).toBeDefined()
    })

    it('should throw error when fallback disabled and LLM fails', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({ simulateErrors: true, errorRate: 1 })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService({ fallbackToHeuristics: false })

      const existing = createMemory('Content 1', 'old')
      const newMem = createMemory('Content 2', 'new')

      await expect(detector.checkContradiction(newMem, existing)).rejects.toThrow()
    })

    it('should return structured error on invalid JSON response', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({ mockJsonResponses: ['not-json'] })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService({ fallbackToHeuristics: false })

      const existing = createMemory('Content 1', 'old')
      const newMem = createMemory('Content 2', 'new')

      await expect(detector.checkContradiction(newMem, existing)).rejects.toBeInstanceOf(LLMError)
    })

    it('should bypass LLM when feature flag is off', async () => {
      process.env.MEMORY_ENABLE_LLM = 'false'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [
          {
            isContradiction: true,
            confidence: 0.9,
            reason: 'Update',
            shouldSupersede: true,
          },
        ],
      })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService({ fallbackToHeuristics: true })

      const existing = createMemory('I use Python 3.9', 'old')
      const newMem = createMemory('I use Python 3.11', 'new')

      const result = await detector.checkContradiction(newMem, existing)
      expect(result.usedLLM).toBe(false)
    })
  })

  describe('Caching', () => {
    it('should cache detection results', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [
          {
            isContradiction: true,
            confidence: 0.9,
            reason: 'Update',
            shouldSupersede: true,
          },
        ],
      })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService({
        enableCache: true,
        minOverlapForCheck: 0,
        minConfidence: 0,
      })

      const existing = createMemory('I use Python', 'old')
      const newMem = createMemory('I now use TypeScript', 'new')

      const result1 = await detector.checkContradiction(newMem, existing)
      const result2 = await detector.checkContradiction(newMem, existing)

      expect(result1.cached).toBe(false)
      expect(result2.cached).toBe(true)
    })

    it('should cache regardless of memory order', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [
          {
            isContradiction: true,
            confidence: 0.9,
            reason: 'Update',
            shouldSupersede: true,
          },
        ],
      })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService({ enableCache: true })

      const mem1 = createMemory('I use Python for data tasks', 'mem1')
      const mem2 = createMemory('I now use Python for data tasks', 'mem2')

      await detector.checkContradiction(mem1, mem2)
      const result = await detector.checkContradiction(mem2, mem1)

      expect(result.cached).toBe(true)
    })

    it('should respect cache TTL', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [
          {
            isContradiction: true,
            confidence: 0.9,
            reason: 'Update',
            shouldSupersede: true,
          },
        ],
      })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService({
        enableCache: true,
        cacheTTLMs: 100,
      })

      const existing = createMemory('Content A for project', 'old')
      const newMem = createMemory('Content A for project updated', 'new')

      await detector.checkContradiction(newMem, existing)

      // Within TTL
      const result1 = await detector.checkContradiction(newMem, existing)
      expect(result1.cached).toBe(true)

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      const result2 = await detector.checkContradiction(newMem, existing)
      expect(result2.cached).toBe(false)
    })

    it('should not cache low confidence results', async () => {
      const detector = new ContradictionDetectorService({
        enableCache: true,
        minConfidence: 0.8,
      })

      // Unrelated content -> low confidence
      const existing = createMemory('I like coffee', 'old')
      const newMem = createMemory('The sky is blue', 'new')

      await detector.checkContradiction(newMem, existing)

      expect(detector.getStats().cacheSize).toBe(0)
    })
  })

  describe('Statistics', () => {
    it('should track detection statistics', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [
          {
            isContradiction: true,
            confidence: 0.9,
            reason: 'Update',
            shouldSupersede: true,
          },
        ],
      })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService({ enableCache: true })

      const existing = createMemory('Content A for project', 'old')

      await detector.checkContradiction(createMemory('Content A for project updated', 'new1'), existing)
      await detector.checkContradiction(createMemory('Content A for project updated', 'new1'), existing) // Cache hit
      await detector.checkContradiction(createMemory('Content A for project revised', 'new2'), existing)

      const stats = detector.getStats()
      expect(stats.totalChecks).toBe(3)
      expect(stats.cacheHits).toBe(1)
      expect(stats.cacheHitRate).toBeGreaterThan(0)
    })

    it('should track contradiction rate', async () => {
      process.env.MEMORY_ENABLE_LLM = 'true'
      process.env.OPENAI_API_KEY = 'test-key'

      const mockProvider = createMockProvider({
        mockJsonResponses: [
          {
            isContradiction: true,
            confidence: 0.9,
            reason: 'Update',
            shouldSupersede: true,
          },
        ],
      })
      setLLMProvider(mockProvider)

      const detector = new ContradictionDetectorService({ fallbackToHeuristics: true })

      const existing = createMemory('I use Python for data tasks', 'old')

      // Contradiction
      await detector.checkContradiction(createMemory('I now use Python for data tasks', 'new1'), existing)

      // No contradiction
      await detector.checkContradiction(createMemory('I like programming with Python', 'new2'), existing)

      const stats = detector.getStats()
      expect(stats.contradictionsFound).toBeGreaterThan(0)
      expect(stats.contradictionRate).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle identical content', async () => {
      const detector = new ContradictionDetectorService()

      const mem1 = createMemory('Identical content', 'id1')
      const mem2 = createMemory('Identical content', 'id2')

      const result = await detector.checkContradiction(mem1, mem2)

      expect(result.isContradiction).toBe(false)
    })

    it('should handle empty content', async () => {
      const detector = new ContradictionDetectorService()

      const mem1 = createMemory('', 'id1')
      const mem2 = createMemory('Content', 'id2')

      const result = await detector.checkContradiction(mem1, mem2)

      expect(result.isContradiction).toBe(false)
    })

    it('should handle very long content', async () => {
      const detector = new ContradictionDetectorService()

      const longContent1 = 'I use Python. '.repeat(1000)
      const longContent2 = 'I use TypeScript. '.repeat(1000)

      const result = await detector.checkContradiction(
        createMemory(longContent1, 'id1'),
        createMemory(longContent2, 'id2')
      )

      expect(result).toBeDefined()
    })

    it('should handle special characters', async () => {
      const detector = new ContradictionDetectorService()

      const result = await detector.checkContradiction(
        createMemory('Content with @#$%', 'id1'),
        createMemory('Different @#$%', 'id2')
      )

      expect(result).toBeDefined()
    })
  })

  describe('Singleton Instance', () => {
    it('should return same instance from getter', () => {
      const instance1 = getContradictionDetector()
      const instance2 = getContradictionDetector()

      expect(instance1).toBe(instance2)
    })

    it('should reset singleton', () => {
      const instance1 = getContradictionDetector()
      resetContradictionDetector()
      const instance2 = getContradictionDetector()

      expect(instance1).not.toBe(instance2)
    })
  })

  describe('Configuration', () => {
    it('should respect minConfidence threshold', async () => {
      const detector = new ContradictionDetectorService({ minConfidence: 0.9 })
      expect(detector).toBeDefined()
    })

    it('should respect minOverlapForCheck', async () => {
      const detector = new ContradictionDetectorService({ minOverlapForCheck: 0.5 })

      const result = await detector.checkContradiction(
        createMemory('Python programming', 'id1'),
        createMemory('Java development', 'id2')
      )

      expect(result.reason).toContain('overlap')
    })
  })
})
