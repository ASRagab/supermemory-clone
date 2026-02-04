/**
 * Vector Store Tests
 *
 * Comprehensive tests for vector store implementations including:
 * - InMemoryVectorStore
 * - Factory functions
 * - Migration utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemoryVectorStore,
  createVectorStore,
  createInMemoryVectorStore,
  migrateVectorStore,
  getAvailableProviders,
  getBestProvider,
  getDefaultVectorStoreConfig,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeVector,
  validateVector,
  type VectorEntry,
  type VectorStoreConfig,
} from '../../src/services/vectorstore/index.js';

// Test constants
const TEST_DIMENSIONS = 4;
const TEST_DB_PATH = './data/test-vectors.db';

/**
 * Create a test vector entry
 */
function createTestEntry(
  id: string,
  embedding?: number[],
  metadata?: Record<string, unknown>
): VectorEntry {
  return {
    id,
    embedding: embedding ?? [0.1, 0.2, 0.3, 0.4],
    metadata: metadata ?? { type: 'test' },
  };
}

/**
 * Create normalized random embedding
 */
function createRandomEmbedding(dimensions: number = TEST_DIMENSIONS): number[] {
  const embedding = Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
  return normalizeVector(embedding);
}

// ============================================================================
// Math Utility Tests
// ============================================================================

describe('Vector Math Utilities', () => {
  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vec = [0.5, 0.5, 0.5, 0.5];
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vec1 = [1, 0, 0, 0];
      const vec2 = [0, 1, 0, 0];
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const vec1 = [1, 0, 0, 0];
      const vec2 = [-1, 0, 0, 0];
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1, 5);
    });

    it('should throw for dimension mismatch', () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
    });
  });

  describe('euclideanDistance', () => {
    it('should return 0 for identical vectors', () => {
      const vec = [0.5, 0.5, 0.5, 0.5];
      expect(euclideanDistance(vec, vec)).toBe(0);
    });

    it('should calculate correct distance', () => {
      const vec1 = [0, 0, 0, 0];
      const vec2 = [1, 0, 0, 0];
      expect(euclideanDistance(vec1, vec2)).toBe(1);
    });

    it('should throw for dimension mismatch', () => {
      expect(() => euclideanDistance([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
    });
  });

  describe('dotProduct', () => {
    it('should calculate correct dot product', () => {
      const vec1 = [1, 2, 3, 4];
      const vec2 = [5, 6, 7, 8];
      // 1*5 + 2*6 + 3*7 + 4*8 = 5 + 12 + 21 + 32 = 70
      expect(dotProduct(vec1, vec2)).toBe(70);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vec1 = [1, 0];
      const vec2 = [0, 1];
      expect(dotProduct(vec1, vec2)).toBe(0);
    });
  });

  describe('normalizeVector', () => {
    it('should produce unit length vector', () => {
      const vec = [3, 4];
      const normalized = normalizeVector(vec);
      const length = Math.sqrt(normalized[0]! ** 2 + normalized[1]! ** 2);
      expect(length).toBeCloseTo(1, 5);
    });

    it('should preserve zero vector', () => {
      const vec = [0, 0, 0, 0];
      expect(normalizeVector(vec)).toEqual(vec);
    });
  });

  describe('validateVector', () => {
    it('should accept valid vector', () => {
      expect(() => validateVector([1, 2, 3, 4], 4)).not.toThrow();
    });

    it('should reject wrong dimensions', () => {
      expect(() => validateVector([1, 2, 3], 4)).toThrow('dimension mismatch');
    });

    it('should reject non-array', () => {
      expect(() => validateVector('not an array' as any, 4)).toThrow('must be an array');
    });

    it('should reject NaN values', () => {
      expect(() => validateVector([1, NaN, 3, 4], 4)).toThrow('valid numbers');
    });
  });
});

// ============================================================================
// InMemoryVectorStore Tests
// ============================================================================

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(async () => {
    store = createInMemoryVectorStore(TEST_DIMENSIONS);
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  describe('CRUD operations', () => {
    it('should add and retrieve entry', async () => {
      const entry = createTestEntry('test-1');
      await store.add(entry);

      const retrieved = await store.get('test-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('test-1');
      expect(retrieved!.embedding).toEqual(entry.embedding);
    });

    it('should check existence', async () => {
      const entry = createTestEntry('test-1');
      await store.add(entry);

      expect(await store.exists('test-1')).toBe(true);
      expect(await store.exists('nonexistent')).toBe(false);
    });

    it('should throw on duplicate without overwrite', async () => {
      const entry = createTestEntry('test-1');
      await store.add(entry);

      await expect(store.add(entry)).rejects.toThrow('already exists');
    });

    it('should allow overwrite with option', async () => {
      const entry1 = createTestEntry('test-1', [0.1, 0.2, 0.3, 0.4]);
      const entry2 = createTestEntry('test-1', [0.5, 0.6, 0.7, 0.8]);

      await store.add(entry1);
      await store.add(entry2, { overwrite: true });

      const retrieved = await store.get('test-1');
      expect(retrieved!.embedding).toEqual([0.5, 0.6, 0.7, 0.8]);
    });

    it('should update entry', async () => {
      const entry = createTestEntry('test-1');
      await store.add(entry);

      const updated = await store.update('test-1', { metadata: { updated: true } });
      expect(updated).toBe(true);

      const retrieved = await store.get('test-1');
      expect(retrieved!.metadata.updated).toBe(true);
    });

    it('should return false for update on nonexistent', async () => {
      const updated = await store.update('nonexistent', { metadata: { test: true } });
      expect(updated).toBe(false);
    });

    it('should delete by ID', async () => {
      await store.add(createTestEntry('test-1'));
      await store.add(createTestEntry('test-2'));

      const deleted = await store.delete({ ids: ['test-1'] });
      expect(deleted).toBe(1);

      expect(await store.exists('test-1')).toBe(false);
      expect(await store.exists('test-2')).toBe(true);
    });

    it('should batch add entries', async () => {
      const entries = [
        createTestEntry('test-1'),
        createTestEntry('test-2'),
        createTestEntry('test-3'),
      ];

      const result = await store.addBatch(entries);
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);

      const stats = await store.getStats();
      expect(stats.totalVectors).toBe(3);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Add some test vectors
      const entries = [
        createTestEntry('similar-1', normalizeVector([0.9, 0.1, 0.0, 0.0])),
        createTestEntry('similar-2', normalizeVector([0.8, 0.2, 0.0, 0.0])),
        createTestEntry('different', normalizeVector([0.0, 0.0, 0.9, 0.1])),
      ];

      for (const entry of entries) {
        await store.add(entry);
      }
    });

    it('should find similar vectors', async () => {
      const query = normalizeVector([1.0, 0.0, 0.0, 0.0]);
      const results = await store.search(query, { limit: 10, threshold: 0 });

      expect(results.length).toBe(3);
      expect(results[0]!.id).toBe('similar-1');
      expect(results[1]!.id).toBe('similar-2');
    });

    it('should respect limit', async () => {
      const query = normalizeVector([1.0, 0.0, 0.0, 0.0]);
      const results = await store.search(query, { limit: 1, threshold: 0 });

      expect(results.length).toBe(1);
    });

    it('should respect threshold', async () => {
      const query = normalizeVector([1.0, 0.0, 0.0, 0.0]);
      const results = await store.search(query, { limit: 10, threshold: 0.95 });

      // High threshold should filter out most results
      // All results should have score >= threshold
      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0.95);
      }
    });

    it('should filter by metadata', async () => {
      await store.add(
        createTestEntry('tagged', normalizeVector([0.9, 0.1, 0.0, 0.0]), { tag: 'special' })
      );

      const query = normalizeVector([1.0, 0.0, 0.0, 0.0]);
      const results = await store.search(query, {
        limit: 10,
        threshold: 0,
        filters: [{ key: 'tag', operator: 'eq', value: 'special' }],
      });

      expect(results.every((r) => r.metadata.tag === 'special')).toBe(true);
    });
  });

  describe('statistics', () => {
    it('should report correct stats', async () => {
      await store.addBatch([createTestEntry('test-1'), createTestEntry('test-2')]);

      const stats = await store.getStats();
      expect(stats.totalVectors).toBe(2);
      expect(stats.dimensions).toBe(TEST_DIMENSIONS);
      expect(stats.indexType).toBe('flat');
      expect(stats.metric).toBe('cosine');
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      await store.addBatch([createTestEntry('test-1'), createTestEntry('test-2')]);

      await store.clear();

      const stats = await store.getStats();
      expect(stats.totalVectors).toBe(0);
    });
  });
});

// ============================================================================
// SQLiteVSSStore Tests
// ============================================================================

describe.skip('SQLiteVSSStore (REMOVED - unused implementation)', () => {
  let store: SQLiteVSSStore;

  beforeEach(async () => {
    // Clean up test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }

    store = createSQLiteVSSStore(TEST_DIMENSIONS, TEST_DB_PATH);
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    // Clean up test database
    if (existsSync(TEST_DB_PATH)) {
      try {
        unlinkSync(TEST_DB_PATH);
      } catch {
        // Ignore cleanup errors
      }
    }
    // Clean up WAL files
    try {
      if (existsSync(TEST_DB_PATH + '-wal')) unlinkSync(TEST_DB_PATH + '-wal');
      if (existsSync(TEST_DB_PATH + '-shm')) unlinkSync(TEST_DB_PATH + '-shm');
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('CRUD operations', () => {
    it('should add and retrieve entry', async () => {
      const entry = createTestEntry('test-1');
      await store.add(entry);

      const retrieved = await store.get('test-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('test-1');
      // Compare with tolerance for float serialization
      for (let i = 0; i < entry.embedding.length; i++) {
        expect(retrieved!.embedding[i]).toBeCloseTo(entry.embedding[i]!, 5);
      }
    });

    it('should persist data across instances', async () => {
      const entry = createTestEntry('test-1');
      await store.add(entry);
      await store.close();

      // Create new instance
      const store2 = createSQLiteVSSStore(TEST_DIMENSIONS, TEST_DB_PATH);
      await store2.initialize();

      const retrieved = await store2.get('test-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('test-1');

      await store2.close();
    });

    it('should batch add with transaction', async () => {
      const entries = Array.from({ length: 100 }, (_, i) =>
        createTestEntry(`test-${i}`, createRandomEmbedding())
      );

      const result = await store.addBatch(entries);
      expect(result.successful).toBe(100);
      expect(result.failed).toBe(0);

      const stats = await store.getStats();
      expect(stats.totalVectors).toBe(100);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      const entries = [
        createTestEntry('similar-1', normalizeVector([0.9, 0.1, 0.0, 0.0])),
        createTestEntry('similar-2', normalizeVector([0.8, 0.2, 0.0, 0.0])),
        createTestEntry('different', normalizeVector([0.0, 0.0, 0.9, 0.1])),
      ];

      for (const entry of entries) {
        await store.add(entry);
      }
    });

    it('should find similar vectors', async () => {
      const query = normalizeVector([1.0, 0.0, 0.0, 0.0]);
      const results = await store.search(query, { limit: 10, threshold: 0 });

      expect(results.length).toBe(3);
      // Results should be sorted by similarity
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
    });

    it('should filter by metadata', async () => {
      await store.add(
        createTestEntry('tagged', normalizeVector([0.9, 0.1, 0.0, 0.0]), { category: 'special' })
      );

      const query = normalizeVector([1.0, 0.0, 0.0, 0.0]);
      const results = await store.search(query, {
        limit: 10,
        threshold: 0,
        filters: [{ key: 'category', operator: 'eq', value: 'special' }],
      });

      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe('tagged');
    });
  });

  describe('index management', () => {
    it('should rebuild indexes', async () => {
      await store.addBatch([createTestEntry('test-1'), createTestEntry('test-2')]);

      // Should not throw
      await store.rebuildIndexes();
    });

    it('should vacuum database', async () => {
      await store.addBatch([createTestEntry('test-1'), createTestEntry('test-2')]);
      await store.delete({ ids: ['test-1'] });

      // Should not throw
      await store.vacuum();
    });
  });
});

// ============================================================================
// Factory Tests
// ============================================================================

describe('VectorStore Factory', () => {
  describe('createVectorStore', () => {
    it('should create in-memory store', async () => {
      const store = await createVectorStore({
        provider: 'memory',
        dimensions: TEST_DIMENSIONS,
      });
      await store.initialize();

      expect(store).toBeInstanceOf(InMemoryVectorStore);
      await store.close();
    });

    it('should throw for unknown provider', async () => {
      await expect(
        createVectorStore({
          provider: 'unknown' as any,
          dimensions: TEST_DIMENSIONS,
        })
      ).rejects.toThrow('Unknown');
    });
  });

  describe('getAvailableProviders', () => {
    it('should return provider availability', async () => {
      const providers = await getAvailableProviders();

      expect(providers.memory).toBe(true);
      expect(typeof providers.pgvector).toBe('boolean');
    });
  });

  describe('getBestProvider', () => {
    it('should return a valid provider', async () => {
      const provider = await getBestProvider();

      expect(['memory', 'pgvector']).toContain(provider);
    });
  });

  describe('getDefaultVectorStoreConfig', () => {
    it('should return valid config', () => {
      const config = getDefaultVectorStoreConfig();

      expect(config.provider).toBeDefined();
      expect(config.dimensions).toBe(1536);
      expect(config.metric).toBe('cosine');
    });
  });
});

// ============================================================================
// Migration Tests
// ============================================================================

describe('Vector Store Migration', () => {
  it('should migrate between stores', async () => {
    // Create source store with data
    const source = createInMemoryVectorStore(TEST_DIMENSIONS);
    await source.initialize();
    await source.addBatch([
      createTestEntry('test-1', createRandomEmbedding()),
      createTestEntry('test-2', createRandomEmbedding()),
      createTestEntry('test-3', createRandomEmbedding()),
    ]);

    // Create target store
    const target = createInMemoryVectorStore(TEST_DIMENSIONS);
    await target.initialize();

    // Migrate
    const progress = await migrateVectorStore(source, target, {
      batchSize: 2,
    });

    expect(progress.total).toBe(3);
    expect(progress.migrated).toBe(3);
    expect(progress.percentage).toBe(100);

    // Verify target has all entries
    const targetStats = await target.getStats();
    expect(targetStats.totalVectors).toBe(3);

    await source.close();
    await target.close();
  });

  it('should call progress callback', async () => {
    const source = createInMemoryVectorStore(TEST_DIMENSIONS);
    await source.initialize();
    await source.addBatch([
      createTestEntry('test-1', createRandomEmbedding()),
      createTestEntry('test-2', createRandomEmbedding()),
      createTestEntry('test-3', createRandomEmbedding()),
    ]);

    const target = createInMemoryVectorStore(TEST_DIMENSIONS);
    await target.initialize();

    const progressUpdates: number[] = [];
    await migrateVectorStore(source, target, {
      batchSize: 1,
      onProgress: (progress) => progressUpdates.push(progress.percentage),
    });

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);

    await source.close();
    await target.close();
  });
});
