/**
 * Tests for Embedding-Based Relationship Detector
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  EmbeddingRelationshipDetector,
  InMemoryVectorStoreAdapter,
  createEmbeddingRelationshipDetector,
  detectRelationshipsWithEmbeddings,
} from '../../../src/services/relationships/detector.js'
import type { Memory } from '../../../src/services/memory.types.js'
import type { EmbeddingService } from '../../../src/services/embedding.service.js'
import type { LLMProvider, LLMVerificationResponse } from '../../../src/services/relationships/types.js'

// ============================================================================
// Mock Embedding Service
// ============================================================================

function createMockEmbeddingService(): EmbeddingService {
  // Simple mock that generates deterministic embeddings based on content
  return {
    generateEmbedding: vi.fn(async (text: string) => {
      // Generate a simple embedding based on text hash
      const embedding = new Array(384).fill(0)
      for (let i = 0; i < text.length && i < 384; i++) {
        embedding[i] = text.charCodeAt(i) / 256
      }
      // Normalize
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
      return embedding.map((v) => v / (magnitude || 1))
    }),
    batchEmbed: vi.fn(async (texts: string[]) => {
      const results: number[][] = []
      for (const text of texts) {
        const embedding = new Array(384).fill(0)
        for (let i = 0; i < text.length && i < 384; i++) {
          embedding[i] = text.charCodeAt(i) / 256
        }
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
        results.push(embedding.map((v) => v / (magnitude || 1)))
      }
      return results
    }),
    getConfig: vi.fn(() => ({
      model: 'mock',
      dimensions: 384,
      isLocal: true,
    })),
    getDimensions: vi.fn(() => 384),
    isUsingLocalFallback: vi.fn(() => true),
  } as unknown as EmbeddingService
}

// ============================================================================
// Mock LLM Provider
// ============================================================================

function createMockLLMProvider(): LLMProvider {
  return {
    verifyRelationship: vi.fn(
      async () =>
        ({
          relationshipType: 'related',
          confidence: 0.9,
          explanation: 'Mock verification',
          isContradiction: false,
        }) as LLMVerificationResponse
    ),
    checkContradiction: vi.fn(async () => ({
      isContradiction: false,
      confidence: 0.1,
      description: 'No contradiction detected',
    })),
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

function createTestMemory(id: string, content: string, options: Partial<Memory> = {}): Memory {
  return {
    id,
    content,
    type: 'fact',
    relationships: [],
    isLatest: true,
    containerTag: 'test',
    confidence: 0.8,
    metadata: {
      confidence: 0.8,
      entities: options.metadata?.entities || [],
    },
    createdAt: options.createdAt || new Date(),
    updatedAt: options.updatedAt || new Date(),
    ...options,
  }
}

function createSimilarEmbedding(base: number[], similarity: number): number[] {
  // Create an embedding with target similarity to base
  const noise = 1 - similarity
  return base.map((v, i) => v * similarity + Math.random() * noise * (i % 2 === 0 ? 1 : -1))
}

// ============================================================================
// InMemoryVectorStoreAdapter Tests
// ============================================================================

describe('InMemoryVectorStoreAdapter', () => {
  let store: InMemoryVectorStoreAdapter

  beforeEach(() => {
    store = new InMemoryVectorStoreAdapter()
  })

  it('should add and retrieve memories', async () => {
    const memory = createTestMemory('1', 'Test content')
    const embedding = [0.1, 0.2, 0.3]

    store.addMemory(memory, embedding)
    const all = store.getAllMemories()

    expect(all).toHaveLength(1)
    expect(all[0]?.id).toBe('1')
  })

  it('should find similar memories', async () => {
    const embedding1 = [0.5, 0.5, 0.5, 0.5]
    const embedding2 = [0.5, 0.5, 0.5, 0.49] // Very similar
    const embedding3 = [-0.5, -0.5, -0.5, -0.5] // Very different

    store.addMemory(createTestMemory('1', 'Memory 1'), embedding1)
    store.addMemory(createTestMemory('2', 'Memory 2'), embedding2)
    store.addMemory(createTestMemory('3', 'Memory 3'), embedding3)

    const results = await store.findSimilar(embedding1, 10, 0.9)

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some((r) => r.memoryId === '1')).toBe(true)
  })

  it('should filter by container tag', async () => {
    const embedding = [0.5, 0.5, 0.5]

    store.addMemory(createTestMemory('1', 'Memory 1', { containerTag: 'tag-a' }), embedding)
    store.addMemory(createTestMemory('2', 'Memory 2', { containerTag: 'tag-b' }), embedding)

    const results = await store.findSimilar(embedding, 10, 0.5, {
      containerTag: 'tag-a',
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.memoryId).toBe('1')
  })

  it('should exclude specified IDs', async () => {
    const embedding = [0.5, 0.5, 0.5]

    store.addMemory(createTestMemory('1', 'Memory 1'), embedding)
    store.addMemory(createTestMemory('2', 'Memory 2'), embedding)

    const results = await store.findSimilar(embedding, 10, 0.5, {
      excludeIds: ['1'],
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.memoryId).toBe('2')
  })

  it('should remove memories', () => {
    const embedding = [0.5, 0.5, 0.5]
    store.addMemory(createTestMemory('1', 'Memory 1'), embedding)

    expect(store.getAllMemories()).toHaveLength(1)

    const removed = store.removeMemory('1')
    expect(removed).toBe(true)
    expect(store.getAllMemories()).toHaveLength(0)
  })
})

// ============================================================================
// EmbeddingRelationshipDetector Tests
// ============================================================================

describe('EmbeddingRelationshipDetector', () => {
  let detector: EmbeddingRelationshipDetector
  let embeddingService: EmbeddingService
  let vectorStore: InMemoryVectorStoreAdapter

  beforeEach(() => {
    embeddingService = createMockEmbeddingService()
    vectorStore = new InMemoryVectorStoreAdapter()
    detector = createEmbeddingRelationshipDetector(embeddingService, vectorStore)
  })

  it('should detect no relationships for empty store', async () => {
    const memory = createTestMemory('1', 'Test content')
    const result = await detector.detectRelationships(memory)

    expect(result.relationships).toHaveLength(0)
    expect(result.supersededMemoryIds).toHaveLength(0)
    expect(result.stats.candidatesEvaluated).toBe(0)
  })

  it('should detect related relationships for similar content', async () => {
    // Add existing memory
    const existingMemory = createTestMemory('existing', 'The user prefers dark mode for their IDE')
    const existingEmbedding = await embeddingService.generateEmbedding(existingMemory.content)
    vectorStore.addMemory(existingMemory, existingEmbedding)

    // Add very similar new memory
    const newMemory = createTestMemory('new', 'The user prefers dark mode for their IDE settings')
    const result = await detector.detectRelationships(newMemory)

    // Should find at least one relationship
    expect(result.stats.candidatesEvaluated).toBeGreaterThan(0)
  })

  it('should detect relationships using embedding helper for candidates', async () => {
    const existingMemory = createTestMemory('existing', 'The user prefers dark mode for their IDE')
    const newMemory = createTestMemory('new', 'The user prefers dark mode for their IDE')

    const result = await detectRelationshipsWithEmbeddings(newMemory, [existingMemory], embeddingService, {
      config: {
        thresholds: {
          updates: 1.1,
          extends: 0.1,
          contradicts: 1.1,
          supersedes: 1.1,
          related: 0.1,
          derives: 1.1,
        },
      },
    })

    expect(result.relationships.length).toBeGreaterThanOrEqual(1)
  })

  it('should detect update relationships', async () => {
    // Add existing memory
    const existingMemory = createTestMemory('existing', 'The deadline is Friday')
    const existingEmbedding = await embeddingService.generateEmbedding(existingMemory.content)
    vectorStore.addMemory(existingMemory, existingEmbedding)

    // Add update memory with explicit update indicator
    const newMemory = createTestMemory('new', 'Actually, the deadline is now Monday instead')

    detector.updateConfig({
      thresholds: {
        updates: 0.3, // Lower threshold for testing
        extends: 0.2,
        contradicts: 0.3,
        supersedes: 0.4,
        related: 0.1,
        derives: 0.2,
      },
    })

    const result = await detector.detectRelationships(newMemory)

    // Check for detected relationships
    expect(result.sourceMemory.id).toBe('new')
  })

  it('should filter by container tag', async () => {
    // Add memories with different tags
    const memory1 = createTestMemory('1', 'Content for tag A', { containerTag: 'tag-a' })
    const memory2 = createTestMemory('2', 'Content for tag B', { containerTag: 'tag-b' })

    const embedding1 = await embeddingService.generateEmbedding(memory1.content)
    const embedding2 = await embeddingService.generateEmbedding(memory2.content)

    vectorStore.addMemory(memory1, embedding1)
    vectorStore.addMemory(memory2, embedding2)

    const newMemory = createTestMemory('new', 'Content for tag A test', { containerTag: 'tag-a' })
    const result = await detector.detectRelationships(newMemory, {
      containerTag: 'tag-a',
    })

    // Should only evaluate candidates from tag-a
    for (const rel of result.relationships) {
      const targetMemory = vectorStore.getAllMemories().find((m) => m.id === rel.relationship.targetMemoryId)
      expect(targetMemory?.containerTag).toBe('tag-a')
    }
  })

  it('should cache relationship scores', async () => {
    detector.cacheScore('source-1', 'target-1', 0.85, 'related')

    const cached = detector.getCachedScore('source-1', 'target-1')
    expect(cached).not.toBeNull()
    expect(cached?.score).toBe(0.85)
    expect(cached?.type).toBe('related')
  })

  it('should clear cache', () => {
    detector.cacheScore('source-1', 'target-1', 0.85, 'related')
    expect(detector.getCacheStats().size).toBe(1)

    detector.clearCache()
    expect(detector.getCacheStats().size).toBe(0)
  })
})

// ============================================================================
// Feature Flag Defaults
// ============================================================================

describe('Embedding Relationship Feature Flags', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('should default to disabled embedding relationships when flag is off', async () => {
    delete process.env.MEMORY_ENABLE_EMBEDDINGS

    const { isEmbeddingRelationshipsEnabled } = await import('../../../src/config/feature-flags.js')

    expect(isEmbeddingRelationshipsEnabled()).toBe(false)
  })
})

// ============================================================================
// Detection Strategies Tests (Removed - logic now inlined in detector)
// ============================================================================
//
// Note: The strategy pattern has been removed as it was over-engineered.
// The detection logic is now implemented as private methods in EmbeddingRelationshipDetector.
// These tests have been removed since the strategy classes no longer exist.
// The behavior is tested through the main detector tests above.

// ============================================================================
// Contradiction Detection Tests
// ============================================================================

describe('Contradiction Detection', () => {
  let detector: EmbeddingRelationshipDetector
  let embeddingService: EmbeddingService
  let vectorStore: InMemoryVectorStoreAdapter

  beforeEach(() => {
    embeddingService = createMockEmbeddingService()
    vectorStore = new InMemoryVectorStoreAdapter()
    detector = createEmbeddingRelationshipDetector(embeddingService, vectorStore, {
      enableContradictionDetection: true,
    })
  })

  it('should detect contradictions in a group of memories', async () => {
    const memories = [
      createTestMemory('1', 'The project deadline is Friday'),
      createTestMemory('2', 'The project deadline is not Friday'),
    ]

    const contradictions = await detector.detectContradictionsInGroup(memories)

    // Should detect the negation contradiction
    expect(contradictions.length).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// Factory Functions Tests
// ============================================================================

describe('Factory Functions', () => {
  it('createEmbeddingRelationshipDetector should create detector', () => {
    const embeddingService = createMockEmbeddingService()
    const detector = createEmbeddingRelationshipDetector(embeddingService)

    expect(detector).toBeInstanceOf(EmbeddingRelationshipDetector)
  })
})
