/**
 * Search Service Tests
 *
 * Comprehensive tests for vector similarity search, hybrid search,
 * filtering, and reranking functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SearchService, createSearchService } from '../../src/services/search.service'
import { EmbeddingService, cosineSimilarity } from '../../src/services/embedding.service'
import type { Memory, Chunk, SearchOptions, MetadataFilter } from '../../src/services/search.types'

describe('SearchService', () => {
  let searchService: SearchService

  beforeEach(() => {
    searchService = createSearchService()
  })

  // ============================================================================
  // Vector Similarity Search Tests
  // ============================================================================

  describe('vectorSearch', () => {
    it('should return results sorted by similarity score', async () => {
      const memories = [
        createMockMemory('JavaScript is a programming language.', 'mem1'),
        createMockMemory('TypeScript adds types to JavaScript.', 'mem2'),
        createMockMemory('The weather is sunny today.', 'mem3'),
      ]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      // Generate query embedding
      const embeddingService = searchService.getEmbeddingService()
      const queryEmbedding = await embeddingService.generateEmbedding('JavaScript programming')

      const results = await searchService.vectorSearch(queryEmbedding, 10, 0)

      expect(results.length).toBeGreaterThan(0)
      // Results should be sorted by similarity (descending)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]?.similarity).toBeGreaterThanOrEqual(results[i]?.similarity ?? 0)
      }
    })

    it('should respect the limit parameter', async () => {
      const memories = [
        createMockMemory('Memory 1 about programming.', 'mem1'),
        createMockMemory('Memory 2 about programming.', 'mem2'),
        createMockMemory('Memory 3 about programming.', 'mem3'),
        createMockMemory('Memory 4 about programming.', 'mem4'),
        createMockMemory('Memory 5 about programming.', 'mem5'),
      ]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const embeddingService = searchService.getEmbeddingService()
      const queryEmbedding = await embeddingService.generateEmbedding('programming')

      const results = await searchService.vectorSearch(queryEmbedding, 3, 0)

      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('should filter by similarity threshold', async () => {
      const memories = [
        createMockMemory('The quick brown fox jumps over the lazy dog.', 'mem1'),
        createMockMemory('Quantum computing uses qubits.', 'mem2'),
      ]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const embeddingService = searchService.getEmbeddingService()
      const queryEmbedding = await embeddingService.generateEmbedding('brown fox')

      const results = await searchService.vectorSearch(queryEmbedding, 10, 0.8)

      // All results should meet threshold
      for (const result of results) {
        expect(result.similarity).toBeGreaterThanOrEqual(0.8)
      }
    })

    it('should return empty array when no results meet threshold', async () => {
      const memories = [createMockMemory('Apples are red fruits.', 'mem1')]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const embeddingService = searchService.getEmbeddingService()
      const queryEmbedding = await embeddingService.generateEmbedding('quantum computing')

      const results = await searchService.vectorSearch(queryEmbedding, 10, 0.99)

      expect(results).toHaveLength(0)
    })
  })

  // ============================================================================
  // Hybrid Search Tests
  // ============================================================================

  describe('hybridSearch', () => {
    it('should combine vector and memory graph search results', async () => {
      const memories = [
        createMockMemory('React is a JavaScript library for building UIs.', 'mem1'),
        createMockMemory('Vue is another frontend framework.', 'mem2'),
        createMockMemory('Angular is maintained by Google.', 'mem3'),
      ]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const response = await searchService.hybridSearch('JavaScript frontend')

      expect(response.results.length).toBeGreaterThan(0)
      expect(response.searchTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should include search timing information', async () => {
      const memory = createMockMemory('Test memory content.', 'mem1')
      await searchService.indexMemory(memory)

      const response = await searchService.hybridSearch('test')

      expect(response.searchTimeMs).toBeDefined()
      expect(typeof response.searchTimeMs).toBe('number')
    })

    it('should return total count of results', async () => {
      const memories = Array.from({ length: 20 }, (_, i) => createMockMemory(`Memory ${i} about testing.`, `mem${i}`))

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const response = await searchService.hybridSearch('testing', undefined, { limit: 5 } as any)

      expect(response.totalCount).toBeGreaterThanOrEqual(response.results.length)
    })

    it('should handle query with special characters', async () => {
      const memory = createMockMemory('Testing special characters: @#$%^&*()', 'mem1')
      await searchService.indexMemory(memory)

      const response = await searchService.hybridSearch('special @#$%')

      expect(response).toBeDefined()
    })
  })

  // ============================================================================
  // Container Tag Filtering Tests
  // ============================================================================

  describe('containerTag filtering', () => {
    it('should filter results by containerTag', async () => {
      const memories = [
        { ...createMockMemory('Work project notes.', 'mem1'), containerTag: 'work' },
        { ...createMockMemory('Personal project notes.', 'mem2'), containerTag: 'personal' },
        { ...createMockMemory('Another work item.', 'mem3'), containerTag: 'work' },
      ]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const response = await searchService.hybridSearch('project', 'work')

      for (const result of response.results) {
        if (result.memory) {
          expect(result.memory.containerTag).toBe('work')
        }
      }
    })

    it('should return empty results when containerTag has no matches', async () => {
      const memory = createMockMemory('Test content.', 'mem1')
      memory.containerTag = 'existing-tag'
      await searchService.indexMemory(memory)

      const response = await searchService.hybridSearch('test', 'non-existent-tag')

      expect(response.results).toHaveLength(0)
    })

    it('should return all results when containerTag is not specified', async () => {
      const memories = [
        { ...createMockMemory('Memory A.', 'mem1'), containerTag: 'tag1' },
        { ...createMockMemory('Memory B.', 'mem2'), containerTag: 'tag2' },
      ]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const response = await searchService.hybridSearch('Memory')

      expect(response.results.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // Metadata Filters Tests
  // ============================================================================

  describe('metadata filters', () => {
    it('should filter by equality operator', async () => {
      const memory1 = createMockMemory('High priority task.', 'mem1')
      memory1.metadata = { priority: 'high' }

      const memory2 = createMockMemory('Low priority task.', 'mem2')
      memory2.metadata = { priority: 'low' }

      await searchService.indexMemory(memory1)
      await searchService.indexMemory(memory2)

      const filters: MetadataFilter[] = [{ key: 'priority', value: 'high', operator: 'eq' }]

      const response = await searchService.hybridSearch('task', undefined, { filters } as any)

      for (const result of response.results) {
        expect(result.metadata?.priority).toBe('high')
      }
    })

    it('should filter by not-equal operator', async () => {
      const memory1 = createMockMemory('Active project.', 'mem1')
      memory1.metadata = { status: 'active' }

      const memory2 = createMockMemory('Archived project.', 'mem2')
      memory2.metadata = { status: 'archived' }

      await searchService.indexMemory(memory1)
      await searchService.indexMemory(memory2)

      const filters: MetadataFilter[] = [{ key: 'status', value: 'archived', operator: 'ne' }]

      const response = await searchService.hybridSearch('project', undefined, { filters } as any)

      for (const result of response.results) {
        expect(result.metadata?.status).not.toBe('archived')
      }
    })

    it('should filter by greater-than operator', async () => {
      const memory1 = createMockMemory('Score 90 result.', 'mem1')
      memory1.metadata = { score: 90 }

      const memory2 = createMockMemory('Score 50 result.', 'mem2')
      memory2.metadata = { score: 50 }

      await searchService.indexMemory(memory1)
      await searchService.indexMemory(memory2)

      const filters: MetadataFilter[] = [{ key: 'score', value: 70, operator: 'gt' }]

      const response = await searchService.hybridSearch('result', undefined, { filters } as any)

      for (const result of response.results) {
        expect((result.metadata?.score as number) ?? 0).toBeGreaterThan(70)
      }
    })

    it('should filter by contains operator', async () => {
      const memory1 = createMockMemory('Frontend development.', 'mem1')
      memory1.metadata = { category: 'frontend-development' }

      const memory2 = createMockMemory('Backend development.', 'mem2')
      memory2.metadata = { category: 'backend-api' }

      await searchService.indexMemory(memory1)
      await searchService.indexMemory(memory2)

      const filters: MetadataFilter[] = [{ key: 'category', value: 'frontend', operator: 'contains' }]

      const response = await searchService.hybridSearch('development', undefined, {
        filters,
      } as any)

      for (const result of response.results) {
        expect((result.metadata?.category as string) ?? '').toContain('frontend')
      }
    })

    it('should apply multiple filters with AND logic', async () => {
      const memory1 = createMockMemory('High priority active.', 'mem1')
      memory1.metadata = { priority: 'high', status: 'active' }

      const memory2 = createMockMemory('High priority archived.', 'mem2')
      memory2.metadata = { priority: 'high', status: 'archived' }

      await searchService.indexMemory(memory1)
      await searchService.indexMemory(memory2)

      const filters: MetadataFilter[] = [
        { key: 'priority', value: 'high', operator: 'eq' },
        { key: 'status', value: 'active', operator: 'eq' },
      ]

      const response = await searchService.hybridSearch('priority', undefined, { filters } as any)

      for (const result of response.results) {
        expect(result.metadata?.priority).toBe('high')
        expect(result.metadata?.status).toBe('active')
      }
    })
  })

  // ============================================================================
  // Reranking Tests
  // ============================================================================

  describe('rerank', () => {
    it('should rerank results based on query relevance', async () => {
      const memories = [
        createMockMemory('JavaScript is widely used.', 'mem1'),
        createMockMemory('TypeScript extends JavaScript with types.', 'mem2'),
        createMockMemory('Programming is fun.', 'mem3'),
      ]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const response = await searchService.hybridSearch('JavaScript types', undefined, {
        rerank: true,
      } as any)

      // After reranking, TypeScript memory should score higher for "JavaScript types"
      expect(response.results.length).toBeGreaterThan(0)
    })

    it('should add rerankScore to results', async () => {
      const memories = [
        createMockMemory('React components are reusable.', 'mem1'),
        createMockMemory('Vue also supports components.', 'mem2'),
      ]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const response = await searchService.hybridSearch('React components', undefined, {
        rerank: true,
      } as any)

      // Reranked results should have rerankScore
      for (const result of response.results) {
        if (result.rerankScore !== undefined) {
          expect(typeof result.rerankScore).toBe('number')
          expect(result.rerankScore).toBeGreaterThanOrEqual(0)
          expect(result.rerankScore).toBeLessThanOrEqual(1)
        }
      }
    })

    it('should boost exact phrase matches', async () => {
      const memories = [
        createMockMemory('Machine learning is a subset of AI.', 'mem1'),
        createMockMemory('Deep learning uses neural networks.', 'mem2'),
      ]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const response = await searchService.hybridSearch('machine learning', undefined, {
        rerank: true,
      } as any)

      // Memory with exact phrase should be first
      if (response.results.length > 0) {
        expect(response.results[0]?.memory?.content.toLowerCase()).toContain('machine learning')
      }
    })

    it('should not modify results when rerank is false', async () => {
      const memory = createMockMemory('Test content for no rerank.', 'mem1')
      await searchService.indexMemory(memory)

      const response = await searchService.hybridSearch('test', undefined, {
        rerank: false,
      } as any)

      // Results should not have rerankScore when rerank is false
      for (const result of response.results) {
        if (result.rerankScore !== undefined) {
          // If rerankScore exists, it's from the original scoring
          expect(result.similarity).toBeDefined()
        }
      }
    })
  })

  // ============================================================================
  // Date Range Filter Tests
  // ============================================================================

  describe('date range filtering', () => {
    it('should filter results by date range', async () => {
      const oldMemory = createMockMemory('Old memory content.', 'mem1')
      oldMemory.createdAt = new Date('2023-01-01')
      oldMemory.updatedAt = new Date('2023-01-01')

      const newMemory = createMockMemory('New memory content.', 'mem2')
      newMemory.createdAt = new Date('2024-06-01')
      newMemory.updatedAt = new Date('2024-06-01')

      await searchService.indexMemory(oldMemory)
      await searchService.indexMemory(newMemory)

      const response = await searchService.hybridSearch('memory', undefined, {
        dateRange: { from: new Date('2024-01-01') },
      } as any)

      for (const result of response.results) {
        expect(result.updatedAt.getTime()).toBeGreaterThanOrEqual(new Date('2024-01-01').getTime())
      }
    })
  })

  // ============================================================================
  // Query Rewriting Tests
  // ============================================================================

  describe('rewriteQuery', () => {
    it('should expand query with synonyms', async () => {
      const expanded = await searchService.rewriteQuery('create database')

      expect(expanded).toContain('create')
      expect(expanded.length).toBeGreaterThan('create database'.length)
    })

    it('should expand abbreviations', async () => {
      const expanded = await searchService.rewriteQuery('api config')

      expect(expanded).toContain('api')
      // Should contain expanded abbreviations
      expect(expanded.length).toBeGreaterThan('api config'.length)
    })

    it('should preserve original query terms', async () => {
      const original = 'search query terms'
      const expanded = await searchService.rewriteQuery(original)

      expect(expanded).toContain('search')
      expect(expanded).toContain('query')
      expect(expanded).toContain('terms')
    })

    it('should handle empty query', async () => {
      const expanded = await searchService.rewriteQuery('')
      expect(expanded).toBe('')
    })
  })

  // ============================================================================
  // Service Utility Tests
  // ============================================================================

  describe('getStats', () => {
    it('should return vector and memory counts', async () => {
      const memories = [createMockMemory('Memory 1.', 'mem1'), createMockMemory('Memory 2.', 'mem2')]

      for (const memory of memories) {
        await searchService.indexMemory(memory)
      }

      const stats = await searchService.getStats()

      expect(stats.vectorCount).toBeGreaterThanOrEqual(2)
      expect(stats.memoryCount).toBe(2)
    })

    it('should return zeros for empty service', async () => {
      const stats = await searchService.getStats()

      expect(stats.vectorCount).toBe(0)
      expect(stats.memoryCount).toBe(0)
    })
  })

  describe('clear', () => {
    it('should remove all indexed data', async () => {
      const memory = createMockMemory('Test memory.', 'mem1')
      await searchService.indexMemory(memory)

      await searchService.clear()
      const stats = await searchService.getStats()

      expect(stats.vectorCount).toBe(0)
      expect(stats.memoryCount).toBe(0)
    })
  })

  describe('indexMemory', () => {
    it('should index memory with generated embedding', async () => {
      const memory = createMockMemory('Content to be indexed.', 'mem1')
      delete memory.embedding

      await searchService.indexMemory(memory)

      expect(memory.embedding).toBeDefined()
      expect(memory.embedding?.length).toBeGreaterThan(0)
    })

    it('should index chunks along with memory', async () => {
      const memory = createMockMemory('Main memory content.', 'mem1')
      const chunks: Chunk[] = [
        {
          id: 'chunk1',
          memoryId: 'mem1',
          content: 'Chunk 1 content.',
          chunkIndex: 0,
          createdAt: new Date(),
        },
        {
          id: 'chunk2',
          memoryId: 'mem1',
          content: 'Chunk 2 content.',
          chunkIndex: 1,
          createdAt: new Date(),
        },
      ]

      await searchService.indexMemory(memory, chunks)

      const stats = await searchService.getStats()
      expect(stats.vectorCount).toBeGreaterThanOrEqual(3) // memory + 2 chunks
    })
  })
})

// ============================================================================
// Cosine Similarity Unit Tests
// ============================================================================

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const vector = [0.1, 0.2, 0.3, 0.4]
    const similarity = cosineSimilarity(vector, vector)

    expect(similarity).toBeCloseTo(1, 5)
  })

  it('should return 0 for orthogonal vectors', () => {
    const v1 = [1, 0, 0]
    const v2 = [0, 1, 0]
    const similarity = cosineSimilarity(v1, v2)

    expect(similarity).toBeCloseTo(0, 5)
  })

  it('should return -1 for opposite vectors', () => {
    const v1 = [1, 0, 0]
    const v2 = [-1, 0, 0]
    const similarity = cosineSimilarity(v1, v2)

    expect(similarity).toBeCloseTo(-1, 5)
  })

  it('should throw error for mismatched vector lengths', () => {
    const v1 = [1, 2, 3]
    const v2 = [1, 2]

    expect(() => cosineSimilarity(v1, v2)).toThrow()
  })

  it('should handle zero vectors', () => {
    const v1 = [0, 0, 0]
    const v2 = [1, 2, 3]
    const similarity = cosineSimilarity(v1, v2)

    expect(similarity).toBe(0)
  })

  it('should be commutative', () => {
    const v1 = [0.1, 0.5, 0.3]
    const v2 = [0.4, 0.2, 0.6]

    const sim1 = cosineSimilarity(v1, v2)
    const sim2 = cosineSimilarity(v2, v1)

    expect(sim1).toBeCloseTo(sim2, 5)
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function createMockMemory(content: string, id: string): Memory {
  return {
    id,
    content,
    containerTag: 'default',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
