/**
 * Search Service for Supermemory Clone
 *
 * Provides hybrid search combining vector similarity and memory graph search
 * with reranking and query rewriting capabilities.
 */

import { EmbeddingService, createEmbeddingService } from './embedding.service.js';
import {
  SearchOptions,
  SearchResult,
  SearchResponse,
  Memory,
  Chunk,
  MetadataFilter,
  DEFAULT_SEARCH_OPTIONS,
  RerankOptions,
  QueryRewriteOptions,
} from './search.types.js';
import {
  BaseVectorStore,
  createVectorStore,
  createPgVectorStore,
  createInMemoryVectorStore,
  getDefaultVectorStoreConfig,
  VectorStoreConfig,
  VectorSearchResult as VectorStoreSearchResult,
} from './vectorstore/index.js';
import { expandQuery } from '../utils/synonyms.js';
import { getDatabaseUrl, isPostgresUrl } from '../db/client.js';
import { getPostgresDatabase } from '../db/postgres.js';
import { documents } from '../db/schema/documents.schema.js';
import { and, desc, eq, sql } from 'drizzle-orm';

/**
 * Internal result type for compatibility with search types
 */
interface InternalVectorSearchResult {
  entry: {
    id: string;
    embedding: number[];
    metadata: Record<string, unknown>;
  };
  similarity: number;
}

/**
 * In-memory memory graph for development/testing
 */
class InMemoryMemoryGraph {
  private memories: Map<string, Memory> = new Map();
  private chunksByMemoryId: Map<string, Chunk[]> = new Map();

  addMemory(memory: Memory): void {
    this.memories.set(memory.id, memory);
  }

  addChunk(chunk: Chunk): void {
    const chunks = this.chunksByMemoryId.get(chunk.memoryId) || [];
    chunks.push(chunk);
    this.chunksByMemoryId.set(chunk.memoryId, chunks);
  }

  getMemory(id: string): Memory | undefined {
    return this.memories.get(id);
  }

  getChunks(memoryId: string): Chunk[] {
    return this.chunksByMemoryId.get(memoryId) || [];
  }

  getAllMemories(): Memory[] {
    return Array.from(this.memories.values());
  }

  searchByTag(containerTag: string): Memory[] {
    return Array.from(this.memories.values()).filter((m) => m.containerTag === containerTag);
  }

  searchByContent(query: string): Memory[] {
    const lowerQuery = query.toLowerCase();
    const tokens = lowerQuery.split(/\s+/).filter((t) => t.length > 0);

    return Array.from(this.memories.values())
      .map((memory) => {
        const content = memory.content.toLowerCase();
        const matchCount = tokens.filter((token) => content.includes(token)).length;
        const score = matchCount / tokens.length;
        return { memory, score };
      })
      .filter(({ score }) => score > 0.3)
      .sort((a, b) => b.score - a.score)
      .map(({ memory }) => memory);
  }

  clear(): void {
    this.memories.clear();
    this.chunksByMemoryId.clear();
  }
}

/**
 * Search Service class
 */
export class SearchService {
  private readonly embeddingService: EmbeddingService;
  private vectorStore: BaseVectorStore;
  private readonly memoryGraph: InMemoryMemoryGraph;
  private initialized = false;

  constructor(options?: { embeddingService?: EmbeddingService; vectorStore?: BaseVectorStore }) {
    this.embeddingService = options?.embeddingService || createEmbeddingService();
    // Default to pgvector-backed store for runtime usage
    const connectionString = getDatabaseUrl();
    const defaultConfig = getDefaultVectorStoreConfig();
    let vectorStore = options?.vectorStore;
    if (!vectorStore) {
      const useInMemory = process.env.NODE_ENV === 'test' || !isPostgresUrl(connectionString);
      if (!useInMemory) {
        vectorStore = createPgVectorStore(connectionString, this.embeddingService.getDimensions(), {
          metric: defaultConfig.metric,
          hnswConfig: defaultConfig.hnswConfig,
          defaultNamespace: defaultConfig.defaultNamespace,
          indexType: defaultConfig.indexType,
        });
      } else {
        vectorStore = createInMemoryVectorStore(this.embeddingService.getDimensions(), {
          metric: defaultConfig.metric,
          hnswConfig: defaultConfig.hnswConfig,
          defaultNamespace: defaultConfig.defaultNamespace,
          indexType: defaultConfig.indexType,
        });
      }
    }
    this.vectorStore = vectorStore;
    this.memoryGraph = new InMemoryMemoryGraph();
  }

  /**
   * Initialize the search service (initializes vector store)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.vectorStore.initialize();
    this.initialized = true;
  }

  /**
   * Set a custom vector store (useful for testing or changing providers)
   */
  setVectorStore(vectorStore: BaseVectorStore): void {
    this.vectorStore = vectorStore;
    this.initialized = false;
  }

  /**
   * Get the vector store
   */
  getVectorStore(): BaseVectorStore {
    return this.vectorStore;
  }

  /**
   * Get the embedding service
   */
  getEmbeddingService(): EmbeddingService {
    return this.embeddingService;
  }

  /**
   * Index a memory and its chunks
   */
  async indexMemory(memory: Memory, chunks?: Chunk[]): Promise<void> {
    // Ensure vector store is initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // Generate embedding for memory if not provided
    if (!memory.embedding) {
      memory.embedding = await this.embeddingService.generateEmbedding(memory.content);
    }

    // Add to memory graph
    this.memoryGraph.addMemory(memory);

    // Add to vector store
    await this.vectorStore.add(
      {
        id: memory.id,
        embedding: memory.embedding,
        metadata: {
          type: 'memory',
          containerTag: memory.containerTag,
          ...memory.metadata,
        },
      },
      { overwrite: true }
    );

    // Index chunks if provided
    if (chunks && chunks.length > 0) {
      const chunkTexts = chunks.map((c) => c.content);
      const chunkEmbeddings = await this.embeddingService.batchEmbed(chunkTexts);

      const vectorEntries = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = chunkEmbeddings[i];
        if (!chunk || !embedding) continue;

        chunk.embedding = embedding;

        this.memoryGraph.addChunk(chunk);
        vectorEntries.push({
          id: chunk.id,
          embedding: embedding,
          metadata: {
            type: 'chunk',
            memoryId: chunk.memoryId,
            chunkIndex: chunk.chunkIndex,
            ...chunk.metadata,
          },
        });
      }

      // Batch add chunks to vector store
      if (vectorEntries.length > 0) {
        await this.vectorStore.addBatch(vectorEntries, { overwrite: true });
      }
    }
  }

  /**
   * Perform hybrid search combining vector and memory graph search
   */
  async hybridSearch(
    query: string,
    containerTag?: string,
    options?: Partial<SearchOptions>
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    const searchOptions: SearchOptions = { ...DEFAULT_SEARCH_OPTIONS, ...options };

    let searchQuery = query;
    let originalQuery: string | undefined;

    // Rewrite query if enabled
    if (searchOptions.rewriteQuery) {
      originalQuery = query;
      searchQuery = await this.rewriteQuery(query);
    }

    let results: SearchResult[] = [];

    switch (searchOptions.searchMode) {
      case 'vector':
        results = await this.vectorSearchInternal(searchQuery, searchOptions);
        break;
      case 'memory':
        results = this.memorySearchInternal(searchQuery, containerTag, searchOptions);
        break;
      case 'fulltext':
        results = await this.fullTextSearchInternal(searchQuery, containerTag, searchOptions);
        break;
      case 'hybrid':
      default:
        results = await this.combineSearchResults(searchQuery, containerTag, searchOptions);
        break;
    }

    // Apply container tag filter
    if (containerTag) {
      results = results.filter((r) => {
        if (r.memory) return r.memory.containerTag === containerTag;
        if (r.chunk) {
          const memory = this.memoryGraph.getMemory(r.chunk.memoryId);
          return memory?.containerTag === containerTag;
        }
        return false;
      });
    }

    // Apply metadata filters
    if (searchOptions.filters && searchOptions.filters.length > 0) {
      results = this.applyFilters(results, searchOptions.filters);
    }

    // Apply date range filter
    if (searchOptions.dateRange) {
      results = this.applyDateFilter(results, searchOptions.dateRange);
    }

    // Rerank if enabled
    if (searchOptions.rerank && results.length > 1) {
      results = await this.rerank(results, searchQuery);
    }

    // Sort by similarity (or rerank score if available)
    results.sort((a, b) => {
      const scoreA = a.rerankScore ?? a.similarity;
      const scoreB = b.rerankScore ?? b.similarity;
      return scoreB - scoreA;
    });

    // Apply limit
    const totalCount = results.length;
    results = results.slice(0, searchOptions.limit);

    // Remove embeddings if not requested
    if (!searchOptions.includeEmbeddings) {
      results = results.map((r) => ({
        ...r,
        memory: r.memory ? { ...r.memory, embedding: undefined } : undefined,
        chunk: r.chunk ? { ...r.chunk, embedding: undefined } : undefined,
      }));
    }

    const searchTimeMs = Date.now() - startTime;

    return {
      results,
      totalCount,
      query: searchQuery,
      originalQuery,
      searchTimeMs,
      options: searchOptions,
    };
  }

  /**
   * Pure vector similarity search
   */
  async vectorSearch(
    embedding: number[],
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<SearchResult[]> {
    // Ensure vector store is initialized
    if (!this.initialized) {
      await this.initialize();
    }

    const vectorResults = await this.vectorStore.search(embedding, {
      limit,
      threshold,
      includeMetadata: true,
    });

    return vectorResults.map((vr) => this.vectorStoreResultToSearchResult(vr));
  }

  /**
   * Search through memory graph
   */
  memorySearch(query: string, containerTag?: string): SearchResult[] {
    return this.memorySearchInternal(query, containerTag, DEFAULT_SEARCH_OPTIONS);
  }

  /**
   * Rerank results using cross-encoder scoring
   * Note: In production, this would use a proper cross-encoder model
   */
  async rerank(
    results: SearchResult[],
    query: string,
    options?: RerankOptions
  ): Promise<SearchResult[]> {
    const topK = options?.topK || results.length;
    const toRerank = results.slice(0, topK);

    // Simple reranking based on query term overlap and position
    // In production, use a proper cross-encoder model
    const queryTokens = new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1)
    );

    const reranked = toRerank.map((result) => {
      const content = (result.memory?.content || result.chunk?.content || '').toLowerCase();
      const contentTokens = content.split(/\s+/);

      const score = result.similarity;
      let matchCount = 0;
      let positionBoost = 0;

      for (let i = 0; i < contentTokens.length; i++) {
        const token = contentTokens[i];
        if (token && queryTokens.has(token)) {
          matchCount++;
          // Boost for matches early in content
          positionBoost += 1 / (1 + i * 0.01);
        }
      }

      // Combine original similarity with reranking factors
      const termOverlap = matchCount / queryTokens.size;
      const rerankScore = score * 0.5 + termOverlap * 0.3 + positionBoost * 0.2;

      return {
        ...result,
        rerankScore: Math.min(1, rerankScore),
      };
    });

    // Sort by rerank score
    reranked.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));

    // Combine with remaining results
    return [...reranked, ...results.slice(topK)];
  }

  /**
   * Expand/rewrite query for better recall.
   *
   * Uses the shared synonyms utility for consistent expansion across services.
   * In production, this would be augmented with an LLM for intelligent query rewriting.
   */
  async rewriteQuery(query: string, options?: QueryRewriteOptions): Promise<string> {
    return expandQuery(query, {
      includeSynonyms: options?.includeSynonyms !== false,
      expandAbbreviations: options?.expandAbbreviations !== false,
      maxSynonymsPerTerm: 2,
    });
  }

  /**
   * Clear all indexed data
   */
  async clear(): Promise<void> {
    await this.vectorStore.clear();
    this.memoryGraph.clear();
  }

  /**
   * Get statistics about indexed data
   */
  async getStats(): Promise<{ vectorCount: number; memoryCount: number }> {
    const stats = await this.vectorStore.getStats();
    return {
      vectorCount: stats.totalVectors,
      memoryCount: this.memoryGraph.getAllMemories().length,
    };
  }

  /**
   * Remove a memory from the index
   */
  async removeMemory(memoryId: string): Promise<boolean> {
    // Remove from vector store
    const deleted = await this.vectorStore.delete({ ids: [memoryId] });

    // Also remove any chunks associated with this memory
    const chunks = this.memoryGraph.getChunks(memoryId);
    if (chunks.length > 0) {
      const chunkIds = chunks.map((c) => c.id);
      await this.vectorStore.delete({ ids: chunkIds });
    }

    return deleted > 0;
  }

  // Private methods

  private async vectorSearchInternal(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    // Ensure vector store is initialized
    if (!this.initialized) {
      await this.initialize();
    }

    const queryEmbedding = await this.embeddingService.generateEmbedding(query);
    const vectorResults = await this.vectorStore.search(queryEmbedding, {
      limit: options.limit * 2, // Get more to allow for filtering
      threshold: options.threshold,
      includeMetadata: true,
    });

    return vectorResults.map((vr) => this.vectorStoreResultToSearchResult(vr));
  }

  private memorySearchInternal(
    query: string,
    containerTag: string | undefined,
    options: SearchOptions
  ): SearchResult[] {
    let memories: Memory[];

    if (containerTag) {
      memories = this.memoryGraph.searchByTag(containerTag);
      // Further filter by content
      const lowerQuery = query.toLowerCase();
      memories = memories.filter((m) => m.content.toLowerCase().includes(lowerQuery));
    } else {
      memories = this.memoryGraph.searchByContent(query);
    }

    return memories.slice(0, options.limit).map((memory, index) => ({
      id: memory.id,
      memory,
      similarity: 1 - index * 0.05, // Decay based on position
      metadata: memory.metadata || {},
      updatedAt: memory.updatedAt,
      source: 'memory' as const,
    }));
  }

  private async combineSearchResults(
    query: string,
    containerTag: string | undefined,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    // Run vector + full-text searches.
    const [vectorResults, fullTextResults] = await Promise.all([
      this.vectorSearchInternal(query, options),
      this.fullTextSearchInternal(query, containerTag, options),
    ]);

    // Merge and deduplicate
    const resultMap = new Map<string, SearchResult>();

    // Add vector results first (higher priority for similarity)
    for (const result of vectorResults) {
      resultMap.set(result.id, result);
    }

    // Add full-text results, merging if exists
    for (const result of fullTextResults) {
      const existing = resultMap.get(result.id);
      if (existing) {
        // Combine scores - keep higher similarity, mark as hybrid
        resultMap.set(result.id, {
          ...existing,
          similarity: Math.max(existing.similarity, result.similarity),
          source: 'hybrid',
        });
      } else {
        resultMap.set(result.id, result);
      }
    }

    return Array.from(resultMap.values());
  }

  private async fullTextSearchInternal(
    query: string,
    containerTag: string | undefined,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const connectionString = getDatabaseUrl();

    // Keep test behavior deterministic by using in-memory fallback.
    if (process.env.NODE_ENV === 'test' || !isPostgresUrl(connectionString)) {
      return this.memorySearchInternal(query, containerTag, options);
    }

    const db = getPostgresDatabase(connectionString);
    const rankExpr = sql<number>`
      ts_rank_cd(
        to_tsvector('english', ${documents.content}),
        plainto_tsquery('english', ${query})
      )
    `;

    const textMatch = sql<boolean>`
      to_tsvector('english', ${documents.content})
      @@
      plainto_tsquery('english', ${query})
    `;
    const whereClause = containerTag
      ? and(textMatch, eq(documents.containerTag, containerTag))
      : textMatch;

    const rows = await db
      .select({
        id: documents.id,
        content: documents.content,
        containerTag: documents.containerTag,
        metadata: documents.metadata,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        rank: rankExpr,
      })
      .from(documents)
      .where(whereClause)
      .orderBy(desc(rankExpr), desc(documents.updatedAt))
      .limit(options.limit * 2);

    return rows.map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {};
      const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
      const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
      const score = Math.max(0, Math.min(1, Number(row.rank ?? 0)));

      return {
        id: row.id,
        memory: {
          id: row.id,
          content: row.content,
          type: 'fact',
          relationships: [],
          isLatest: true,
          containerTag: row.containerTag,
          metadata,
          createdAt,
          updatedAt,
          confidence: 1,
          sourceId: row.id,
        },
        similarity: score,
        metadata,
        updatedAt,
        source: 'fulltext',
      };
    });
  }

  private vectorResultToSearchResult(vr: InternalVectorSearchResult): SearchResult {
    const isChunk = vr.entry.metadata.type === 'chunk';
    const memoryId = isChunk ? (vr.entry.metadata.memoryId as string) : vr.entry.id;

    const memory = this.memoryGraph.getMemory(memoryId);
    const chunk = isChunk
      ? this.memoryGraph.getChunks(memoryId).find((c) => c.id === vr.entry.id)
      : undefined;

    return {
      id: vr.entry.id,
      memory,
      chunk,
      similarity: vr.similarity,
      metadata: { ...vr.entry.metadata, ...(memory?.metadata || {}) },
      updatedAt: memory?.updatedAt || new Date(),
      source: 'vector',
    };
  }

  /**
   * Convert VectorStoreSearchResult to SearchResult
   */
  private vectorStoreResultToSearchResult(vr: VectorStoreSearchResult): SearchResult {
    const isChunk = vr.metadata.type === 'chunk';
    const memoryId = isChunk ? (vr.metadata.memoryId as string) : vr.id;

    const memory = this.memoryGraph.getMemory(memoryId);
    const chunk = isChunk
      ? this.memoryGraph.getChunks(memoryId).find((c) => c.id === vr.id)
      : undefined;

    return {
      id: vr.id,
      memory,
      chunk,
      similarity: vr.score,
      metadata: { ...vr.metadata, ...(memory?.metadata || {}) },
      updatedAt: memory?.updatedAt || new Date(),
      source: 'vector',
    };
  }

  private applyFilters(results: SearchResult[], filters: MetadataFilter[]): SearchResult[] {
    return results.filter((result) => {
      const metadata = result.metadata;
      return filters.every((filter) => {
        const value = metadata[filter.key];
        if (value === undefined) return false;

        const op = filter.operator || 'eq';
        switch (op) {
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
      });
    });
  }

  private applyDateFilter(
    results: SearchResult[],
    dateRange: { from?: Date; to?: Date }
  ): SearchResult[] {
    return results.filter((result) => {
      const date = result.updatedAt;
      if (dateRange.from && date < dateRange.from) return false;
      if (dateRange.to && date > dateRange.to) return false;
      return true;
    });
  }
}

/**
 * Create a new search service instance
 */
export function createSearchService(options?: {
  embeddingService?: EmbeddingService;
  vectorStore?: BaseVectorStore;
}): SearchService {
  return new SearchService(options);
}

/**
 * Create a search service with a specific vector store provider
 */
export async function createSearchServiceWithVectorStore(
  vectorStoreConfig: VectorStoreConfig,
  embeddingService?: EmbeddingService
): Promise<SearchService> {
  const vectorStore = await createVectorStore(vectorStoreConfig);
  await vectorStore.initialize();

  const service = new SearchService({
    embeddingService,
    vectorStore,
  });

  // Mark as initialized since vector store is already initialized
  await service.initialize();

  return service;
}

// Lazy singleton instance
let _searchService: SearchService | null = null;

/**
 * Get the singleton search service instance (created lazily)
 */
export function getSearchService(): SearchService {
  if (!_searchService) {
    _searchService = new SearchService();
  }
  return _searchService;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetSearchService(): void {
  _searchService = null;
}

// Export default instance (lazy getter for backwards compatibility)
export const searchService = new Proxy({} as SearchService, {
  get(_, prop) {
    return getSearchService()[prop as keyof SearchService];
  },
});
