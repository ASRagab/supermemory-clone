/**
 * In-Memory Vector Store
 *
 * A fast, ephemeral vector store implementation that stores all vectors in memory.
 * Suitable for development, testing, and small-scale production use.
 *
 * Features:
 * - O(n) linear search with optimized similarity calculation
 * - Metadata filtering support
 * - No external dependencies
 * - Thread-safe operations
 */

import {
  VectorEntry,
  VectorSearchResult,
  SearchOptions,
  AddOptions,
  DeleteOptions,
  VectorStoreConfig,
  VectorStoreStats,
  BatchResult,
} from './types.js';
import { BaseVectorStore, validateVector } from './base.js';
import { ConflictError } from '../../utils/errors.js';

/**
 * Internal entry with additional tracking
 */
interface InternalEntry extends VectorEntry {
  namespace: string;
}

/**
 * In-Memory Vector Store implementation
 */
export class InMemoryVectorStore extends BaseVectorStore {
  private entries: Map<string, InternalEntry> = new Map();
  private initialized = false;

  constructor(config: VectorStoreConfig) {
    super({
      ...config,
      provider: 'memory',
    });
  }

  /**
   * Initialize the in-memory store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.entries.clear();
    this.initialized = true;
  }

  /**
   * Add a single vector entry
   */
  async add(entry: VectorEntry, options?: AddOptions): Promise<void> {
    this.validateEntry(entry);
    const namespace = options?.namespace ?? this.config.defaultNamespace ?? 'default';

    if (this.entries.has(entry.id) && !options?.overwrite) {
      throw new ConflictError(
        `Entry with ID ${entry.id} already exists`,
        'duplicate',
        { entryId: entry.id }
      );
    }

    const internalEntry: InternalEntry = {
      ...entry,
      namespace,
      createdAt: entry.createdAt ?? new Date(),
      updatedAt: new Date(),
    };

    this.entries.set(entry.id, internalEntry);
    this.emit('add', { id: entry.id });
  }

  /**
   * Add multiple vector entries
   */
  async addBatch(entries: VectorEntry[], options?: AddOptions): Promise<BatchResult> {
    const result: BatchResult = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    for (const entry of entries) {
      try {
        await this.add(entry, options);
        result.successful++;
      } catch (error) {
        result.failed++;
        result.errors?.push({
          id: entry.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  /**
   * Update an existing vector entry
   */
  async update(id: string, updates: Partial<VectorEntry>): Promise<boolean> {
    const existing = this.entries.get(id);
    if (!existing) {
      return false;
    }

    // Validate embedding if provided
    if (updates.embedding) {
      validateVector(updates.embedding, this.config.dimensions);
    }

    const updated: InternalEntry = {
      ...existing,
      ...updates,
      id, // Ensure ID cannot be changed
      namespace: existing.namespace, // Preserve namespace
      updatedAt: new Date(),
    };

    this.entries.set(id, updated);
    this.emit('update', { id });
    return true;
  }

  /**
   * Delete vector entries
   */
  async delete(options: DeleteOptions): Promise<number> {
    let deleted = 0;

    if (options.deleteAll) {
      const namespace = options.namespace ?? this.config.defaultNamespace ?? 'default';
      for (const [id, entry] of this.entries) {
        if (entry.namespace === namespace) {
          this.entries.delete(id);
          deleted++;
        }
      }
    } else if (options.ids && options.ids.length > 0) {
      for (const id of options.ids) {
        if (this.entries.delete(id)) {
          deleted++;
        }
      }
    } else if (options.filter) {
      for (const [id, entry] of this.entries) {
        if (this.matchesFilter(entry.metadata, options.filter)) {
          this.entries.delete(id);
          deleted++;
        }
      }
    }

    if (deleted > 0) {
      this.emit('delete', { count: deleted });
    }

    return deleted;
  }

  /**
   * Get a vector entry by ID
   */
  async get(id: string): Promise<VectorEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    // Return copy without internal fields
    const { namespace, ...publicEntry } = entry;
    return publicEntry;
  }

  /**
   * Check if a vector entry exists
   */
  async exists(id: string): Promise<boolean> {
    return this.entries.has(id);
  }

  /**
   * Search for similar vectors using cosine similarity
   */
  async search(query: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
    validateVector(query, this.config.dimensions);
    const opts = this.mergeOptions(options);

    // Get all entries and apply filters
    const allEntries = Array.from(this.entries.values());
    const candidates = this.applyFilters(
      allEntries as VectorEntry[],
      opts.filters
    ) as InternalEntry[];

    // Calculate similarities
    const results: VectorSearchResult[] = [];
    for (const entry of candidates) {
      const score = this.calculateSimilarity(query, entry.embedding);

      if (score >= opts.threshold) {
        results.push({
          id: entry.id,
          score,
          embedding: opts.includeVectors ? entry.embedding : undefined,
          metadata: opts.includeMetadata ? entry.metadata : {},
        });
      }
    }

    // Sort by score descending and apply limit
    results.sort((a, b) => b.score - a.score);

    this.emit('search', {
      resultsCount: Math.min(results.length, opts.limit),
      totalCandidates: candidates.length,
    });

    return results.slice(0, opts.limit);
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<VectorStoreStats> {
    const namespaces = new Set<string>();
    for (const entry of this.entries.values()) {
      namespaces.add(entry.namespace);
    }

    return {
      totalVectors: this.entries.size,
      dimensions: this.config.dimensions,
      indexType: 'flat',
      metric: this.config.metric ?? 'cosine',
      indexBuilt: true, // Always true for in-memory
      namespaces: Array.from(namespaces),
    };
  }

  /**
   * Clear all vectors from the store
   */
  async clear(): Promise<void> {
    this.entries.clear();
    this.emit('delete', { deleteAll: true });
  }

  /**
   * Close the vector store and release resources
   */
  async close(): Promise<void> {
    this.entries.clear();
    this.initialized = false;
  }

  /**
   * Get all entries (for migration/export)
   */
  async getAllEntries(): Promise<VectorEntry[]> {
    return Array.from(this.entries.values()).map(({ namespace, ...entry }) => entry);
  }

  /**
   * Get the number of entries
   */
  size(): number {
    return this.entries.size;
  }
}

/**
 * Create an in-memory vector store
 */
export function createInMemoryVectorStore(
  dimensions: number,
  options?: Partial<Omit<VectorStoreConfig, 'provider' | 'dimensions'>>
): InMemoryVectorStore {
  return new InMemoryVectorStore({
    provider: 'memory',
    dimensions,
    ...options,
  });
}
