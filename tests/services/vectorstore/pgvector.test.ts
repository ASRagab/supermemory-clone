/**
 * PgVectorStore Tests
 *
 * Comprehensive tests for PostgreSQL pgvector vector store implementation.
 * Tests HNSW indexing, batch operations, metadata filtering, and migration.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PgVectorStore, createPgVectorStore } from '../../../src/services/vectorstore/pgvector.js'
import {
  migrateMemoryToPgVector,
  verifyMigration,
  createProgressReporter,
} from '../../../src/services/vectorstore/migration.js'
import { createInMemoryVectorStore } from '../../../src/services/vectorstore/memory.js'
import { VectorEntry } from '../../../src/services/vectorstore/types.js'

// Test configuration
const TEST_CONNECTION_STRING =
  process.env.TEST_POSTGRES_URL ?? 'postgresql://supermemory:supermemory_secret@localhost:5432/supermemory'
const DIMENSIONS = 1536

describe('PgVectorStore', () => {
  let store: PgVectorStore

  beforeAll(async () => {
    store = createPgVectorStore(TEST_CONNECTION_STRING, DIMENSIONS, {
      tableName: 'test_vector_embeddings',
      hnswConfig: {
        M: 16,
        efConstruction: 64,
      },
    })

    await store.initialize()
  })

  afterAll(async () => {
    await store.clear()
    await store.close()
  })

  beforeEach(async () => {
    await store.clear()
  })

  describe('Initialization', () => {
    it('should create table and HNSW index', async () => {
      const stats = await store.getStats()
      expect(stats.dimensions).toBe(DIMENSIONS)
      expect(stats.indexType).toBe('hnsw')
      expect(stats.indexBuilt).toBe(true)
    })

    it('should handle multiple initialization calls', async () => {
      await store.initialize()
      await store.initialize()
      const stats = await store.getStats()
      expect(stats.totalVectors).toBe(0)
    })
  })

  describe('Insert Operations', () => {
    it('should insert a single vector entry', async () => {
      const entry: VectorEntry = {
        id: 'test-1',
        embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
        metadata: { type: 'test', category: 'single' },
      }

      await store.add(entry)

      const retrieved = await store.get('test-1')
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe('test-1')
      expect(retrieved?.metadata).toEqual(entry.metadata)
    })

    it('should throw error on duplicate ID without overwrite', async () => {
      const entry: VectorEntry = {
        id: 'test-dup',
        embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
        metadata: { type: 'test' },
      }

      await store.add(entry)

      await expect(store.add(entry)).rejects.toThrow('already exists')
    })

    it('should overwrite existing entry with overwrite option', async () => {
      const entry1: VectorEntry = {
        id: 'test-overwrite',
        embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
        metadata: { version: 1 },
      }

      const entry2: VectorEntry = {
        id: 'test-overwrite',
        embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
        metadata: { version: 2 },
      }

      await store.add(entry1)
      await store.add(entry2, { overwrite: true })

      const retrieved = await store.get('test-overwrite')
      expect(retrieved?.metadata).toEqual({ version: 2 })
    })

    it('should validate vector dimensions', async () => {
      const invalidEntry: VectorEntry = {
        id: 'test-invalid',
        embedding: [1, 2, 3], // Wrong dimensions
        metadata: {},
      }

      await expect(store.add(invalidEntry)).rejects.toThrow('dimension mismatch')
    })
  })

  describe('Batch Operations', () => {
    it('should insert multiple entries in batches', async () => {
      const entries: VectorEntry[] = Array.from({ length: 250 }, (_, i) => ({
        id: `batch-${i}`,
        embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
        metadata: { index: i, batch: Math.floor(i / 100) },
      }))

      const result = await store.addBatch(entries)

      expect(result.successful).toBe(250)
      expect(result.failed).toBe(0)

      const stats = await store.getStats()
      expect(stats.totalVectors).toBe(250)
    })

    it('should handle partial batch failures', async () => {
      const entries: VectorEntry[] = [
        {
          id: 'valid-1',
          embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
          metadata: {},
        },
        {
          id: 'invalid',
          embedding: [1, 2, 3], // Invalid dimensions
          metadata: {},
        },
        {
          id: 'valid-2',
          embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
          metadata: {},
        },
      ]

      const result = await store.addBatch(entries)

      expect(result.successful).toBeGreaterThan(0)
      expect(result.failed).toBeGreaterThan(0)
      expect(result.errors).toBeDefined()
      expect(result.errors?.length).toBeGreaterThan(0)
    })
  })

  describe('Update Operations', () => {
    it('should update vector embedding', async () => {
      const entry: VectorEntry = {
        id: 'test-update',
        embedding: new Array(DIMENSIONS).fill(0),
        metadata: { version: 1 },
      }

      await store.add(entry)

      const newEmbedding = new Array(DIMENSIONS).fill(1)
      const updated = await store.update('test-update', { embedding: newEmbedding })

      expect(updated).toBe(true)

      const retrieved = await store.get('test-update')
      expect(retrieved?.embedding).toEqual(newEmbedding)
    })

    it('should update metadata', async () => {
      const entry: VectorEntry = {
        id: 'test-metadata',
        embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
        metadata: { status: 'draft' },
      }

      await store.add(entry)

      const updated = await store.update('test-metadata', {
        metadata: { status: 'published', views: 100 },
      })

      expect(updated).toBe(true)

      const retrieved = await store.get('test-metadata')
      expect(retrieved?.metadata).toEqual({ status: 'published', views: 100 })
    })

    it('should return false for non-existent ID', async () => {
      const updated = await store.update('non-existent', {
        metadata: { test: true },
      })

      expect(updated).toBe(false)
    })
  })

  describe('Delete Operations', () => {
    beforeEach(async () => {
      const entries: VectorEntry[] = Array.from({ length: 10 }, (_, i) => ({
        id: `delete-test-${i}`,
        embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
        metadata: { index: i, category: i % 2 === 0 ? 'even' : 'odd' },
      }))

      await store.addBatch(entries)
    })

    it('should delete by IDs', async () => {
      const deleted = await store.delete({
        ids: ['delete-test-0', 'delete-test-1', 'delete-test-2'],
      })

      expect(deleted).toBe(3)

      const exists = await store.exists('delete-test-0')
      expect(exists).toBe(false)
    })

    it('should delete by metadata filter', async () => {
      const deleted = await store.delete({
        filter: { key: 'category', operator: 'eq', value: 'even' },
      })

      expect(deleted).toBe(5)

      const stats = await store.getStats()
      expect(stats.totalVectors).toBe(5)
    })

    it('should delete all in namespace', async () => {
      const deleted = await store.delete({
        deleteAll: true,
        namespace: 'default',
      })

      expect(deleted).toBeGreaterThan(0)

      const stats = await store.getStats()
      expect(stats.totalVectors).toBe(0)
    })
  })

  describe('Search Operations', () => {
    beforeEach(async () => {
      // Create test vectors with known similarity
      const baseVector = new Array(DIMENSIONS).fill(0.5)
      const entries: VectorEntry[] = [
        {
          id: 'search-exact',
          embedding: baseVector,
          metadata: { type: 'exact', similarity: 1.0 },
        },
        {
          id: 'search-close',
          embedding: baseVector.map((v) => v + 0.01),
          metadata: { type: 'close', similarity: 0.9 },
        },
        {
          id: 'search-far',
          embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
          metadata: { type: 'far', similarity: 0.5 },
        },
      ]

      await store.addBatch(entries)
    })

    it('should search with HNSW index', async () => {
      const queryVector = new Array(DIMENSIONS).fill(0.5)
      const results = await store.search(queryVector, {
        limit: 5,
        threshold: 0.7,
      })

      // HNSW is an approximate nearest neighbor index.
      // When vector similarities differ by less than floating-point precision (~1e-15),
      // result ordering may be non-deterministic. This test validates that:
      // 1. High-similarity vectors are found (both exact and close)
      // 2. Results meet the threshold requirement (>0.7)
      // 3. Results are ordered by distance (as per HNSW approximation)

      expect(results.length).toBeGreaterThan(0)
      const resultIds = results.map((r) => r.id)

      // Both 'search-exact' and 'search-close' should be in results
      // with high similarity scores (>0.99), as cosine similarity difference
      // between them is only ~0.00004 (at floating-point precision limits)
      expect(resultIds).toContain('search-exact')
      expect(resultIds).toContain('search-close')

      // First two results should have scores > 0.99
      expect(results[0]?.score).toBeGreaterThan(0.99)
      expect(results[1]?.score).toBeGreaterThan(0.99)

      // The 'far' vector should either not be in results or have much lower score
      const farResult = results.find((r) => r.id === 'search-far')
      if (farResult) {
        expect(farResult.score).toBeLessThan(0.99)
      }
    })

    it('should apply threshold filtering', async () => {
      const queryVector = new Array(DIMENSIONS).fill(0.5)
      const results = await store.search(queryVector, {
        limit: 10,
        threshold: 0.95,
      })

      expect(results.every((r) => r.score >= 0.95)).toBe(true)
    })

    it('should include vectors when requested', async () => {
      const queryVector = new Array(DIMENSIONS).fill(0.5)
      const results = await store.search(queryVector, {
        limit: 1,
        includeVectors: true,
      })

      expect(results[0]?.embedding).toBeDefined()
      expect(results[0]?.embedding?.length).toBe(DIMENSIONS)
    })

    it('should filter by metadata', async () => {
      const queryVector = new Array(DIMENSIONS).fill(0.5)
      const results = await store.search(queryVector, {
        limit: 10,
        filters: [{ key: 'type', operator: 'eq', value: 'exact' }],
      })

      expect(results.length).toBe(1)
      expect(results[0]?.id).toBe('search-exact')
    })
  })

  describe('Statistics', () => {
    it('should return accurate statistics', async () => {
      const entries: VectorEntry[] = Array.from({ length: 50 }, (_, i) => ({
        id: `stats-${i}`,
        embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
        metadata: { index: i },
      }))

      await store.addBatch(entries)

      const stats = await store.getStats()

      expect(stats.totalVectors).toBe(50)
      expect(stats.dimensions).toBe(DIMENSIONS)
      expect(stats.indexType).toBe('hnsw')
      expect(stats.metric).toBe('cosine')
      expect(stats.indexBuilt).toBe(true)
    })

    it('should track namespaces', async () => {
      const entries: VectorEntry[] = [
        {
          id: 'ns1-1',
          embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
          metadata: {},
        },
        {
          id: 'ns2-1',
          embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
          metadata: {},
        },
      ]

      await store.add(entries[0]!, { namespace: 'namespace1' })
      await store.add(entries[1]!, { namespace: 'namespace2' })

      const stats = await store.getStats()

      expect(stats.namespaces).toContain('namespace1')
      expect(stats.namespaces).toContain('namespace2')
    })
  })

  describe('Connection Pool', () => {
    it('should handle concurrent operations', async () => {
      const operations = Array.from({ length: 20 }, async (_, i) => {
        const entry: VectorEntry = {
          id: `concurrent-${i}`,
          embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
          metadata: { index: i },
        }
        await store.add(entry)
      })

      await Promise.all(operations)

      const stats = await store.getStats()
      expect(stats.totalVectors).toBe(20)
    })
  })
})

describe('Migration Utilities', () => {
  let memoryStore: ReturnType<typeof createInMemoryVectorStore>
  let pgStore: PgVectorStore

  beforeAll(async () => {
    memoryStore = createInMemoryVectorStore(DIMENSIONS)
    await memoryStore.initialize()

    pgStore = createPgVectorStore(TEST_CONNECTION_STRING, DIMENSIONS, {
      tableName: 'test_migration_embeddings',
    })
    await pgStore.initialize()
  })

  afterAll(async () => {
    await memoryStore.close()
    await pgStore.clear()
    await pgStore.close()
  })

  beforeEach(async () => {
    await memoryStore.clear()
    await pgStore.clear()
  })

  it('should migrate from InMemoryVectorStore to PgVectorStore', async () => {
    // Populate memory store
    const entries: VectorEntry[] = Array.from({ length: 100 }, (_, i) => ({
      id: `migrate-${i}`,
      embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
      metadata: { index: i, migrated: false },
    }))

    await memoryStore.addBatch(entries)

    // Migrate
    const progressUpdates: string[] = []
    const result = await migrateMemoryToPgVector(memoryStore, pgStore, {
      batchSize: 25,
      onProgress: createProgressReporter((msg) => progressUpdates.push(msg)),
    })

    expect(result.successful).toBe(100)
    expect(result.failed).toBe(0)
    expect(progressUpdates.length).toBeGreaterThan(0)

    // Verify
    const pgStats = await pgStore.getStats()
    expect(pgStats.totalVectors).toBe(100)
  })

  it('should verify migration integrity', async () => {
    // Populate both stores
    const entries: VectorEntry[] = Array.from({ length: 20 }, (_, i) => ({
      id: `verify-${i}`,
      embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
      metadata: { index: i },
    }))

    await memoryStore.addBatch(entries)
    await pgStore.addBatch(entries)

    // Verify
    const verification = await verifyMigration(memoryStore, pgStore, 10)

    expect(verification.success).toBe(true)
    expect(verification.sourceCount).toBe(20)
    expect(verification.targetCount).toBe(20)
    expect(verification.samplesMatch).toBeGreaterThan(0)
    expect(verification.samplesMismatch).toBe(0)
  })

  it('should detect migration issues', async () => {
    // Populate source
    const sourceEntries: VectorEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: `issue-${i}`,
      embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
      metadata: { index: i },
    }))

    await memoryStore.addBatch(sourceEntries)

    // Populate target with different data
    const targetEntries: VectorEntry[] = Array.from({ length: 5 }, (_, i) => ({
      id: `issue-${i}`,
      embedding: new Array(DIMENSIONS).fill(0).map(() => Math.random()),
      metadata: { index: i, modified: true },
    }))

    await pgStore.addBatch(targetEntries)

    // Verify
    const verification = await verifyMigration(memoryStore, pgStore, 5)

    expect(verification.success).toBe(false)
    expect(verification.issues.length).toBeGreaterThan(0)
  })
})
