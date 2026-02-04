/**
 * Tests for EnhancedMemoryService feature-flag defaults
 */

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryService } from '../../../src/services/memory.service';
import { createMemoryRepository, resetMemoryRepository } from '../../../src/services/memory.repository';
import type { Memory } from '../../../src/services/memory.types';
import { randomUUID } from 'node:crypto';

describe('EnhancedMemoryService feature flags', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMemoryRepository();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    resetMemoryRepository();
  });

  it('should disable embedding detection by default', async () => {
    delete process.env.MEMORY_ENABLE_EMBEDDINGS;
    vi.resetModules();

    const { DEFAULT_ENHANCED_CONFIG } = await import(
      '../../../src/services/relationships/memory-integration.js'
    );

    expect(DEFAULT_ENHANCED_CONFIG.useEmbeddingDetection).toBe(false);
    expect(DEFAULT_ENHANCED_CONFIG.autoIndexMemories).toBe(false);
  });

  it('should enable embedding detection when flag is on', async () => {
    process.env.MEMORY_ENABLE_EMBEDDINGS = 'true';
    vi.resetModules();

    const { DEFAULT_ENHANCED_CONFIG } = await import(
      '../../../src/services/relationships/memory-integration.js'
    );

    expect(DEFAULT_ENHANCED_CONFIG.useEmbeddingDetection).toBe(true);
    expect(DEFAULT_ENHANCED_CONFIG.autoIndexMemories).toBe(true);
  });

  it('should not supersede across container tags', async () => {
    process.env.MEMORY_ENABLE_EMBEDDINGS = 'true';
    vi.resetModules();

    const repository = createMemoryRepository();
    const baseService = createMemoryService({}, repository);

    const existing = createMockMemory('Existing memory', randomUUID(), {
      containerTag: 'container-b',
    });
    await repository.create(existing);

    const mockDetector = {
      detectRelationships: vi.fn(async () => ({
        sourceMemory: existing,
        relationships: [
          {
            relationship: {
              id: 'rel-1',
              sourceMemoryId: 'new',
              targetMemoryId: existing.id,
              type: 'updates',
              confidence: 0.9,
              createdAt: new Date(),
            },
            score: 0.9,
            vectorSimilarity: 0.9,
            entityOverlap: 0,
            temporalScore: 0,
            llmVerified: false,
            detectionStrategy: 'similarity',
          },
        ],
        supersededMemoryIds: [existing.id],
        contradictions: [],
        stats: {
          candidatesEvaluated: 1,
          relationshipsDetected: 1,
          byType: {
            updates: 1,
            extends: 0,
            derives: 0,
            contradicts: 0,
            related: 0,
            supersedes: 0,
          },
          llmVerifications: 0,
          processingTimeMs: 1,
          fromCache: false,
        },
      })),
    };

    vi.doMock('../../../src/services/relationships/detector.js', () => ({
      InMemoryVectorStoreAdapter: class {
        addMemory() {}
        addMemories() {}
        removeMemory() {
          return true;
        }
        updateEmbedding() {
          return true;
        }
        getAllMemories() {
          return [];
        }
        clear() {}
      },
      EmbeddingRelationshipDetector: class {},
      createEmbeddingRelationshipDetector: () => mockDetector,
    }));

    const { createEnhancedMemoryService } = await import(
      '../../../src/services/relationships/memory-integration.js'
    );

    const embeddingService = {
      generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
      batchEmbed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
    };

    const service = createEnhancedMemoryService(
      { useEmbeddingDetection: true, autoIndexMemories: false },
      {
        baseService,
        repository,
        embeddingService,
      }
    );

    const spy = vi.spyOn(repository, 'markSuperseded');

    await service.processAndStoreMemoriesEnhanced('New memory sentence.', {
      containerTag: 'container-a',
      detectRelationships: true,
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('should supersede within the same container tag', async () => {
    process.env.MEMORY_ENABLE_EMBEDDINGS = 'true';
    vi.resetModules();

    const repository = createMemoryRepository();
    const baseService = createMemoryService({}, repository);

    const existing = createMockMemory('Existing memory', randomUUID(), {
      containerTag: 'container-a',
    });
    await repository.create(existing);

    const mockDetector = {
      detectRelationships: vi.fn(async () => ({
        sourceMemory: existing,
        relationships: [
          {
            relationship: {
              id: 'rel-1',
              sourceMemoryId: 'new',
              targetMemoryId: existing.id,
              type: 'updates',
              confidence: 0.9,
              createdAt: new Date(),
            },
            score: 0.9,
            vectorSimilarity: 0.9,
            entityOverlap: 0,
            temporalScore: 0,
            llmVerified: false,
            detectionStrategy: 'similarity',
          },
        ],
        supersededMemoryIds: [existing.id],
        contradictions: [],
        stats: {
          candidatesEvaluated: 1,
          relationshipsDetected: 1,
          byType: {
            updates: 1,
            extends: 0,
            derives: 0,
            contradicts: 0,
            related: 0,
            supersedes: 0,
          },
          llmVerifications: 0,
          processingTimeMs: 1,
          fromCache: false,
        },
      })),
    };

    vi.doMock('../../../src/services/relationships/detector.js', () => ({
      InMemoryVectorStoreAdapter: class {
        addMemory() {}
        addMemories() {}
        removeMemory() {
          return true;
        }
        updateEmbedding() {
          return true;
        }
        getAllMemories() {
          return [];
        }
        clear() {}
      },
      EmbeddingRelationshipDetector: class {},
      createEmbeddingRelationshipDetector: () => mockDetector,
    }));

    const { createEnhancedMemoryService } = await import(
      '../../../src/services/relationships/memory-integration.js'
    );

    const embeddingService = {
      generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
      batchEmbed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
    };

    const service = createEnhancedMemoryService(
      { useEmbeddingDetection: true, autoIndexMemories: false },
      {
        baseService,
        repository,
        embeddingService,
      }
    );

    const spy = vi.spyOn(repository, 'markSuperseded');

    await service.processAndStoreMemoriesEnhanced('New memory sentence.', {
      containerTag: 'container-a',
      detectRelationships: true,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(existing.id, expect.any(String));
  });
});

function createMockMemory(
  content: string,
  id: string,
  overrides: Partial<Memory> = {}
): Memory {
  return {
    id,
    content,
    type: 'fact',
    relationships: [],
    isLatest: true,
    confidence: 0.8,
    metadata: {
      confidence: 0.8,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
