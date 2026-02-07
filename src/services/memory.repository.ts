/**
 * Memory Repository - Database Operations
 *
 * Handles persistence layer for memories and relationships.
 * Uses PostgreSQL for runtime persistence; store injection is retained only for test compatibility.
 */

import {
  Memory,
  Relationship,
  MemoryQueryOptions,
  SemanticSearchOptions,
  RelationshipType,
  type MemoryType,
} from './memory.types.js';
import { getLogger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';
import {
  validate,
  uuidSchema,
  memoryQueryOptionsSchema,
  validateContainerTag,
} from '../utils/validation.js';
import { isEmbeddingRelationshipsEnabled } from '../config/feature-flags.js';
import { getEmbeddingService, cosineSimilarity } from './embedding.service.js';
import { getPostgresDatabase } from '../db/postgres.js';
import { getDatabaseUrl, isPostgresUrl } from '../db/client.js';
import { memories as memoriesTable } from '../db/schema/memories.schema.js';
import { memoryRelationships } from '../db/schema/relationships.schema.js';
import { memoryEmbeddings } from '../db/schema/embeddings.schema.js';
import { and, asc, desc, eq, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';

const logger = getLogger('MemoryRepository');

let _db: ReturnType<typeof getPostgresDatabase> | null = null;

function getDb(): ReturnType<typeof getPostgresDatabase> {
  if (_db) return _db;
  const databaseUrl = getDatabaseUrl();
  if (!isPostgresUrl(databaseUrl)) {
    throw new Error(
      'MemoryRepository requires a PostgreSQL DATABASE_URL. SQLite is only supported in tests and is not compatible with memory repository persistence.'
    );
  }
  _db = getPostgresDatabase(databaseUrl);
  return _db;
}

const db = new Proxy({} as ReturnType<typeof getPostgresDatabase>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof getPostgresDatabase>];
  },
});

const dbMemoryTypes = new Set(['fact', 'preference', 'episode', 'belief', 'skill', 'context']);
const memoryTypes = new Set<MemoryType>([
  'fact',
  'event',
  'preference',
  'skill',
  'relationship',
  'context',
  'note',
]);

const relationshipTypes = new Set<RelationshipType>([
  'updates',
  'extends',
  'derives',
  'contradicts',
  'related',
  'supersedes',
]);

function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && memoryTypes.has(value as MemoryType);
}

function isRelationshipType(value: unknown): value is RelationshipType {
  return typeof value === 'string' && relationshipTypes.has(value as RelationshipType);
}

function mapMemoryTypeToDb(type: MemoryType): { dbType: string; originalType?: MemoryType } {
  if (dbMemoryTypes.has(type)) {
    return { dbType: type };
  }

  switch (type) {
    case 'event':
      return { dbType: 'episode', originalType: type };
    case 'relationship':
      return { dbType: 'fact', originalType: type };
    case 'note':
      return { dbType: 'context', originalType: type };
    default:
      return { dbType: 'fact', originalType: type };
  }
}

function mapMemoryTypeFromDb(dbType: string, metadata: Record<string, unknown>): MemoryType {
  const original = metadata.originalType;
  if (isMemoryType(original)) {
    return original;
  }

  if (dbMemoryTypes.has(dbType)) {
    return dbType as MemoryType;
  }

  return 'fact';
}

function mapRelationshipTypeToDb(type: RelationshipType): {
  dbType: string;
  originalType?: RelationshipType;
} {
  if (type === 'related') {
    return { dbType: 'relates', originalType: type };
  }
  if (type === 'supersedes') {
    return { dbType: 'updates', originalType: type };
  }
  return { dbType: type };
}

function mapRelationshipTypeFromDb(
  dbType: string,
  metadata: Record<string, unknown>
): RelationshipType {
  const original = metadata.originalType;
  if (isRelationshipType(original)) {
    return original;
  }

  if (dbType === 'relates') return 'related';
  if (dbType === 'updates') return 'updates';
  return (dbType as RelationshipType) ?? 'related';
}

function generateSimilarityHash(content: string): string {
  const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex');
}

function normalizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> {
  if (metadata && typeof metadata === 'object') {
    return { ...metadata };
  }
  return {};
}

function mapDbMemory(row: typeof memoriesTable.$inferSelect): Memory {
  const metadata = normalizeMetadata(row.metadata as Record<string, unknown> | null);
  const type = mapMemoryTypeFromDb(row.memoryType, metadata);
  const confidence = row.confidenceScore ? parseFloat(row.confidenceScore) : 1;

  return {
    id: row.id,
    content: row.content,
    type,
    relationships: [],
    isLatest: row.isLatest,
    supersededBy: row.supersedesId ?? undefined,
    containerTag: row.containerTag ?? undefined,
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    confidence,
  };
}

function mapDbRelationship(row: typeof memoryRelationships.$inferSelect): Relationship {
  const metadata = normalizeMetadata(row.metadata as Record<string, unknown> | null);
  const description = typeof metadata.description === 'string' ? metadata.description : undefined;
  const type = mapRelationshipTypeFromDb(row.relationshipType, metadata);

  return {
    id: row.id,
    sourceMemoryId: row.sourceMemoryId,
    targetMemoryId: row.targetMemoryId,
    type,
    confidence: row.weight ? parseFloat(row.weight) : 1,
    description,
    createdAt: row.createdAt,
    metadata,
  };
}

// ============================================================================
// Memory Store Interface (for dependency injection)
// ============================================================================

/**
 * Memory store interface - retained for test compatibility
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
// In-memory repository (test/default)
// ============================================================================

export class InMemoryMemoryRepository {
  private readonly store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  getStore(): MemoryStore {
    return this.store;
  }

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

  async delete(id: string): Promise<boolean> {
    try {
      validate(uuidSchema, id);
      logger.debug('Deleting memory', { id });

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

      if (validatedOptions.latestOnly) {
        results = results.filter((m) => m.isLatest);
      }

      if (validatedOptions.type) {
        results = results.filter((m) => m.type === validatedOptions.type);
      }

      if (validatedOptions.minConfidence !== undefined) {
        results = results.filter((m) => m.confidence >= validatedOptions.minConfidence!);
      }

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

        for (const rel of this.store.relationships.values()) {
          if (rel.sourceMemoryId === current.id || rel.targetMemoryId === current.id) {
            if (relationshipTypes && !relationshipTypes.includes(rel.type)) {
              continue;
            }

            const relatedId =
              rel.sourceMemoryId === current.id ? rel.targetMemoryId : rel.sourceMemoryId;

            if (!visited.has(relatedId)) {
              const relatedMemory = this.store.memories.get(relatedId);
              if (relatedMemory) {
                results.push({ memory: relatedMemory, relationship: rel });

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

  async semanticSearch(options: SemanticSearchOptions): Promise<Memory[]> {
    try {
      logger.debug('Performing semantic search', { query: options.query.substring(0, 50) });

      const limit = options.limit ?? 20;
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

      results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return results.slice(0, limit);
    } catch (error) {
      logger.errorWithException('Failed to find potential relations', error);
      throw new DatabaseError('Failed to find potential relations', 'findPotentialRelations', {
        originalError: error,
      });
    }
  }

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

  async markSuperseded(memoryId: string, supersededById: string): Promise<Memory | null> {
    logger.debug('Marking memory as superseded', { memoryId, supersededById });
    return this.update(memoryId, {
      isLatest: false,
      supersededBy: supersededById,
    });
  }

  async getAllMemories(): Promise<Memory[]> {
    return Array.from(this.store.memories.values());
  }

  async getAllRelationships(): Promise<Relationship[]> {
    return Array.from(this.store.relationships.values());
  }

  async clearAll(): Promise<void> {
    logger.debug('Clearing all memory data');
    this.store.memories.clear();
    this.store.relationships.clear();
    logger.info('All memory data cleared');
  }

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

  async importData(data: {
    memories: Memory[];
    relationships: Relationship[];
  }): Promise<{ memoriesImported: number; relationshipsImported: number }> {
    logger.debug('Importing data', {
      memoryCount: data.memories.length,
      relationshipCount: data.relationships.length,
    });

    this.store.memories.clear();
    this.store.relationships.clear();

    for (const memory of data.memories) {
      const normalizedMemory: Memory = {
        ...memory,
        createdAt: new Date(memory.createdAt),
        updatedAt: new Date(memory.updatedAt),
      };
      this.store.memories.set(normalizedMemory.id, normalizedMemory);
    }

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
// Memory Repository
// ============================================================================

/**
 * Memory Repository class for database operations
 * Accepts a store via constructor for compatibility with older tests
 */
export class PostgresMemoryRepository {
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

      const existing = await db.select().from(memoriesTable).where(eq(memoriesTable.id, memory.id));
      if (existing.length > 0) {
        throw new DatabaseError(`Memory with ID ${memory.id} already exists`, 'create', {
          existingId: memory.id,
        });
      }

      const metadata = normalizeMetadata(memory.metadata);
      const { dbType, originalType } = mapMemoryTypeToDb(memory.type);
      if (originalType) {
        metadata.originalType = originalType;
      }

      await db.insert(memoriesTable).values({
        id: memory.id,
        content: memory.content,
        memoryType: dbType,
        isLatest: memory.isLatest,
        similarityHash: generateSimilarityHash(memory.content),
        containerTag: memory.containerTag ?? 'default',
        confidenceScore: memory.confidence.toString(),
        metadata,
        supersedesId: memory.supersededBy ?? null,
        updatedAt: memory.updatedAt ?? new Date(),
        createdAt: memory.createdAt ?? new Date(),
        version: 1,
      });

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

      if (memories.length === 0) {
        return [];
      }

      const values = memories.map((memory) => {
        const metadata = normalizeMetadata(memory.metadata);
        const { dbType, originalType } = mapMemoryTypeToDb(memory.type);
        if (originalType) {
          metadata.originalType = originalType;
        }

        return {
          id: memory.id,
          content: memory.content,
          memoryType: dbType,
          isLatest: memory.isLatest,
          similarityHash: generateSimilarityHash(memory.content),
          containerTag: memory.containerTag ?? 'default',
          confidenceScore: memory.confidence.toString(),
          metadata,
          supersedesId: memory.supersededBy ?? null,
          updatedAt: memory.updatedAt ?? new Date(),
          createdAt: memory.createdAt ?? new Date(),
          version: 1,
        };
      });

      await db.insert(memoriesTable).values(values);
      logger.info('Memories batch created', { count: memories.length });
      return memories;
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

      const existing = await db.select().from(memoriesTable).where(eq(memoriesTable.id, id));
      if (existing.length === 0) {
        logger.warn('Memory not found for update', { id });
        return null;
      }

      const current = existing[0]!;
      const metadata = updates.metadata
        ? normalizeMetadata(updates.metadata)
        : normalizeMetadata(current.metadata as Record<string, unknown> | null);

      const updateData: Partial<typeof memoriesTable.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (updates.content !== undefined) {
        updateData.content = updates.content;
        updateData.similarityHash = generateSimilarityHash(updates.content);
      }

      if (updates.type !== undefined) {
        const { dbType, originalType } = mapMemoryTypeToDb(updates.type);
        updateData.memoryType = dbType;
        if (originalType) {
          metadata.originalType = originalType;
        }
      }

      if (updates.isLatest !== undefined) {
        updateData.isLatest = updates.isLatest;
      }

      if (updates.supersededBy !== undefined) {
        updateData.supersedesId = updates.supersededBy ?? null;
      }

      if (updates.containerTag !== undefined) {
        updateData.containerTag = updates.containerTag ?? 'default';
      }

      if (updates.confidence !== undefined) {
        updateData.confidenceScore = updates.confidence.toString();
      }

      updateData.metadata = metadata;

      const [updatedRow] = await db
        .update(memoriesTable)
        .set(updateData)
        .where(eq(memoriesTable.id, id))
        .returning();

      if (!updatedRow) {
        return null;
      }

      logger.info('Memory updated', { id });
      return mapDbMemory(updatedRow);
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

      const deleted = await db
        .delete(memoriesTable)
        .where(eq(memoriesTable.id, id))
        .returning({ id: memoriesTable.id });

      if (deleted.length > 0) {
        logger.info('Memory deleted', { id });
        return true;
      }

      logger.warn('Memory not found for deletion', { id });
      return false;
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
      const [memory] = await db.select().from(memoriesTable).where(eq(memoriesTable.id, id));
      return memory ? mapDbMemory(memory) : null;
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

      const conditions = [eq(memoriesTable.containerTag, containerTag)];

      if (validatedOptions.latestOnly) {
        conditions.push(eq(memoriesTable.isLatest, true));
      }

      if (validatedOptions.type) {
        const { dbType } = mapMemoryTypeToDb(validatedOptions.type);
        conditions.push(eq(memoriesTable.memoryType, dbType));
      }

      if (validatedOptions.minConfidence !== undefined) {
        conditions.push(sql`${memoriesTable.confidenceScore} >= ${validatedOptions.minConfidence}`);
      }

      const sortBy = validatedOptions.sortBy || 'createdAt';
      const sortOrder = validatedOptions.sortOrder || 'desc';
      const orderField =
        sortBy === 'updatedAt'
          ? memoriesTable.updatedAt
          : sortBy === 'confidence'
            ? memoriesTable.confidenceScore
            : memoriesTable.createdAt;

      const orderBy = sortOrder === 'asc' ? asc(orderField) : desc(orderField);
      const limit = validatedOptions.limit ?? 100;
      const offset = validatedOptions.offset ?? 0;

      const rows = await db
        .select()
        .from(memoriesTable)
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      return rows.map(mapDbMemory);
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

      const { relationshipTypes: types, depth = 1, limit = 50 } = options;
      const results: { memory: Memory; relationship: Relationship }[] = [];
      const visited = new Set<string>();
      const queue: { id: string; currentDepth: number }[] = [{ id: memoryId, currentDepth: 0 }];

      while (queue.length > 0 && results.length < limit) {
        const current = queue.shift()!;

        if (visited.has(current.id) || current.currentDepth >= depth) {
          continue;
        }
        visited.add(current.id);

        const relationships = await this.findRelationships(current.id, {
          types,
          direction: 'both',
        });

        for (const rel of relationships) {
          const relatedId =
            rel.sourceMemoryId === current.id ? rel.targetMemoryId : rel.sourceMemoryId;

          if (visited.has(relatedId)) {
            continue;
          }

          const relatedMemory = await this.findById(relatedId);
          if (relatedMemory) {
            results.push({ memory: relatedMemory, relationship: rel });

            if (current.currentDepth + 1 < depth) {
              queue.push({ id: relatedId, currentDepth: current.currentDepth + 1 });
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

      if (!isEmbeddingRelationshipsEnabled()) {
        const conditions = [sql`${memoriesTable.content} ILIKE ${`%${options.query}%`}`];

        if (options.containerTag) {
          conditions.push(eq(memoriesTable.containerTag, options.containerTag));
        }

        if (options.latestOnly) {
          conditions.push(eq(memoriesTable.isLatest, true));
        }

        if (options.type) {
          const { dbType } = mapMemoryTypeToDb(options.type);
          conditions.push(eq(memoriesTable.memoryType, dbType));
        }

        const rows = await db
          .select()
          .from(memoriesTable)
          .where(and(...conditions))
          .orderBy(desc(memoriesTable.createdAt))
          .limit(limit);

        return rows.map(mapDbMemory);
      }

      const embeddingService = getEmbeddingService();
      const queryEmbedding = await embeddingService.generateEmbedding(options.query);
      const queryVector = `[${queryEmbedding.join(',')}]`;
      const similarityThreshold = options.similarityThreshold ?? 0;

      const whereClauses = [sql`1 = 1`];

      if (options.containerTag) {
        whereClauses.push(eq(memoriesTable.containerTag, options.containerTag));
      }

      if (options.latestOnly) {
        whereClauses.push(eq(memoriesTable.isLatest, true));
      }

      if (options.type) {
        const { dbType } = mapMemoryTypeToDb(options.type);
        whereClauses.push(eq(memoriesTable.memoryType, dbType));
      }

      if (options.minConfidence !== undefined) {
        whereClauses.push(sql`${memoriesTable.confidenceScore} >= ${options.minConfidence}`);
      }

      const similarityExpression = sql`1 - (${memoryEmbeddings.embedding} <=> ${queryVector}::vector)`;

      const result = await db.execute(sql`
        SELECT ${memoriesTable}.*, ${similarityExpression} as similarity
        FROM ${memoryEmbeddings}
        JOIN ${memoriesTable}
          ON ${memoriesTable.id} = ${memoryEmbeddings.memoryId}
        WHERE ${sql.join(whereClauses, sql` AND `)}
          AND ${similarityExpression} >= ${similarityThreshold}
        ORDER BY ${memoryEmbeddings.embedding} <=> ${queryVector}::vector
        LIMIT ${limit}
      `);

      const rows =
        (result as unknown as { rows?: Array<typeof memoriesTable.$inferSelect> }).rows ?? [];
      if (rows.length > 0) {
        return rows.map(mapDbMemory);
      }

      const fallbackRows = await db
        .select()
        .from(memoriesTable)
        .where(and(...whereClauses))
        .orderBy(desc(memoriesTable.createdAt))
        .limit(limit);

      if (fallbackRows.length === 0) {
        return [];
      }

      const scored = await Promise.all(
        fallbackRows.map(async (memory) => {
          const embedding = await embeddingService.generateEmbedding(memory.content);
          const similarity = cosineSimilarity(queryEmbedding, embedding);
          return { memory: mapDbMemory(memory), similarity };
        })
      );

      const filtered = scored.filter((item) => item.similarity >= similarityThreshold);
      filtered.sort((a, b) => {
        if (b.similarity !== a.similarity) return b.similarity - a.similarity;
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

      const conditions = [
        eq(memoriesTable.isLatest, true),
        sql`${memoriesTable.id} != ${memory.id}`,
      ];

      if (excludeIds.length > 0) {
        conditions.push(notInArray(memoriesTable.id, excludeIds));
      }

      if (containerTag) {
        conditions.push(eq(memoriesTable.containerTag, containerTag));
      }

      const rows = await db
        .select()
        .from(memoriesTable)
        .where(and(...conditions))
        .orderBy(desc(memoriesTable.createdAt))
        .limit(limit);

      return rows.map(mapDbMemory);
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

      const metadata = normalizeMetadata(relationship.metadata);
      const { dbType, originalType } = mapRelationshipTypeToDb(relationship.type);
      if (originalType) {
        metadata.originalType = originalType;
      }
      if (relationship.description) {
        metadata.description = relationship.description;
      }

      await db.insert(memoryRelationships).values({
        id: relationship.id,
        sourceMemoryId: relationship.sourceMemoryId,
        targetMemoryId: relationship.targetMemoryId,
        relationshipType: dbType,
        weight: relationship.confidence.toString(),
        bidirectional: false,
        metadata,
        createdAt: relationship.createdAt ?? new Date(),
      });

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

      if (relationships.length === 0) {
        return [];
      }

      const values = relationships.map((relationship) => {
        const metadata = normalizeMetadata(relationship.metadata);
        const { dbType, originalType } = mapRelationshipTypeToDb(relationship.type);
        if (originalType) {
          metadata.originalType = originalType;
        }
        if (relationship.description) {
          metadata.description = relationship.description;
        }

        return {
          id: relationship.id,
          sourceMemoryId: relationship.sourceMemoryId,
          targetMemoryId: relationship.targetMemoryId,
          relationshipType: dbType,
          weight: relationship.confidence.toString(),
          bidirectional: false,
          metadata,
          createdAt: relationship.createdAt ?? new Date(),
        };
      });

      await db.insert(memoryRelationships).values(values);
      logger.info('Relationships batch created', { count: relationships.length });
      return relationships;
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
      const conditions: SQL<unknown>[] = [];
      const directionCondition =
        direction === 'source'
          ? eq(memoryRelationships.sourceMemoryId, memoryId)
          : direction === 'target'
            ? eq(memoryRelationships.targetMemoryId, memoryId)
            : or(
                eq(memoryRelationships.sourceMemoryId, memoryId),
                eq(memoryRelationships.targetMemoryId, memoryId)
              );

      if (directionCondition) {
        conditions.push(directionCondition);
      }

      if (types && types.length > 0) {
        const dbTypes = types.map((type) => mapRelationshipTypeToDb(type).dbType);
        conditions.push(inArray(memoryRelationships.relationshipType, dbTypes));
      }

      const rows = await db
        .select()
        .from(memoryRelationships)
        .where(and(...conditions));

      return rows.map(mapDbRelationship);
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

      const deleted = await db
        .delete(memoryRelationships)
        .where(eq(memoryRelationships.id, id))
        .returning({ id: memoryRelationships.id });

      if (deleted.length > 0) {
        logger.info('Relationship deleted', { id });
        return true;
      }

      return false;
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
    const rows = await db.select().from(memoriesTable);
    return rows.map(mapDbMemory);
  }

  /**
   * Get all relationships (for testing/debugging)
   */
  async getAllRelationships(): Promise<Relationship[]> {
    const rows = await db.select().from(memoryRelationships);
    return rows.map(mapDbRelationship);
  }

  /**
   * Clear all data (for testing)
   */
  async clearAll(): Promise<void> {
    logger.debug('Clearing all memory data');
    await db.delete(memoryRelationships);
    await db.delete(memoriesTable);
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
    const totalMemoriesRows = await db.select({ count: sql<number>`count(*)` }).from(memoriesTable);
    const totalMemories = Number(totalMemoriesRows[0]?.count ?? 0);

    const latestMemoriesRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(memoriesTable)
      .where(eq(memoriesTable.isLatest, true));
    const latestMemories = Number(latestMemoriesRows[0]?.count ?? 0);

    const totalRelationshipsRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(memoryRelationships);
    const totalRelationships = Number(totalRelationshipsRows[0]?.count ?? 0);

    const typeRows = await db
      .select({
        type: memoriesTable.memoryType,
        count: sql<number>`count(*)`,
      })
      .from(memoriesTable)
      .groupBy(memoriesTable.memoryType);

    const containerRows = await db
      .select({
        tag: memoriesTable.containerTag,
        count: sql<number>`count(*)`,
      })
      .from(memoriesTable)
      .groupBy(memoriesTable.containerTag);

    const byType: Record<string, number> = {};
    const byContainerTag: Record<string, number> = {};

    for (const row of typeRows) {
      byType[row.type] = Number(row.count);
    }

    for (const row of containerRows) {
      const tag = row.tag ?? 'default';
      byContainerTag[tag] = Number(row.count);
    }

    return {
      totalMemories,
      latestMemories,
      totalRelationships,
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
      memories: [],
      relationships: [],
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

    await this.clearAll();

    if (data.memories.length > 0) {
      await this.createBatch(
        data.memories.map((memory) => ({
          ...memory,
          createdAt: new Date(memory.createdAt),
          updatedAt: new Date(memory.updatedAt),
        }))
      );
    }

    if (data.relationships.length > 0) {
      await this.createRelationshipBatch(
        data.relationships.map((rel) => ({
          ...rel,
          createdAt: new Date(rel.createdAt),
        }))
      );
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

    const memories = await this.getAllMemories();
    const relationships = await this.getAllRelationships();
    const data = {
      memories,
      relationships,
      exportedAt: new Date().toISOString(),
      version: 1,
    };

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

export type MemoryRepository = InMemoryMemoryRepository | PostgresMemoryRepository;

// ============================================================================
// Singleton Pattern (Proxy-based Lazy Initialization)
// ============================================================================

let _inMemoryRepositoryInstance: InMemoryMemoryRepository | null = null;
let _postgresRepositoryInstance: PostgresMemoryRepository | null = null;
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
export function getInMemoryMemoryRepository(): InMemoryMemoryRepository {
  if (!_inMemoryRepositoryInstance) {
    _inMemoryRepositoryInstance = new InMemoryMemoryRepository(getSharedStore());
  }
  return _inMemoryRepositoryInstance;
}

export function getPostgresMemoryRepository(): PostgresMemoryRepository {
  if (!_postgresRepositoryInstance) {
    _postgresRepositoryInstance = new PostgresMemoryRepository();
  }
  return _postgresRepositoryInstance;
}

export function getMemoryRepository(): MemoryRepository {
  if (process.env.NODE_ENV === 'test') {
    return getInMemoryMemoryRepository();
  }
  return getPostgresMemoryRepository();
}

/**
 * Create a new repository instance with isolated store (for testing)
 */
export function createMemoryRepository(store?: MemoryStore): InMemoryMemoryRepository {
  return new InMemoryMemoryRepository(store ?? createMemoryStore());
}

export function createPostgresMemoryRepository(): PostgresMemoryRepository {
  return new PostgresMemoryRepository();
}

/**
 * Reset the singleton instances (for testing)
 */
export function resetMemoryRepository(): void {
  _inMemoryRepositoryInstance = null;
  _postgresRepositoryInstance = null;
  _sharedStore = null;
  _db = null;
}

/**
 * Proxy-based lazy singleton for backwards compatibility
 */
export const memoryRepository = new Proxy({} as MemoryRepository, {
  get(_, prop) {
    return getMemoryRepository()[prop as keyof MemoryRepository];
  },
});
