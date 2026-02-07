# ADR-001: Vector Similarity Search Architecture

**Status:** Implemented
**Date:** 2026-02-01
**Author:** System Architecture Designer
**Last Updated:** 2026-02-01

## Context

The current supermemory-clone implementation uses substring matching in `memory.repository.ts:semanticSearch()` (lines 316-345) which provides poor semantic understanding. The codebase already has:

1. **EmbeddingService** (`src/services/embedding.service.ts`) - Generates embeddings via OpenAI text-embedding-3-small (1536 dims) with TF-IDF fallback (384 dims)
2. **InMemoryVectorStore** (`src/services/search.service.ts:28-120`) - Basic in-memory vector storage with cosine similarity
3. **Database Schema** (`src/db/schema.ts`) - SQLite with Drizzle ORM, already has `embeddings` table storing vectors as binary blobs

The goal is to create an abstracted vector store layer that:
- Supports multiple backends (in-memory, sqlite-vss, Chroma, Pinecone)
- Integrates seamlessly with existing services
- Prioritizes sqlite-vss for local-first experience
- Enables migration from current implementation

## Decision

We will implement a **Strategy Pattern** for vector storage with the following architecture:

### 1. Core Abstraction Layer

```
src/services/vectorstore/
  index.ts           # Main exports and factory
  types.ts           # Interface definitions
  base.ts            # Abstract base class with common logic
  implementations/
    memory.ts        # InMemoryVectorStore (current behavior)
    sqlite-vss.ts    # SQLite VSS extension
    chroma.ts        # ChromaDB client
    pinecone.ts      # Pinecone client
    mock.ts          # Testing mock
```

### 2. Type Definitions (`types.ts`)

```typescript
/**
 * Distance/similarity metrics for vector search
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dotProduct';

/**
 * Vector store provider types
 */
export type VectorStoreProvider = 'memory' | 'sqlite-vss' | 'chroma' | 'pinecone' | 'mock';

/**
 * Configuration for vector store initialization
 */
export interface VectorStoreConfig {
  /** Storage provider to use */
  provider: VectorStoreProvider;

  /** Vector dimensions (must match embedding model) */
  dimensions: number;

  /** Distance metric for similarity calculation */
  distanceMetric: DistanceMetric;

  /** Provider-specific connection settings */
  connection?: {
    /** Database path for sqlite-vss */
    databasePath?: string;

    /** API endpoint for remote stores (Chroma, Pinecone) */
    endpoint?: string;

    /** API key for authenticated providers */
    apiKey?: string;

    /** Namespace/collection name */
    namespace?: string;
  };

  /** Performance tuning */
  performance?: {
    /** Enable HNSW indexing (where supported) */
    useHNSW?: boolean;

    /** HNSW M parameter (connections per layer) */
    hnswM?: number;

    /** HNSW efConstruction (index build quality) */
    hnswEfConstruction?: number;

    /** Batch size for bulk operations */
    batchSize?: number;
  };
}

/**
 * Metadata for a vector entry
 */
export interface VectorMetadata {
  /** Memory or chunk ID reference */
  sourceId: string;

  /** Type: 'memory' | 'chunk' */
  sourceType: 'memory' | 'chunk';

  /** Container tag for filtering */
  containerTag?: string;

  /** Memory type for filtering */
  memoryType?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Additional custom metadata */
  [key: string]: unknown;
}

/**
 * Options for vector search operations
 */
export interface VectorSearchOptions {
  /** Maximum results to return */
  limit?: number;

  /** Minimum similarity threshold (0-1 for cosine) */
  threshold?: number;

  /** Offset for pagination */
  offset?: number;

  /** Metadata filters */
  filters?: VectorMetadataFilter[];

  /** Include vector in results (expensive) */
  includeVectors?: boolean;
}

/**
 * Filter conditions for metadata
 */
export interface VectorMetadataFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: unknown;
}

/**
 * Search result from vector store
 */
export interface VectorSearchResult {
  /** Unique vector ID */
  id: string;

  /** Similarity/distance score */
  score: number;

  /** Associated metadata */
  metadata: VectorMetadata;

  /** Vector embedding (if includeVectors=true) */
  vector?: number[];
}

/**
 * Statistics about the vector store
 */
export interface VectorStoreStats {
  /** Total vectors stored */
  totalVectors: number;

  /** Vector dimensions */
  dimensions: number;

  /** Provider name */
  provider: VectorStoreProvider;

  /** Index status */
  indexStatus: 'none' | 'building' | 'ready';

  /** Storage size in bytes (if available) */
  storageSizeBytes?: number;
}

/**
 * Core vector store interface
 */
export interface VectorStore {
  /**
   * Upsert a single vector
   */
  upsert(
    id: string,
    embedding: number[],
    metadata: VectorMetadata
  ): Promise<void>;

  /**
   * Upsert multiple vectors in batch
   */
  upsertBatch(
    entries: Array<{
      id: string;
      embedding: number[];
      metadata: VectorMetadata;
    }>
  ): Promise<void>;

  /**
   * Search for similar vectors
   */
  search(
    queryEmbedding: number[],
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult[]>;

  /**
   * Delete a vector by ID
   */
  delete(id: string): Promise<boolean>;

  /**
   * Delete multiple vectors by ID
   */
  deleteBatch(ids: string[]): Promise<number>;

  /**
   * Delete vectors matching metadata filter
   */
  deleteByFilter(filters: VectorMetadataFilter[]): Promise<number>;

  /**
   * Get a vector by ID
   */
  get(id: string): Promise<VectorSearchResult | null>;

  /**
   * Check if vector exists
   */
  exists(id: string): Promise<boolean>;

  /**
   * Clear all vectors
   */
  clear(): Promise<void>;

  /**
   * Get store statistics
   */
  getStats(): Promise<VectorStoreStats>;

  /**
   * Initialize/connect to the store
   */
  initialize(): Promise<void>;

  /**
   * Graceful shutdown
   */
  close(): Promise<void>;
}
```

### 3. Component Diagram (C4 Level 2)

```
+------------------------------------------------------------------+
|                        Search Service                             |
|  (src/services/search.service.ts)                                 |
+------------------------------------------------------------------+
          |                    |                    |
          v                    v                    v
+------------------+  +------------------+  +------------------+
| EmbeddingService |  |   VectorStore    |  |   MemoryGraph    |
| (generates       |  |   (abstract)     |  |   (relationship  |
|  embeddings)     |  |                  |  |    traversal)    |
+------------------+  +------------------+  +------------------+
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
+------------------+  +------------------+  +------------------+
| InMemoryVector   |  | SQLiteVSS        |  | ChromaVector     |
| Store            |  | VectorStore      |  | Store            |
| (development)    |  | (local-first)    |  | (production)     |
+------------------+  +------------------+  +------------------+
          |                   |
          |                   v
          |           +------------------+
          |           | better-sqlite3   |
          |           | + sqlite-vss     |
          |           | extension        |
          |           +------------------+
          |
          +---> Pinecone (cloud deployment)
```

### 4. SQLite-VSS Implementation (Priority)

SQLite-VSS is the recommended local-first solution because:
- Uses existing SQLite infrastructure (better-sqlite3 already in dependencies)
- No additional server processes required
- HNSW indexing for fast ANN search
- Persists vectors alongside metadata

**Schema Addition:**
```sql
-- Virtual table for vector search (sqlite-vss)
CREATE VIRTUAL TABLE IF NOT EXISTS vss_vectors USING vss0(
  embedding(1536)  -- or 384 for local embeddings
);

-- Mapping table linking vss rowid to our IDs
CREATE TABLE IF NOT EXISTS vector_mapping (
  id TEXT PRIMARY KEY,
  vss_rowid INTEGER NOT NULL,
  source_type TEXT NOT NULL,  -- 'memory' | 'chunk'
  source_id TEXT NOT NULL,
  container_tag TEXT,
  memory_type TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT  -- JSON for additional fields
);

CREATE INDEX idx_vector_mapping_source ON vector_mapping(source_type, source_id);
CREATE INDEX idx_vector_mapping_container ON vector_mapping(container_tag);
```

**Implementation Approach:**
```typescript
// src/services/vectorstore/implementations/sqlite-vss.ts

export class SQLiteVSSVectorStore implements VectorStore {
  private db: Database;
  private initialized = false;

  constructor(private config: VectorStoreConfig) {}

  async initialize(): Promise<void> {
    // Load sqlite-vss extension
    this.db.loadExtension('vss0');

    // Create virtual table if not exists
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vss_vectors
      USING vss0(embedding(${this.config.dimensions}));
    `);

    // Create mapping table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_mapping (
        id TEXT PRIMARY KEY,
        vss_rowid INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        container_tag TEXT,
        memory_type TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      );
    `);

    this.initialized = true;
  }

  async search(
    queryEmbedding: number[],
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const limit = options.limit ?? 10;
    const threshold = options.threshold ?? 0.7;

    // VSS search with metadata join
    const results = this.db.prepare(`
      SELECT
        m.id,
        m.source_type,
        m.source_id,
        m.container_tag,
        m.memory_type,
        m.created_at,
        m.updated_at,
        m.metadata,
        v.distance
      FROM vss_vectors v
      JOIN vector_mapping m ON v.rowid = m.vss_rowid
      WHERE vss_search(v.embedding, ?)
      ${this.buildFilterClause(options.filters)}
      ORDER BY v.distance ASC
      LIMIT ?
    `).all(JSON.stringify(queryEmbedding), limit);

    // Convert distance to similarity (cosine)
    return results
      .map(r => ({
        id: r.id,
        score: 1 - r.distance, // Convert distance to similarity
        metadata: this.parseMetadata(r),
      }))
      .filter(r => r.score >= threshold);
  }
}
```

### 5. Integration Strategy

#### Phase 1: Abstraction Layer (Week 1)
1. Create `src/services/vectorstore/` directory structure
2. Implement `VectorStore` interface and types
3. Port existing `InMemoryVectorStore` to new abstraction
4. Add factory function for store creation

#### Phase 2: SQLite-VSS Implementation (Week 2)
1. Add `sqlite-vss` as optional dependency
2. Implement `SQLiteVSSVectorStore`
3. Add migration for `vss_vectors` virtual table
4. Test with existing embeddings

#### Phase 3: SearchService Integration (Week 3)
1. Modify `SearchService` to use abstracted `VectorStore`
2. Update `indexMemory()` to upsert to vector store
3. Replace `vectorSearchInternal()` with store search
4. Add metadata filtering support

#### Phase 4: MemoryRepository Integration (Week 3)
1. Replace substring matching in `semanticSearch()`
2. Inject `VectorStore` via constructor
3. Add embedding generation on memory creation

#### Phase 5: Additional Providers (Week 4+)
1. Implement `ChromaVectorStore` for production local
2. Implement `PineconeVectorStore` for cloud
3. Add provider auto-detection and fallback

### 6. Data Flow Diagram

```
                    +----------------+
                    |   User Query   |
                    +-------+--------+
                            |
                            v
                    +-------+--------+
                    | SearchService  |
                    | .hybridSearch()|
                    +-------+--------+
                            |
          +-----------------+-----------------+
          |                                   |
          v                                   v
+------------------+                 +------------------+
| EmbeddingService |                 | Query Rewriting  |
| .generateEmbed() |                 | (optional)       |
+--------+---------+                 +------------------+
         |
         v (query embedding)
+--------+---------+
|   VectorStore    |
|   .search()      |
+--------+---------+
         |
         v (VectorSearchResult[])
+--------+---------+
| Result Merging   |
| & Deduplication  |
+--------+---------+
         |
         v
+--------+---------+
|   Reranking      |
|   (optional)     |
+--------+---------+
         |
         v
+--------+---------+
| SearchResponse   |
+------------------+
```

### 7. Migration Strategy

#### Lazy Migration (Default)
- On first search after upgrade, check if vector exists in new store
- If not found, generate embedding and index
- Transparent to users, spreads load over time

```typescript
async function ensureIndexed(memory: Memory): Promise<void> {
  const exists = await vectorStore.exists(memory.id);
  if (!exists) {
    const embedding = await embeddingService.generateEmbedding(memory.content);
    await vectorStore.upsert(memory.id, embedding, {
      sourceId: memory.id,
      sourceType: 'memory',
      containerTag: memory.containerTag,
      memoryType: memory.type,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    });
  }
}
```

#### Batch Migration (CLI Command)
```bash
# Add to package.json scripts
"db:migrate-vectors": "tsx scripts/migrate-vectors.ts"
```

```typescript
// scripts/migrate-vectors.ts
async function migrateVectors(): Promise<void> {
  const memories = await memoryRepository.getAllMemories();
  const batchSize = 100;

  for (let i = 0; i < memories.length; i += batchSize) {
    const batch = memories.slice(i, i + batchSize);
    const embeddings = await embeddingService.batchEmbed(
      batch.map(m => m.content)
    );

    await vectorStore.upsertBatch(
      batch.map((m, idx) => ({
        id: m.id,
        embedding: embeddings[idx],
        metadata: { ... }
      }))
    );

    console.log(`Migrated ${i + batch.length}/${memories.length}`);
  }
}
```

### 8. Configuration

```typescript
// src/config/vectorstore.ts

import { z } from 'zod';

export const vectorStoreConfigSchema = z.object({
  provider: z.enum(['memory', 'sqlite-vss', 'chroma', 'pinecone'])
    .default('sqlite-vss'),

  dimensions: z.number().positive().default(1536),

  distanceMetric: z.enum(['cosine', 'euclidean', 'dotProduct'])
    .default('cosine'),

  sqliteVss: z.object({
    databasePath: z.string().optional(),
    // Use same DB as main app by default
  }).optional(),

  chroma: z.object({
    endpoint: z.string().url(),
    collection: z.string().default('memories'),
  }).optional(),

  pinecone: z.object({
    apiKey: z.string(),
    environment: z.string(),
    indexName: z.string(),
    namespace: z.string().optional(),
  }).optional(),
});

// Environment variable mapping
export function loadVectorStoreConfig(): VectorStoreConfig {
  return vectorStoreConfigSchema.parse({
    provider: process.env.VECTOR_STORE_PROVIDER,
    dimensions: process.env.EMBEDDING_DIMENSIONS,
    distanceMetric: process.env.VECTOR_DISTANCE_METRIC,
    sqliteVss: {
      databasePath: process.env.DATABASE_URL,
    },
    chroma: process.env.CHROMA_ENDPOINT ? {
      endpoint: process.env.CHROMA_ENDPOINT,
      collection: process.env.CHROMA_COLLECTION,
    } : undefined,
    pinecone: process.env.PINECONE_API_KEY ? {
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
      indexName: process.env.PINECONE_INDEX,
      namespace: process.env.PINECONE_NAMESPACE,
    } : undefined,
  });
}
```

## Consequences

### Positive
1. **Pluggable Architecture** - Easy to swap vector stores without code changes
2. **Local-First** - SQLite-VSS provides excellent local performance
3. **Scalable** - Can upgrade to Pinecone for cloud deployment
4. **Testable** - MockVectorStore enables isolated testing
5. **Backward Compatible** - InMemoryVectorStore preserves current behavior

### Negative
1. **Complexity** - Additional abstraction layer to maintain
2. **sqlite-vss Dependency** - Requires native extension compilation
3. **Migration Effort** - Existing data needs re-indexing

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| sqlite-vss compilation fails on some platforms | Fallback to InMemoryVectorStore with warning |
| Dimension mismatch between providers | Validate dimensions on initialization |
| Performance degradation during migration | Use background worker with rate limiting |
| API changes in external providers | Pin versions, use adapter pattern |

## Alternatives Considered

### 1. Qdrant
- Pros: Excellent performance, rich filtering
- Cons: Requires separate server process, overkill for local-first

### 2. Weaviate
- Pros: GraphQL API, multi-modal
- Cons: Heavy, requires Docker or cloud

### 3. LanceDB
- Pros: Embedded, serverless, fast
- Cons: Less mature ecosystem, limited filtering

### 4. Direct SQLite with JSON embeddings
- Pros: No extensions needed
- Cons: Very slow for large datasets (O(n) search)

## Implementation Files

The following files need to be created/modified:

### New Files
```
src/services/vectorstore/
  index.ts                          # Factory and exports
  types.ts                          # Type definitions
  base.ts                           # Base class
  implementations/
    memory.ts                       # InMemoryVectorStore
    sqlite-vss.ts                   # SQLiteVSSVectorStore
    chroma.ts                       # ChromaVectorStore
    pinecone.ts                     # PineconeVectorStore
    mock.ts                         # MockVectorStore
src/config/vectorstore.ts           # Configuration
scripts/migrate-vectors.ts          # Migration script
```

### Modified Files
```
src/services/search.service.ts      # Use VectorStore abstraction
src/services/memory.repository.ts   # Use VectorStore for semanticSearch
src/config/index.ts                 # Add vector store config
src/db/schema.ts                    # Add vector_mapping table
package.json                        # Add sqlite-vss dependency
```

## Decision

**Implemented** - The vector store abstraction layer has been fully implemented.

## Implementation Summary

The following components have been implemented:

### Completed Files

```
src/services/vectorstore/
  index.ts        # Factory, singleton pattern, migration utilities
  types.ts        # Complete type definitions
  base.ts         # Abstract base class with similarity calculations
  memory.ts       # InMemoryVectorStore
  sqlite-vss.ts   # SQLiteVSSStore (using better-sqlite3)
  chroma.ts       # ChromaVectorStore (HTTP client)
  mock.ts         # MockVectorStore for testing
```

### Key Features Implemented

1. **Strategy Pattern**: All stores implement `BaseVectorStore` abstract class
2. **Factory Function**: `createVectorStore(config)` for dynamic provider selection
3. **Singleton Pattern**: `getVectorStore()` and `getInitializedVectorStore()` for application-wide usage
4. **Migration Utilities**: `migrateVectorStore()` and `reindexVectorStore()` functions
5. **Environment Configuration**: `getDefaultVectorStoreConfig()` reads from environment variables
6. **Provider Detection**: `getAvailableProviders()` and `getBestProvider()`

### Remaining Integration Work

1. Update `SearchService` to use the vector store abstraction
2. Update `MemoryRepository.semanticSearch()` to use vector store
3. Add vector indexing on memory creation in `MemoryService`
4. Create migration script for existing data

## References

- [sqlite-vss documentation](https://github.com/asg017/sqlite-vss)
- [Chroma documentation](https://docs.trychroma.com/)
- [Pinecone documentation](https://docs.pinecone.io/)
- [HNSW algorithm paper](https://arxiv.org/abs/1603.09320)
