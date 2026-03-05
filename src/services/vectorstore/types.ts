/**
 * Vector Store Types
 *
 * Type definitions for vector similarity search functionality.
 * These types are designed to be provider-agnostic, supporting
 * in-memory, SQLite-VSS, Chroma, and other vector stores.
 */

/**
 * Supported vector store providers
 */
export type VectorStoreProvider = 'memory' | 'pgvector'

/**
 * Similarity metrics for vector comparison
 */
export type SimilarityMetric = 'cosine' | 'euclidean' | 'dot_product'

/**
 * Index types for vector search optimization
 */
export type IndexType = 'flat' | 'hnsw' | 'ivf'

/**
 * Metadata filter operators
 */
export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'startsWith'

/**
 * Metadata filter for search queries
 */
export interface MetadataFilter {
  /** Field name to filter on */
  key: string
  /** Filter operator */
  operator: FilterOperator
  /** Value to compare against */
  value: string | number | boolean | Array<string | number>
}

/**
 * Vector entry for storage and retrieval
 */
export interface VectorEntry {
  /** Unique identifier */
  id: string
  /** Vector embedding */
  embedding: number[]
  /** Associated metadata */
  metadata: Record<string, unknown>
  /** Timestamp of creation */
  createdAt?: Date
  /** Timestamp of last update */
  updatedAt?: Date
}

/**
 * Options for vector search
 */
export interface SearchOptions {
  /** Maximum number of results to return */
  limit?: number
  /** Minimum similarity threshold (0-1 for cosine, varies for others) */
  threshold?: number
  /** Metadata filters to apply */
  filters?: MetadataFilter[]
  /** Whether to include vectors in results */
  includeVectors?: boolean
  /** Whether to include metadata in results */
  includeMetadata?: boolean
}

/**
 * Default search options
 */
export const DEFAULT_SEARCH_OPTIONS: Required<Omit<SearchOptions, 'filters'>> & {
  filters?: MetadataFilter[]
} = {
  limit: 10,
  threshold: 0.7,
  includeVectors: false,
  includeMetadata: true,
}

/**
 * Result from a vector similarity search
 */
export interface VectorSearchResult {
  /** Unique identifier */
  id: string
  /** Similarity score */
  score: number
  /** Vector embedding (if requested) */
  embedding?: number[]
  /** Associated metadata */
  metadata: Record<string, unknown>
  /** Distance (if using distance metric) */
  distance?: number
}

/**
 * Options for adding vectors
 */
export interface AddOptions {
  /** Whether to overwrite existing entries with same ID */
  overwrite?: boolean
  /** Namespace/collection for the vector */
  namespace?: string
}

/**
 * Options for deleting vectors
 */
export interface DeleteOptions {
  /** Delete by IDs */
  ids?: string[]
  /** Delete by metadata filter */
  filter?: MetadataFilter
  /** Delete all vectors in namespace */
  deleteAll?: boolean
  /** Namespace/collection to delete from */
  namespace?: string
}

/**
 * Vector store configuration
 */
export interface VectorStoreConfig {
  /** Store provider type */
  provider: VectorStoreProvider
  /** Vector dimensions */
  dimensions: number
  /** Similarity metric to use */
  metric?: SimilarityMetric
  /** Index type for optimization */
  indexType?: IndexType
  /** Default namespace */
  defaultNamespace?: string

  // Provider-specific options
  /** SQLite database path (for sqlite-vss) */
  sqlitePath?: string
  /** Chroma server URL (for chroma) */
  chromaUrl?: string
  /** Chroma collection name (for chroma) */
  chromaCollection?: string
  /** HNSW parameters */
  hnswConfig?: HNSWConfig
}

/**
 * HNSW index configuration
 */
export interface HNSWConfig {
  /** Maximum number of connections per node */
  M?: number
  /** Size of dynamic candidate list during construction */
  efConstruction?: number
  /** Size of dynamic candidate list during search */
  efSearch?: number
}

/**
 * Default HNSW configuration
 */
export const DEFAULT_HNSW_CONFIG: Required<HNSWConfig> = {
  M: 16,
  efConstruction: 200,
  efSearch: 50,
}

/**
 * Vector store statistics
 */
export interface VectorStoreStats {
  /** Total number of vectors stored */
  totalVectors: number
  /** Vector dimensions */
  dimensions: number
  /** Index type being used */
  indexType: IndexType
  /** Similarity metric being used */
  metric: SimilarityMetric
  /** Memory usage in bytes (if available) */
  memoryUsageBytes?: number
  /** Index build status */
  indexBuilt: boolean
  /** Namespaces/collections available */
  namespaces?: string[]
}

/**
 * Batch operation result
 */
export interface BatchResult {
  /** Number of successful operations */
  successful: number
  /** Number of failed operations */
  failed: number
  /** Error messages for failed operations */
  errors?: Array<{ id: string; error: string }>
}

/**
 * Migration options for moving between vector stores
 */
export interface MigrationOptions {
  /** Source vector store */
  source: VectorStoreProvider
  /** Target vector store */
  target: VectorStoreProvider
  /** Batch size for migration */
  batchSize?: number
  /** Progress callback */
  onProgress?: (progress: MigrationProgress) => void
}

/**
 * Migration progress information
 */
export interface MigrationProgress {
  /** Total vectors to migrate */
  total: number
  /** Vectors migrated so far */
  migrated: number
  /** Percentage complete */
  percentage: number
  /** Current batch number */
  currentBatch: number
  /** Total batches */
  totalBatches: number
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number
}

/**
 * Vector store event types
 */
export type VectorStoreEvent = 'add' | 'update' | 'delete' | 'search' | 'index_built' | 'index_rebuilt' | 'error'

/**
 * Vector store event listener
 */
export interface VectorStoreEventListener {
  event: VectorStoreEvent
  callback: (data: unknown) => void
}
