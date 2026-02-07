/**
 * Search Types for Supermemory Clone
 *
 * Type definitions for vector embedding and hybrid search functionality.
 */

import type { Memory } from './memory.types.js';

// Re-export Memory for convenience
export type { Memory };

/**
 * Search mode determines how results are retrieved
 */
export type SearchMode = 'vector' | 'memory' | 'fulltext' | 'hybrid';

/**
 * Metadata filters for search queries
 */
export interface MetadataFilter {
  key: string;
  value: string | number | boolean;
  operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith';
}

/**
 * Date range filter for search
 */
export interface DateRangeFilter {
  from?: Date;
  to?: Date;
}

/**
 * Search options configuration
 */
export interface SearchOptions {
  /** Search mode: vector, memory, fulltext, or hybrid (default: hybrid) */
  searchMode: SearchMode;

  /** Maximum number of results to return (default: 10) */
  limit: number;

  /** Minimum similarity threshold for results (0-1, default: 0.7) */
  threshold: number;

  /** Whether to apply cross-encoder reranking (default: false) */
  rerank: boolean;

  /** Whether to expand/rewrite query for better recall (default: false) */
  rewriteQuery: boolean;

  /** Metadata filters to apply */
  filters?: MetadataFilter[];

  /** Date range filter */
  dateRange?: DateRangeFilter;

  /** Include chunk content in results */
  includeContent?: boolean;

  /** Include embedding vectors in results (for debugging) */
  includeEmbeddings?: boolean;
}

/**
 * Default search options
 */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  searchMode: 'hybrid',
  limit: 10,
  threshold: 0.7,
  rerank: false,
  rewriteQuery: false,
  includeContent: true,
  includeEmbeddings: false,
};

/**
 * Document chunk for vector search
 */
export interface Chunk {
  id: string;
  memoryId: string;
  content: string;
  chunkIndex: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Search result item
 */
export interface SearchResult {
  /** Unique identifier */
  id: string;

  /** The memory object if from memory search */
  memory?: Memory;

  /** The chunk object if from vector search */
  chunk?: Chunk;

  /** Cosine similarity score (0-1) */
  similarity: number;

  /** Combined metadata from memory and chunk */
  metadata: Record<string, unknown>;

  /** Last update timestamp */
  updatedAt: Date;

  /** Source of the result */
  source: 'vector' | 'memory' | 'fulltext' | 'hybrid';

  /** Reranking score if reranking was applied */
  rerankScore?: number;
}

/**
 * Hybrid search response
 */
export interface SearchResponse {
  /** Search results */
  results: SearchResult[];

  /** Total count of matching items (before limit) */
  totalCount: number;

  /** Query used for search (may be rewritten) */
  query: string;

  /** Original query if rewriting was applied */
  originalQuery?: string;

  /** Time taken for search in milliseconds */
  searchTimeMs: number;

  /** Search options used */
  options: SearchOptions;
}

/**
 * Embedding model configuration
 */
export interface EmbeddingConfig {
  /** Model name (e.g., 'text-embedding-3-small') */
  model: string;

  /** Dimension of the embedding vectors */
  dimensions: number;

  /** Whether this is a local fallback model */
  isLocal: boolean;

  /** Maximum tokens per request */
  maxTokens?: number;

  /** Batch size for batch embedding */
  batchSize?: number;
}

/**
 * Embedding provider types
 */
export type EmbeddingProvider = 'openai' | 'local';

/**
 * Vector similarity metrics
 */
export type SimilarityMetric = 'cosine' | 'euclidean' | 'dotProduct';

/**
 * Reranking options
 */
export interface RerankOptions {
  /** Maximum number of results to rerank */
  topK: number;

  /** Model to use for reranking */
  model?: string;

  /** Whether to return original scores alongside rerank scores */
  returnOriginalScores?: boolean;
}

/**
 * Query rewriting options
 */
export interface QueryRewriteOptions {
  /** Number of query variations to generate */
  numVariations?: number;

  /** Whether to include synonyms */
  includeSynonyms?: boolean;

  /** Whether to expand abbreviations */
  expandAbbreviations?: boolean;

  /** Additional context for query rewriting */
  context?: string;
}

/**
 * Vector store entry for similarity search
 */
export interface VectorEntry {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

/**
 * Similarity search result from vector store
 */
export interface VectorSearchResult {
  entry: VectorEntry;
  similarity: number;
}
