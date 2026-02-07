/**
 * Vector Store Module
 *
 * Provides an abstraction layer for vector similarity search with multiple backends:
 * - InMemoryVectorStore: Fast, ephemeral storage for development/testing
 * - PgVectorStore: PostgreSQL with pgvector extension for production deployments
 * - MockVectorStore: Testing mock with configurable behavior
 *
 * Usage:
 * ```typescript
 * import { createVectorStore, VectorStoreConfig } from './vectorstore';
 *
 * const config: VectorStoreConfig = {
 *   provider: 'pgvector',
 *   dimensions: 1536,
 *   metric: 'cosine',
 * };
 *
 * const store = await createVectorStore(config);
 * await store.initialize();
 *
 * // Add vectors
 * await store.add({
 *   id: 'memory-1',
 *   embedding: [...],
 *   metadata: { containerTag: 'default' }
 * });
 *
 * // Search
 * const results = await store.search(queryEmbedding, { limit: 10 });
 * ```
 */

// Type exports
export type {
  VectorStoreProvider,
  SimilarityMetric,
  IndexType,
  FilterOperator,
  MetadataFilter,
  VectorEntry,
  SearchOptions,
  VectorSearchResult,
  AddOptions,
  DeleteOptions,
  VectorStoreConfig,
  HNSWConfig,
  VectorStoreStats,
  BatchResult,
  MigrationOptions,
  MigrationProgress,
  VectorStoreEvent,
  VectorStoreEventListener,
} from './types.js';

// Constants
export { DEFAULT_SEARCH_OPTIONS, DEFAULT_HNSW_CONFIG } from './types.js';

// Base class and utilities
export {
  BaseVectorStore,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeVector,
  validateVector,
} from './base.js';

// Implementations
export { InMemoryVectorStore, createInMemoryVectorStore } from './memory.js';
export { PgVectorStore, createPgVectorStore } from './pgvector.js';
export type { PgVectorStoreConfig } from './pgvector.js';
export { MockVectorStore, createMockVectorStore } from './mock.js';
export type { MockVectorStoreOptions, RecordedOperation } from './mock.js';

// Migration utilities
export {
  migrateMemoryToPgVector,
  migrateVectorStore as migrateVectorStores,
  verifyMigration,
  createProgressReporter,
} from './migration.js';

// Import implementations for factory
import type { VectorStoreConfig, VectorStoreProvider } from './types.js';
import { BaseVectorStore } from './base.js';
import { InMemoryVectorStore } from './memory.js';
import { getLogger } from '../../utils/logger.js';
import { ValidationError } from '../../utils/errors.js';

const logger = getLogger('VectorStoreFactory');

/**
 * Vector store constructor type that accepts a VectorStoreConfig or extended config
 * Uses any for constructor compatibility across implementations.
 */
type VectorStoreConstructor = new (
  config: VectorStoreConfig | any
) => BaseVectorStore;

/**
 * Lazy-loaded implementation loaders
 * These are functions to avoid importing optional dependencies until needed
 */
const implementationLoaders: Record<
  VectorStoreProvider,
  () => Promise<VectorStoreConstructor>
> = {
  memory: async () => InMemoryVectorStore,

  pgvector: async () => {
    try {
      const { PgVectorStore } = await import('./pgvector.js');
      return PgVectorStore;
    } catch (error) {
      logger.warn('pgvector not available, falling back to memory store', { error });
      return InMemoryVectorStore;
    }
  },
};

/**
 * Create a vector store instance based on configuration
 *
 * @param config - Vector store configuration
 * @returns Initialized vector store instance
 *
 * @example
 * ```typescript
 * const store = await createVectorStore({
 *   provider: 'sqlite-vss',
 *   dimensions: 1536,
 *   sqlitePath: './data/vectors.db',
 * });
 * await store.initialize();
 * ```
 */
export async function createVectorStore(config: VectorStoreConfig): Promise<BaseVectorStore> {
  const provider = config.provider ?? 'memory';

  logger.debug('Creating vector store', { provider, dimensions: config.dimensions });

  const loader = implementationLoaders[provider];
  if (!loader) {
    throw new ValidationError(`Unknown vector store provider: ${provider}`, {
      provider: [`Invalid provider '${provider}'. Valid providers: ${Object.keys(implementationLoaders).join(', ')}`],
    });
  }

  const StoreClass = await loader();
  return new StoreClass(config);
}

/**
 * Create and initialize a vector store in one call
 *
 * @param config - Vector store configuration
 * @returns Initialized vector store instance ready for use
 */
export async function createAndInitializeVectorStore(
  config: VectorStoreConfig
): Promise<BaseVectorStore> {
  const store = await createVectorStore(config);
  await store.initialize();
  return store;
}

// ============================================================================
// Singleton Pattern for Application-wide Vector Store
// ============================================================================

let _vectorStoreInstance: BaseVectorStore | null = null;
let _vectorStoreConfig: VectorStoreConfig | null = null;

/**
 * Configure the default vector store for the application
 *
 * Must be called before getVectorStore() if you want a non-default configuration.
 *
 * @param config - Vector store configuration
 */
export function configureVectorStore(config: VectorStoreConfig): void {
  if (_vectorStoreInstance) {
    logger.warn('Vector store already initialized, configuration will be ignored');
    return;
  }
  _vectorStoreConfig = config;
}

/**
 * Get the singleton vector store instance
 *
 * Creates a default in-memory store if not configured.
 * Call configureVectorStore() first to use a different provider.
 *
 * @returns The vector store instance (may not be initialized)
 */
export async function getVectorStore(): Promise<BaseVectorStore> {
  if (!_vectorStoreInstance) {
    const config: VectorStoreConfig = _vectorStoreConfig ?? {
      provider: 'memory',
      dimensions: 1536, // Default to OpenAI dimensions
    };
    _vectorStoreInstance = await createVectorStore(config);
  }
  return _vectorStoreInstance;
}

/**
 * Get the singleton vector store instance, ensuring it's initialized
 *
 * @returns The initialized vector store instance
 */
export async function getInitializedVectorStore(): Promise<BaseVectorStore> {
  const store = await getVectorStore();
  await store.initialize();
  return store;
}

/**
 * Reset the singleton vector store (for testing)
 */
export async function resetVectorStore(): Promise<void> {
  if (_vectorStoreInstance) {
    await _vectorStoreInstance.close();
    _vectorStoreInstance = null;
  }
  _vectorStoreConfig = null;
}

// ============================================================================
// Provider Detection
// ============================================================================

/**
 * Check which vector store providers are available
 *
 * @returns Object mapping provider names to availability status
 */
export async function getAvailableProviders(): Promise<Record<VectorStoreProvider, boolean>> {
  const results: Record<VectorStoreProvider, boolean> = {
    memory: true, // Always available
    pgvector: false,
  };

  // Check pgvector (requires pg package)
  try {
    await import('pg');
    results.pgvector = true;
  } catch {
    // Not available
  }

  return results;
}

/**
 * Get the best available provider for the current environment
 *
 * Priority: pgvector > memory (production-first approach)
 *
 * @returns The recommended provider
 */
export async function getBestProvider(): Promise<VectorStoreProvider> {
  const available = await getAvailableProviders();

  if (available.pgvector) {
    return 'pgvector';
  }

  return 'memory';
}

// ============================================================================
// Migration Support
// ============================================================================

import type { MigrationProgress, VectorEntry } from './types.js';

/**
 * Helper to get all entries from any vector store
 */
async function getAllEntriesFromStore(store: BaseVectorStore): Promise<VectorEntry[]> {
  // Check if store has getAllEntries method
  if ('getAllEntries' in store && typeof store.getAllEntries === 'function') {
    return (store as InMemoryVectorStore).getAllEntries();
  }

  // Fallback: search with very low threshold to get all vectors
  const results = await store.search(new Array(store.getDimensions()).fill(0), {
    limit: 100000,
    threshold: -1,
    includeVectors: true,
    includeMetadata: true,
  });

  return results.map((r) => ({
    id: r.id,
    embedding: r.embedding!,
    metadata: r.metadata,
  }));
}

/**
 * Migrate vectors between stores
 *
 * @param source - Source vector store
 * @param target - Target vector store
 * @param options - Migration options
 * @returns Final migration progress
 */
export async function migrateVectorStore(
  source: BaseVectorStore,
  target: BaseVectorStore,
  options?: {
    batchSize?: number;
    onProgress?: (progress: MigrationProgress) => void;
  }
): Promise<MigrationProgress> {
  const batchSize = options?.batchSize ?? 100;
  const entries = await getAllEntriesFromStore(source);
  const total = entries.length;
  const totalBatches = Math.ceil(total / batchSize);

  const progress: MigrationProgress = {
    total,
    migrated: 0,
    percentage: 0,
    currentBatch: 0,
    totalBatches,
  };

  if (total === 0) {
    progress.percentage = 100;
    return progress;
  }

  const startTime = Date.now();

  for (let i = 0; i < entries.length; i += batchSize) {
    progress.currentBatch++;
    const batch = entries.slice(i, i + batchSize);

    await target.addBatch(batch, { overwrite: true });

    progress.migrated += batch.length;
    progress.percentage = Math.round((progress.migrated / total) * 100);

    const elapsed = Date.now() - startTime;
    const rate = progress.migrated / (elapsed / 1000);
    const remaining = total - progress.migrated;
    progress.estimatedTimeRemaining = remaining > 0 ? Math.round(remaining / rate) : 0;

    if (options?.onProgress) {
      options.onProgress(progress);
    }
  }

  return progress;
}

/**
 * Re-index all vectors in a store with new embeddings
 *
 * @param store - Vector store to re-index
 * @param generateEmbedding - Function to generate new embeddings
 * @param getContent - Function to get content for an ID
 * @param options - Re-indexing options
 * @returns Final progress
 */
export async function reindexVectorStore(
  store: BaseVectorStore,
  generateEmbedding: (id: string, content: string) => Promise<number[]>,
  getContent: (id: string) => Promise<string | null>,
  options?: {
    batchSize?: number;
    onProgress?: (progress: MigrationProgress) => void;
  }
): Promise<MigrationProgress> {
  const batchSize = options?.batchSize ?? 50;
  const entries = await getAllEntriesFromStore(store);
  const total = entries.length;
  const totalBatches = Math.ceil(total / batchSize);

  const progress: MigrationProgress = {
    total,
    migrated: 0,
    percentage: 0,
    currentBatch: 0,
    totalBatches,
  };

  if (total === 0) {
    progress.percentage = 100;
    return progress;
  }

  const startTime = Date.now();

  for (let i = 0; i < entries.length; i += batchSize) {
    progress.currentBatch++;
    const batch = entries.slice(i, i + batchSize);

    for (const entry of batch) {
      const content = await getContent(entry.id);
      if (content) {
        const embedding = await generateEmbedding(entry.id, content);
        await store.update(entry.id, { embedding });
      }
      progress.migrated++;
    }

    progress.percentage = Math.round((progress.migrated / total) * 100);

    const elapsed = Date.now() - startTime;
    const rate = progress.migrated / (elapsed / 1000);
    const remaining = total - progress.migrated;
    progress.estimatedTimeRemaining = remaining > 0 ? Math.round(remaining / rate) : 0;

    if (options?.onProgress) {
      options.onProgress(progress);
    }
  }

  return progress;
}

/**
 * Get default vector store configuration from environment
 */
export function getDefaultVectorStoreConfig(): VectorStoreConfig {
  const provider = (process.env.VECTOR_STORE_PROVIDER as VectorStoreProvider) ?? 'memory';
  const dimensions = parseInt(process.env.VECTOR_DIMENSIONS ?? '1536', 10);

  const config: VectorStoreConfig = {
    provider,
    dimensions,
    metric: 'cosine',
    indexType: provider === 'pgvector' ? 'hnsw' : 'flat',
    defaultNamespace: 'default',
  };

  if (provider === 'pgvector') {
    config.hnswConfig = {
      M: parseInt(process.env.PGVECTOR_HNSW_M ?? '16', 10),
      efConstruction: parseInt(process.env.PGVECTOR_HNSW_EF_CONSTRUCTION ?? '64', 10),
    };
  }

  return config;
}
