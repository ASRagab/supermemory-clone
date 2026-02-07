/**
 * Base Vector Store
 *
 * Abstract base class for vector store implementations.
 * Provides common utilities and defines the interface that all
 * vector store implementations must follow.
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
  MetadataFilter,
  SimilarityMetric,
  DEFAULT_SEARCH_OPTIONS,
  VectorStoreEvent,
  VectorStoreEventListener,
} from './types.js';
import { ValidationError } from '../../utils/errors.js';

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new ValidationError(`Vector dimension mismatch: ${a.length} vs ${b.length}`, {
      vectorA: [`Expected dimension ${b.length}, got ${a.length}`],
    });
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Calculate Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new ValidationError(`Vector dimension mismatch: ${a.length} vs ${b.length}`, {
      vectorA: [`Expected dimension ${b.length}, got ${a.length}`],
    });
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Calculate dot product between two vectors
 */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new ValidationError(`Vector dimension mismatch: ${a.length} vs ${b.length}`, {
      vectorA: [`Expected dimension ${b.length}, got ${a.length}`],
    });
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }

  return sum;
}

/**
 * Normalize a vector to unit length (L2 normalization)
 */
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return vector;
  return vector.map((val) => val / magnitude);
}

/**
 * Validate vector dimensions
 */
export function validateVector(vector: number[], expectedDimensions: number): void {
  if (!Array.isArray(vector)) {
    throw new ValidationError('Vector must be an array', {
      vector: ['Vector must be an array of numbers'],
    });
  }
  if (vector.length !== expectedDimensions) {
    throw new ValidationError(
      `Vector dimension mismatch: expected ${expectedDimensions}, got ${vector.length}`,
      {
        vector: [`Expected ${expectedDimensions} dimensions, got ${vector.length}`],
      }
    );
  }
  if (vector.some((v) => typeof v !== 'number' || isNaN(v))) {
    throw new ValidationError('Vector must contain only valid numbers', {
      vector: ['All vector elements must be valid numbers (no NaN or non-numeric values)'],
    });
  }
}

/**
 * Abstract base class for vector stores
 */
export abstract class BaseVectorStore {
  protected readonly config: VectorStoreConfig;
  protected readonly listeners: VectorStoreEventListener[] = [];

  constructor(config: VectorStoreConfig) {
    this.config = {
      metric: 'cosine',
      indexType: 'flat',
      defaultNamespace: 'default',
      ...config,
    };
  }

  /**
   * Get the configured dimensions
   */
  getDimensions(): number {
    return this.config.dimensions;
  }

  /**
   * Get the configured similarity metric
   */
  getMetric(): SimilarityMetric {
    return this.config.metric ?? 'cosine';
  }

  /**
   * Calculate similarity between two vectors using configured metric
   */
  calculateSimilarity(a: number[], b: number[]): number {
    const metric = this.getMetric();
    switch (metric) {
      case 'cosine':
        return cosineSimilarity(a, b);
      case 'euclidean':
        // Convert distance to similarity (1 / (1 + distance))
        return 1 / (1 + euclideanDistance(a, b));
      case 'dot_product':
        return dotProduct(a, b);
      default:
        return cosineSimilarity(a, b);
    }
  }

  /**
   * Validate a vector entry
   */
  protected validateEntry(entry: VectorEntry): void {
    if (!entry.id || typeof entry.id !== 'string') {
      throw new ValidationError('Vector entry must have a valid string ID', {
        id: ['Entry ID must be a non-empty string'],
      });
    }
    validateVector(entry.embedding, this.config.dimensions);
  }

  /**
   * Apply metadata filters to entries
   */
  protected applyFilters(entries: VectorEntry[], filters?: MetadataFilter[]): VectorEntry[] {
    if (!filters || filters.length === 0) {
      return entries;
    }

    return entries.filter((entry) => {
      return filters.every((filter) => this.matchesFilter(entry.metadata, filter));
    });
  }

  /**
   * Check if metadata matches a filter
   */
  protected matchesFilter(metadata: Record<string, unknown>, filter: MetadataFilter): boolean {
    const value = metadata[filter.key];
    if (value === undefined) return false;

    switch (filter.operator) {
      case 'eq':
        return value === filter.value;
      case 'ne':
        return value !== filter.value;
      case 'gt':
        return (
          typeof value === 'number' && typeof filter.value === 'number' && value > filter.value
        );
      case 'gte':
        return (
          typeof value === 'number' && typeof filter.value === 'number' && value >= filter.value
        );
      case 'lt':
        return (
          typeof value === 'number' && typeof filter.value === 'number' && value < filter.value
        );
      case 'lte':
        return (
          typeof value === 'number' && typeof filter.value === 'number' && value <= filter.value
        );
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(value as string | number);
      case 'nin':
        return Array.isArray(filter.value) && !filter.value.includes(value as string | number);
      case 'contains':
        return (
          typeof value === 'string' &&
          typeof filter.value === 'string' &&
          value.includes(filter.value)
        );
      case 'startsWith':
        return (
          typeof value === 'string' &&
          typeof filter.value === 'string' &&
          value.startsWith(filter.value)
        );
      default:
        return false;
    }
  }

  /**
   * Merge search options with defaults
   */
  protected mergeOptions(options?: SearchOptions): Required<Omit<SearchOptions, 'filters'>> & {
    filters?: MetadataFilter[];
  } {
    return {
      ...DEFAULT_SEARCH_OPTIONS,
      ...options,
    };
  }

  /**
   * Add an event listener
   */
  addEventListener(event: VectorStoreEvent, callback: (data: unknown) => void): void {
    this.listeners.push({ event, callback });
  }

  /**
   * Remove an event listener
   */
  removeEventListener(event: VectorStoreEvent, callback: (data: unknown) => void): void {
    const index = this.listeners.findIndex((l) => l.event === event && l.callback === callback);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Emit an event to all listeners
   */
  protected emit(event: VectorStoreEvent, data: unknown): void {
    for (const listener of this.listeners) {
      if (listener.event === event) {
        try {
          listener.callback(data);
        } catch (error) {
          console.error(`Error in vector store event listener:`, error);
        }
      }
    }
  }

  // Abstract methods that must be implemented by subclasses

  /**
   * Initialize the vector store
   */
  abstract initialize(): Promise<void>;

  /**
   * Add a single vector entry
   */
  abstract add(entry: VectorEntry, options?: AddOptions): Promise<void>;

  /**
   * Add multiple vector entries
   */
  abstract addBatch(entries: VectorEntry[], options?: AddOptions): Promise<BatchResult>;

  /**
   * Update an existing vector entry
   */
  abstract update(id: string, entry: Partial<VectorEntry>): Promise<boolean>;

  /**
   * Delete vector entries
   */
  abstract delete(options: DeleteOptions): Promise<number>;

  /**
   * Get a vector entry by ID
   */
  abstract get(id: string): Promise<VectorEntry | null>;

  /**
   * Check if a vector entry exists
   */
  abstract exists(id: string): Promise<boolean>;

  /**
   * Search for similar vectors
   */
  abstract search(query: number[], options?: SearchOptions): Promise<VectorSearchResult[]>;

  /**
   * Get statistics about the vector store
   */
  abstract getStats(): Promise<VectorStoreStats>;

  /**
   * Clear all vectors from the store
   */
  abstract clear(): Promise<void>;

  /**
   * Close the vector store and release resources
   */
  abstract close(): Promise<void>;
}
