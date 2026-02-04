/**
 * Memory Repository Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMemoryRepository,
  resetMemoryRepository,
} from '../../src/services/memory.repository';
import type { Memory } from '../../src/services/memory.types';
import { ValidationError } from '../../src/utils/errors';
import { randomUUID } from 'node:crypto';

describe('MemoryRepository', () => {
  let repository: ReturnType<typeof createMemoryRepository>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMemoryRepository();
    repository = createMemoryRepository();
  });

  afterEach(() => {
    resetMemoryRepository();
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('should reject empty containerTag on create', async () => {
    const memory = createMockMemory('Test content', randomUUID(), { containerTag: '' });

    await expect(repository.create(memory)).rejects.toBeInstanceOf(ValidationError);
  });

  it('should reject whitespace-only containerTag on create', async () => {
    const memory = createMockMemory('Test content', randomUUID(), { containerTag: '   ' });

    await expect(repository.create(memory)).rejects.toBeInstanceOf(ValidationError);
  });

  it('should allow valid containerTag on create', async () => {
    const memory = createMockMemory('Test content', randomUUID(), { containerTag: 'project-a' });

    await expect(repository.create(memory)).resolves.toBe(memory);
  });

  it('should reject empty containerTag on update', async () => {
    const memory = createMockMemory('Test content', randomUUID(), { containerTag: 'project-a' });
    await repository.create(memory);

    await expect(repository.update(memory.id, { containerTag: '' })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  describe('semanticSearch', () => {
    it('should ignore similarityThreshold when embeddings are disabled', async () => {
      process.env.MEMORY_ENABLE_EMBEDDINGS = 'false';

      const older = createMockMemory('alpha content', randomUUID(), {
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      });
      const newer = createMockMemory('alpha content newer', randomUUID(), {
        createdAt: new Date('2025-02-01'),
        updatedAt: new Date('2025-02-01'),
      });

      await repository.create(older);
      await repository.create(newer);

      const results = await repository.semanticSearch({
        query: 'alpha',
        similarityThreshold: 0.99,
      });

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe(newer.id);
      expect(results[1]?.id).toBe(older.id);
    });

    it('should enforce similarityThreshold when embeddings are enabled', async () => {
      process.env.MEMORY_ENABLE_EMBEDDINGS = 'true';
      vi.resetModules();

      vi.doMock('../../src/services/embedding.service', async (importOriginal) => {
        const actual = await importOriginal<typeof import('../../src/services/embedding.service')>();
        return {
          ...actual,
          getEmbeddingService: () => ({
            generateEmbedding: vi.fn(async (text: string) => {
              if (text.includes('alpha')) return [1, 0];
              if (text.includes('beta')) return [0, 1];
              return [0, 0];
            }),
            batchEmbed: vi.fn(async (texts: string[]) =>
              texts.map((text) => (text.includes('alpha') ? [1, 0] : [0, 1]))
            ),
          }),
        };
      });

      const {
        createMemoryRepository: createRepo,
        resetMemoryRepository: resetRepo,
      } = await import('../../src/services/memory.repository');

      resetRepo();
      const repo = createRepo();

      const older = createMockMemory('alpha content', randomUUID(), {
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      });
      const newer = createMockMemory('alpha content newer', randomUUID(), {
        createdAt: new Date('2025-02-01'),
        updatedAt: new Date('2025-02-01'),
      });
      const other = createMockMemory('beta content', randomUUID(), {
        createdAt: new Date('2025-03-01'),
        updatedAt: new Date('2025-03-01'),
      });

      await repo.create(older);
      await repo.create(newer);
      await repo.create(other);

      const results = await repo.semanticSearch({
        query: 'alpha query',
        similarityThreshold: 0.5,
      });

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe(newer.id);
      expect(results[1]?.id).toBe(older.id);
    });
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
