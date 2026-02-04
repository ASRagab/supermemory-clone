/**
 * Memory Repository - Database Operations
 *
 * Handles persistence layer for memories and relationships.
 * Uses factory pattern for testability - store is injected rather than module-level.
 */

import {
  Memory,
  Relationship,
  MemoryQueryOptions,
  SemanticSearchOptions,
  RelationshipType,
} from './memory.types.js';
import { getLogger } from '../utils/logger.js';
import { DatabaseError, NotFoundError, ErrorCode } from '../utils/errors.js';
import {
  validate,
  uuidSchema,
  memoryQueryOptionsSchema,
  validateContainerTag,
} from '../utils/validation.js';
import { isEmbeddingRelationshipsEnabled } from '../config/feature-flags.js';
import { getEmbeddingService, cosineSimilarity } from './embedding.service.js';

const logger = getLogger('MemoryRepository');

// ============================================================================
// Memory Store Interface (for dependency injection)
// ============================================================================

/**
 * Memory store interface - implement for different storage backends
 */
export interface MemoryStore {
  memories: Map<string, Memory>;
  relationships: Map<string, Relationship>;
}

/**
 * Factory function to create a new memory store
 * Use this for testing to get isolated stores
 */
export function createMemoryStore(): MemoryStore {
  return {
    memories: new Map(),
    relationships: new Map(),
  };
}

// ============================================================================
// Memory Repository
// ============================================================================

/**
 * Memory Repository class for database operations
 * Accepts a store via constructor for testability
 */
export class MemoryRepository {
  private readonly store: MemoryStore;

  constructor(store?: MemoryStore) {
    this.store = store ?? createMemoryStore();
  }

  /**
   * Get the underlying store (for testing/debugging)
   */
  getStore(): MemoryStore {
    return this.store;
  }

  /**
   * Create a new memory
   */
  async create(memory: Memory): Promise<Memory> {
    if (memory.containerTag !== undefined) {
      validateContainerTag(memory.containerTag);
    }
    try {
      logger.debug('Creating memory', { id: memory.id, type: memory.type });

      if (!memory.id) {
        throw new DatabaseError('Memory ID is required', 'create');
      }

      if (this.store.memories.has(memory.id)) {
        throw new DatabaseError(`Memory with ID ${memory.id} already exists`, 'create', {
          existingId: memory.id,
        });
      }

      this.store.memories.set(memory.id, { ...memory });
      logger.info('Memory created', { id: memory.id });
      return memory;
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      logger.errorWithException('Failed to create memory', error, { memoryId: memory.id });
      throw new DatabaseError('Failed to create memory', 'create', { originalError: error });
    }
  }

  /**
   * Create multiple memories in batch
   */
  async createBatch(memories: Memory[]): Promise<Memory[]> {
    for (const memory of memories) {
      if (memory.containerTag !== undefined) {
        validateContainerTag(memory.containerTag);
      }
    }
    try {
      logger.debug('Creating memories batch', { count: memories.length });

      const created: Memory[] = [];
      for (const memory of memories) {
        this.store.memories.set(memory.id, { ...memory });
        created.push(memory);
      }

      logger.info('Memories batch created', { count: created.length });
      return created;
    } catch (error) {
      logger.errorWithException('Failed to create memories batch', error);
      throw new DatabaseError('Failed to create memories batch', 'createBatch', {
        originalError: error,
      });
    }
  }

  /**
   * Update an existing memory
   */
  async update(id: string, updates: Partial<Memory>): Promise<Memory | null> {
    if (updates.containerTag !== undefined) {
      validateContainerTag(updates.containerTag);
    }
    try {
      validate(uuidSchema, id);
      logger.debug('Updating memory', { id });

      const existing = this.store.memories.get(id);
      if (!existing) {
        logger.warn('Memory not found for update', { id });
        return null;
      }

      const updated: Memory = {
        ...existing,
        ...updates,
        updatedAt: new Date(),
      };
      this.store.memories.set(id, updated);

      logger.info('Memory updated', { id });
      return updated;
    } catch (error) {
      logger.errorWithException('Failed to update memory', error, { memoryId: id });
      throw new DatabaseError('Failed to update memory', 'update', {
        originalError: error,
        memoryId: id,
      });
    }
  }

  /**
   * Delete a memory by ID
   */
  async delete(id: string): Promise<boolean> {
    try {
      validate(uuidSchema, id);
      logger.debug('Deleting memory', { id });

      // Also delete related relationships
      for (const [relId, rel] of this.store.relationships) {
        if (rel.sourceMemoryId === id || rel.targetMemoryId === id) {
          this.store.relationships.delete(relId);
        }
      }

      const deleted = this.store.memories.delete(id);
      if (deleted) {
        logger.info('Memory deleted', { id });
      } else {
        logger.warn('Memory not found for deletion', { id });
      }
      return deleted;
    } catch (error) {
      logger.errorWithException('Failed to delete memory', error, { memoryId: id });
      throw new DatabaseError('Failed to delete memory', 'delete', {
        originalError: error,
        memoryId: id,
      });
    }
  }

  /**
   * Find a memory by ID
   */
  async findById(id: string): Promise<Memory | null> {
    try {
      validate(uuidSchema, id);
      logger.debug('Finding memory by ID', { id });
      return this.store.memories.get(id) || null;
    } catch (error) {
      logger.errorWithException('Failed to find memory', error, { memoryId: id });
      throw new DatabaseError('Failed to find memory', 'findById', {
        originalError: error,
        memoryId: id,
      });
    }
  }

  /**
   * Find memories by container tag
   */
  async findByContainerTag(
    containerTag: string,
    options: MemoryQueryOptions = {}
  ): Promise<Memory[]> {
    validateContainerTag(containerTag);
    try {
      const validatedOptions = validate(memoryQueryOptionsSchema, options);
      logger.debug('Finding memories by container tag', {
        containerTag,
        options: validatedOptions,
      });

      let results = Array.from(this.store.memories.values()).filter(
        (m) => m.containerTag === containerTag
      );

      // Apply filters
      if (validatedOptions.latestOnly) {
        results = results.filter((m) => m.isLatest);
      }

      if (validatedOptions.type) {
        results = results.filter((m) => m.type === validatedOptions.type);
      }

      if (validatedOptions.minConfidence !== undefined) {
        results = results.filter((m) => m.confidence >= validatedOptions.minConfidence!);
      }

      // Apply sorting
      const sortBy = validatedOptions.sortBy || 'createdAt';
      const sortOrder = validatedOptions.sortOrder || 'desc';
      results.sort((a, b) => {
        const aVal =
          sortBy === 'createdAt'
            ? a.createdAt
            : sortBy === 'updatedAt'
              ? a.updatedAt
              : sortBy === 'confidence'
                ? a.confidence
                : a.createdAt;
        const bVal =
          sortBy === 'createdAt'
            ? b.createdAt
            : sortBy === 'updatedAt'
              ? b.updatedAt
              : sortBy === 'confidence'
                ? b.confidence
                : b.createdAt;

        if (aVal instanceof Date && bVal instanceof Date) {
          return sortOrder === 'desc'
            ? bVal.getTime() - aVal.getTime()
            : aVal.getTime() - bVal.getTime();
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
        }
        return 0;
      });

      // Apply pagination
      const offset = validatedOptions.offset ?? 0;
      const limit = validatedOptions.limit ?? 100;
      return results.slice(offset, offset + limit);
    } catch (error) {
      logger.errorWithException('Failed to find memories by container tag', error, {
        containerTag,
      });
      throw new DatabaseError('Failed to find memories', 'findByContainerTag', {
        originalError: error,
      });
    }
  }

  /**
   * Find related memories using relationship graph
   */
  async findRelated(
    memoryId: string,
    options: {
      relationshipTypes?: RelationshipType[];
      depth?: number;
      limit?: number;
    } = {}
  ): Promise<{ memory: Memory; relationship: Relationship }[]> {
    try {
      validate(uuidSchema, memoryId);
      logger.debug('Finding related memories', { memoryId, options });

      const { relationshipTypes, depth = 1, limit = 50 } = options;
      const results: { memory: Memory; relationship: Relationship }[] = [];
      const visited = new Set<string>();
      const queue: { id: string; currentDepth: number }[] = [{ id: memoryId, currentDepth: 0 }];

      while (queue.length > 0 && results.length < limit) {
        const current = queue.shift()!;

        if (visited.has(current.id) || current.currentDepth >= depth) {
          continue;
        }
        visited.add(current.id);

        // Find relationships where this memory is source or target
        for (const rel of this.store.relationships.values()) {
          if (rel.sourceMemoryId === current.id || rel.targetMemoryId === current.id) {
            // Filter by relationship type if specified
            if (relationshipTypes && !relationshipTypes.includes(rel.type)) {
              continue;
            }

            const relatedId =
              rel.sourceMemoryId === current.id ? rel.targetMemoryId : rel.sourceMemoryId;

            if (!visited.has(relatedId)) {
              const relatedMemory = this.store.memories.get(relatedId);
              if (relatedMemory) {
                results.push({ memory: relatedMemory, relationship: rel });

                // Add to queue for deeper traversal
                if (current.currentDepth + 1 < depth) {
                  queue.push({ id: relatedId, currentDepth: current.currentDepth + 1 });
                }
              }
            }
          }
        }
      }

      return results.slice(0, limit);
    } catch (error) {
      logger.errorWithException('Failed to find related memories', error, { memoryId });
      throw new DatabaseError('Failed to find related memories', 'findRelated', {
        originalError: error,
      });
    }
  }

  /**
   * Semantic search using embeddings (when enabled)
   */
  async semanticSearch(options: SemanticSearchOptions): Promise<Memory[]> {
    try {
      logger.debug('Performing semantic search', { query: options.query.substring(0, 50) });

      const limit = options.limit ?? 20;

      // Apply filters
      let candidates = Array.from(this.store.memories.values());
      if (options.containerTag) {
        candidates = candidates.filter((m) => m.containerTag === options.containerTag);
      }

      if (options.latestOnly) {
        candidates = candidates.filter((m) => m.isLatest);
      }

      if (options.type) {
        candidates = candidates.filter((m) => m.type === options.type);
      }

      if (!isEmbeddingRelationshipsEnabled()) {
        // Fallback to simple text match when embeddings are disabled.
        // similarityThreshold is intentionally ignored in this mode.
        const query = options.query.toLowerCase();
        const results = candidates.filter((m) => m.content.toLowerCase().includes(query));
        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return results.slice(0, limit);
      }

      if (candidates.length === 0) {
        return [];
      }

      const embeddingService = getEmbeddingService();
      const queryEmbedding = await embeddingService.generateEmbedding(options.query);

      const scored = await Promise.all(
        candidates.map(async (memory) => {
          if (!memory.embedding || memory.embedding.length === 0) {
            memory.embedding = await embeddingService.generateEmbedding(memory.content);
          }

          const similarity = cosineSimilarity(queryEmbedding, memory.embedding);
          return { memory, similarity };
        })
      );

      const threshold = options.similarityThreshold ?? 0;
      const filtered = scored.filter((item) => item.similarity >= threshold);

      filtered.sort((a, b) => {
        if (b.similarity !== a.similarity) {
          return b.similarity - a.similarity;
        }
        return b.memory.createdAt.getTime() - a.memory.createdAt.getTime();
      });

      return filtered.slice(0, limit).map((item) => item.memory);
    } catch (error) {
      logger.errorWithException('Failed to perform semantic search', error);
      throw new DatabaseError('Failed to perform semantic search', 'semanticSearch', {
        originalError: error,
      });
    }
  }

  /**
   * Find memories that might be related to a new memory
   * Used for relationship detection
   */
  async findPotentialRelations(
    memory: Memory,
    options: {
      containerTag?: string;
      limit?: number;
      excludeIds?: string[];
    } = {}
  ): Promise<Memory[]> {
    try {
      logger.debug('Finding potential relations', { memoryId: memory.id });

      const { containerTag, limit = 100, excludeIds = [] } = options;

      let results = Array.from(this.store.memories.values()).filter(
        (m) => m.isLatest && !excludeIds.includes(m.id) && m.id !== memory.id
      );

      if (containerTag) {
        results = results.filter((m) => m.containerTag === containerTag);
      }

      // Sort by recency
      results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return results.slice(0, limit);
    } catch (error) {
      logger.errorWithException('Failed to find potential relations', error);
      throw new DatabaseError('Failed to find potential relations', 'findPotentialRelations', {
        originalError: error,
      });
    }
  }

  // ============ Relationship Operations ============

  /**
   * Create a relationship between memories
   */
  async createRelationship(relationship: Relationship): Promise<Relationship> {
    try {
      logger.debug('Creating relationship', {
        id: relationship.id,
        type: relationship.type,
        source: relationship.sourceMemoryId,
        target: relationship.targetMemoryId,
      });

      this.store.relationships.set(relationship.id, { ...relationship });
      logger.info('Relationship created', { id: relationship.id });
      return relationship;
    } catch (error) {
      logger.errorWithException('Failed to create relationship', error);
      throw new DatabaseError('Failed to create relationship', 'createRelationship', {
        originalError: error,
      });
    }
  }

  /**
   * Create multiple relationships in batch
   */
  async createRelationshipBatch(relationships: Relationship[]): Promise<Relationship[]> {
    try {
      logger.debug('Creating relationships batch', { count: relationships.length });

      const created: Relationship[] = [];
      for (const rel of relationships) {
        this.store.relationships.set(rel.id, { ...rel });
        created.push(rel);
      }

      logger.info('Relationships batch created', { count: created.length });
      return created;
    } catch (error) {
      logger.errorWithException('Failed to create relationships batch', error);
      throw new DatabaseError('Failed to create relationships batch', 'createRelationshipBatch', {
        originalError: error,
      });
    }
  }

  /**
   * Find relationships for a memory
   */
  async findRelationships(
    memoryId: string,
    options: {
      types?: RelationshipType[];
      direction?: 'source' | 'target' | 'both';
    } = {}
  ): Promise<Relationship[]> {
    try {
      validate(uuidSchema, memoryId);
      logger.debug('Finding relationships', { memoryId, options });

      const { types, direction = 'both' } = options;

      const results = Array.from(this.store.relationships.values()).filter((rel) => {
        const matchesDirection =
          direction === 'both' ||
          (direction === 'source' && rel.sourceMemoryId === memoryId) ||
          (direction === 'target' && rel.targetMemoryId === memoryId);

        if (!matchesDirection) return false;

        if (direction === 'both') {
          if (rel.sourceMemoryId !== memoryId && rel.targetMemoryId !== memoryId) {
            return false;
          }
        }

        if (types && !types.includes(rel.type)) return false;

        return true;
      });

      return results;
    } catch (error) {
      logger.errorWithException('Failed to find relationships', error, { memoryId });
      throw new DatabaseError('Failed to find relationships', 'findRelationships', {
        originalError: error,
      });
    }
  }

  /**
   * Delete a relationship
   */
  async deleteRelationship(id: string): Promise<boolean> {
    try {
      validate(uuidSchema, id);
      logger.debug('Deleting relationship', { id });

      const deleted = this.store.relationships.delete(id);
      if (deleted) {
        logger.info('Relationship deleted', { id });
      }
      return deleted;
    } catch (error) {
      logger.errorWithException('Failed to delete relationship', error, { relationshipId: id });
      throw new DatabaseError('Failed to delete relationship', 'deleteRelationship', {
        originalError: error,
      });
    }
  }

  /**
   * Mark a memory as superseded
   */
  async markSuperseded(memoryId: string, supersededById: string): Promise<Memory | null> {
    logger.debug('Marking memory as superseded', { memoryId, supersededById });
    return this.update(memoryId, {
      isLatest: false,
      supersededBy: supersededById,
    });
  }

  // ============ Utility Methods ============

  /**
   * Get all memories (for testing/debugging)
   */
  async getAllMemories(): Promise<Memory[]> {
    return Array.from(this.store.memories.values());
  }

  /**
   * Get all relationships (for testing/debugging)
   */
  async getAllRelationships(): Promise<Relationship[]> {
    return Array.from(this.store.relationships.values());
  }

  /**
   * Clear all data (for testing)
   */
  async clearAll(): Promise<void> {
    logger.debug('Clearing all memory data');
    this.store.memories.clear();
    this.store.relationships.clear();
    logger.info('All memory data cleared');
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalMemories: number;
    latestMemories: number;
    totalRelationships: number;
    byType: Record<string, number>;
    byContainerTag: Record<string, number>;
  }> {
    const memories = Array.from(this.store.memories.values());
    const relationships = Array.from(this.store.relationships.values());

    const byType: Record<string, number> = {};
    const byContainerTag: Record<string, number> = {};

    for (const memory of memories) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;
      const tag = memory.containerTag ?? 'default';
      byContainerTag[tag] = (byContainerTag[tag] || 0) + 1;
    }

    return {
      totalMemories: memories.length,
      latestMemories: memories.filter((m) => m.isLatest).length,
      totalRelationships: relationships.length,
      byType,
      byContainerTag,
    };
  }

  // ============ Persistence Methods ============

  /**
   * Export all data for backup/persistence
   */
  exportData(): {
    memories: Memory[];
    relationships: Relationship[];
    exportedAt: string;
    version: number;
  } {
    return {
      memories: Array.from(this.store.memories.values()),
      relationships: Array.from(this.store.relationships.values()),
      exportedAt: new Date().toISOString(),
      version: 1,
    };
  }

  /**
   * Import data from backup/persistence
   */
  async importData(data: {
    memories: Memory[];
    relationships: Relationship[];
  }): Promise<{ memoriesImported: number; relationshipsImported: number }> {
    logger.debug('Importing data', {
      memoryCount: data.memories.length,
      relationshipCount: data.relationships.length,
    });

    // Clear existing data
    this.store.memories.clear();
    this.store.relationships.clear();

    // Import memories
    for (const memory of data.memories) {
      // Ensure dates are Date objects
      const normalizedMemory: Memory = {
        ...memory,
        createdAt: new Date(memory.createdAt),
        updatedAt: new Date(memory.updatedAt),
      };
      this.store.memories.set(normalizedMemory.id, normalizedMemory);
    }

    // Import relationships
    for (const rel of data.relationships) {
      const normalizedRel: Relationship = {
        ...rel,
        createdAt: new Date(rel.createdAt),
      };
      this.store.relationships.set(normalizedRel.id, normalizedRel);
    }

    logger.info('Data imported', {
      memoriesImported: data.memories.length,
      relationshipsImported: data.relationships.length,
    });

    return {
      memoriesImported: data.memories.length,
      relationshipsImported: data.relationships.length,
    };
  }

  /**
   * Save data to a file (for persistence)
   */
  async saveToFile(filePath: string): Promise<void> {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const { existsSync } = await import('node:fs');

    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const data = this.exportData();
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    logger.info('Data saved to file', { filePath, memoryCount: data.memories.length });
  }

  /**
   * Load data from a file (for persistence)
   */
  async loadFromFile(filePath: string): Promise<boolean> {
    const { readFile } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');

    if (!existsSync(filePath)) {
      logger.debug('No persistence file found', { filePath });
      return false;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as {
        memories: Memory[];
        relationships: Relationship[];
        version: number;
      };

      await this.importData(data);
      logger.info('Data loaded from file', { filePath });
      return true;
    } catch (error) {
      logger.errorWithException('Failed to load data from file', error, { filePath });
      return false;
    }
  }
}

// ============================================================================
// Singleton Pattern (Proxy-based Lazy Initialization)
// ============================================================================

let _repositoryInstance: MemoryRepository | null = null;
let _sharedStore: MemoryStore | null = null;

/**
 * Get the shared memory store (singleton)
 */
export function getSharedStore(): MemoryStore {
  if (!_sharedStore) {
    _sharedStore = createMemoryStore();
  }
  return _sharedStore;
}

/**
 * Get the memory repository singleton instance
 */
export function getMemoryRepository(): MemoryRepository {
  if (!_repositoryInstance) {
    _repositoryInstance = new MemoryRepository(getSharedStore());
  }
  return _repositoryInstance;
}

/**
 * Create a new repository instance with isolated store (for testing)
 */
export function createMemoryRepository(store?: MemoryStore): MemoryRepository {
  return new MemoryRepository(store ?? createMemoryStore());
}

/**
 * Reset the singleton instances (for testing)
 */
export function resetMemoryRepository(): void {
  _repositoryInstance = null;
  _sharedStore = null;
}

/**
 * Proxy-based lazy singleton for backwards compatibility
 */
export const memoryRepository = new Proxy({} as MemoryRepository, {
  get(_, prop) {
    return getMemoryRepository()[prop as keyof MemoryRepository];
  },
});
