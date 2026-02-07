# Changelog

All notable changes to the Supermemory Clone project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-02-01

### P0 Implementation: LLM Memory Extraction, Vector Store, and Relationship Detection

This release implements the P0 (highest priority) features from the backlog:
- LLM-based memory extraction with multi-provider support
- Vector store abstraction layer with multiple backend support
- Embedding-based relationship detection with contradiction detection

---

### Added

#### LLM-Based Memory Extraction (`src/services/llm/`)

A comprehensive LLM provider system for intelligent memory extraction with multi-provider support:

**New Files:**
- `src/services/llm/types.ts` - Type definitions for LLM providers, extracted memories, relationships, and configuration
- `src/services/llm/base.ts` - Abstract base class with retry logic, caching, and error handling
- `src/services/llm/openai.ts` - OpenAI provider implementation using GPT models with JSON mode
- `src/services/llm/anthropic.ts` - Anthropic provider implementation using Claude models
- `src/services/llm/mock.ts` - Mock provider for testing with rule-based extraction
- `src/services/llm/prompts.ts` - Carefully crafted prompts with few-shot examples for extraction and relationship detection
- `src/services/llm/index.ts` - Factory functions, singleton management, and re-exports

**Features:**
- Multi-provider support (OpenAI GPT-4o-mini, Anthropic Claude-3-haiku, Mock for testing)
- Automatic provider detection based on available API keys
- Response caching with configurable TTL (default: 15 minutes)
- Retry logic with exponential backoff
- Structured JSON output with confidence scores
- Entity extraction (person, place, organization, date, concept)
- Keyword extraction for each memory
- Memory type classification (fact, event, preference, skill, relationship, context, note)
- Health status monitoring for providers
- Graceful degradation to mock provider when no API keys available

**Key Types:**
```typescript
interface ExtractedMemory {
  content: string;
  type: MemoryType;
  confidence: number;
  entities: Entity[];
  keywords: string[];
  reasoning?: string;
}

type LLMProviderType = 'openai' | 'anthropic' | 'mock';
```

#### Vector Store Abstraction (`src/services/vectorstore/`)

A provider-agnostic vector similarity search system with multiple backend support:

**New Files:**
- `src/services/vectorstore/types.ts` - Type definitions for vector entries, search options, filters, and configuration
- `src/services/vectorstore/base.ts` - Abstract base class with similarity calculations and filter logic
- `src/services/vectorstore/memory.ts` - In-memory vector store for development/testing
- `src/services/vectorstore/sqlite-vss.ts` - SQLite-VSS implementation for local-first persistent storage
- `src/services/vectorstore/chroma.ts` - ChromaDB implementation for production deployments
- `src/services/vectorstore/mock.ts` - Mock vector store for testing with operation recording
- `src/services/vectorstore/index.ts` - Factory functions, lazy loading, singleton management, and migration utilities

**Features:**
- Three production-ready backends: In-Memory, SQLite-VSS, ChromaDB
- Lazy loading of implementations to avoid importing optional dependencies
- Metadata filtering with operators (eq, ne, gt, gte, lt, lte, in, nin, contains, startsWith)
- Cosine similarity, Euclidean distance, and dot product metrics
- HNSW index configuration for optimized search
- Batch operations with error tracking
- Migration utilities between vector stores
- Re-indexing support for embedding model changes
- Event system for operation tracking
- Namespace/collection support

**Key Types:**
```typescript
type VectorStoreProvider = 'memory' | 'sqlite-vss' | 'chroma';
type SimilarityMetric = 'cosine' | 'euclidean' | 'dot_product';
type IndexType = 'flat' | 'hnsw' | 'ivf';

interface VectorEntry {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}
```

#### Embedding-Based Relationship Detection (`src/services/relationships/`)

A sophisticated relationship detection system using vector similarity and multiple strategies:

**New Files:**
- `src/services/relationships/types.ts` - Type definitions for relationships, contradictions, strategies, and configuration
- `src/services/relationships/strategies.ts` - Five detection strategies (Similarity, Temporal, EntityOverlap, LLMVerification, Hybrid)
- `src/services/relationships/detector.ts` - Main detector class orchestrating relationship detection
- `src/services/relationships/memory-integration.ts` - Enhanced memory service with embedding-based detection
- `src/services/relationships/index.ts` - Factory functions, singleton management, and convenience helpers

**Features:**
- Five detection strategies:
  1. **SimilarityStrategy** - Pure cosine similarity with threshold-based classification
  2. **TemporalStrategy** - Time-based relationship inference (rapid updates, same-day context)
  3. **EntityOverlapStrategy** - Shared entity detection (Jaccard similarity)
  4. **LLMVerificationStrategy** - Optional LLM verification for high-confidence relationships
  5. **HybridStrategy** - Combined strategies with confidence-based merging
- Contradiction detection with resolution suggestions:
  - Factual contradictions (negation asymmetry)
  - Semantic contradictions (opposite meanings)
  - Temporal contradictions (old vs new information)
- Relationship types: updates, extends, derives, contradicts, related, supersedes
- Configurable thresholds per relationship type
- Cache for relationship scores with TTL
- Batch detection for multiple memories
- In-memory vector store adapter for quick setup

**Key Types:**
```typescript
interface RelationshipDetectionResult {
  sourceMemory: Memory;
  relationships: DetectedRelationship[];
  supersededMemoryIds: string[];
  contradictions: Contradiction[];
  stats: RelationshipDetectionStats;
}

interface Contradiction {
  id: string;
  memoryId1: string;
  memoryId2: string;
  similarity: number;
  confidence: number;
  type: ContradictionType;
  description: string;
  suggestedResolution?: ContradictionResolution;
}
```

**Default Thresholds:**
```typescript
const DEFAULT_RELATIONSHIP_THRESHOLDS = {
  updates: 0.85,
  extends: 0.70,
  contradicts: 0.80,
  supersedes: 0.90,
  related: 0.60,
  derives: 0.65,
};
```

---

### Changed

#### Services Index (`src/services/index.ts`)

- Added comprehensive exports for all new modules (LLM, VectorStore, Relationships)
- Used explicit named exports to avoid name collisions between modules
- Added type aliases for overlapping type names (e.g., `VectorMetadataFilter`, `RelationshipVectorStore`)

#### Configuration (`src/config/index.ts`)

- Added LLM provider configuration options:
  - `llmProvider`: Select between 'openai', 'anthropic', or 'mock'
  - `anthropicApiKey`: API key for Anthropic Claude
  - `llmModel`: Override default model for LLM extraction
  - `llmMaxTokens`: Maximum tokens for LLM responses (default: 2000)
  - `llmTemperature`: Temperature for generation (default: 0.1)
  - `llmTimeoutMs`: Request timeout in milliseconds (default: 30000)
  - `llmMaxRetries`: Maximum retry attempts (default: 3)
  - `llmCacheEnabled`: Enable/disable response caching (default: true)
  - `llmCacheTtlMs`: Cache TTL in milliseconds (default: 900000)

- Added vector store configuration options:
  - `vectorStoreProvider`: Select between 'memory', 'sqlite-vss', or 'chroma'
  - `vectorDimensions`: Embedding dimensions (default: 1536)
  - `vectorSqlitePath`: Path for SQLite-VSS database
  - `chromaUrl`: ChromaDB server URL
  - `chromaCollection`: ChromaDB collection name

#### Async Method Changes

- `VectorStoreStats.getStats()` is now async (returns `Promise<VectorStoreStats>`) to support async backends

---

### New Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LLM_PROVIDER` | `'openai' \| 'anthropic' \| 'mock'` | Auto-detect | LLM provider for memory extraction |
| `ANTHROPIC_API_KEY` | `string` | - | API key for Anthropic Claude |
| `LLM_MODEL` | `string` | Provider default | Override default model |
| `LLM_MAX_TOKENS` | `number` | `2000` | Maximum tokens for responses |
| `LLM_TEMPERATURE` | `number` | `0.1` | Generation temperature |
| `LLM_TIMEOUT_MS` | `number` | `30000` | Request timeout |
| `LLM_MAX_RETRIES` | `number` | `3` | Maximum retry attempts |
| `LLM_CACHE_ENABLED` | `boolean` | `true` | Enable response caching |
| `LLM_CACHE_TTL_MS` | `number` | `900000` | Cache TTL (15 minutes) |
| `VECTOR_STORE_PROVIDER` | `'memory' \| 'sqlite-vss' \| 'chroma'` | `'memory'` | Vector store backend |
| `VECTOR_DIMENSIONS` | `number` | `1536` | Embedding dimensions |
| `VECTOR_SQLITE_PATH` | `string` | `'./data/vectors.db'` | SQLite-VSS database path |
| `CHROMA_URL` | `string` | `'http://localhost:8000'` | ChromaDB server URL |
| `CHROMA_COLLECTION` | `string` | `'supermemory_vectors'` | ChromaDB collection name |

---

### New API Exports from `src/services/index.ts`

#### LLM Providers
```typescript
// Types
export type { LLMProvider, LLMProviderType, LLMConfig, OpenAILLMConfig, AnthropicLLMConfig };
export type { MockLLMConfig, ExtractedMemory, LLMExtractionResult, LLMRelationshipResult };
export type { ExtractionOptions, ProviderHealthStatus, CacheConfig };

// Base & Error
export { BaseLLMProvider, LLMError, DEFAULT_LLM_CONFIG, DEFAULT_CACHE_CONFIG };
export { LLMErrorCode };

// Providers
export { OpenAILLMProvider, createOpenAIProvider };
export { AnthropicLLMProvider, createAnthropicProvider };
export { MockLLMProvider, createMockProvider };

// Factory
export { createLLMProvider, getLLMProvider, resetLLMProvider, setLLMProvider };
export { getDefaultProviderType, isLLMAvailable, getAvailableProviders };

// Prompts
export { MEMORY_EXTRACTION_SYSTEM_PROMPT, MEMORY_EXTRACTION_EXAMPLES };
export { RELATIONSHIP_DETECTION_SYSTEM_PROMPT, RELATIONSHIP_DETECTION_EXAMPLES };
export { generateExtractionPrompt, generateRelationshipPrompt };
export { parseExtractionResponse, parseRelationshipResponse };
```

#### Vector Store
```typescript
// Types
export type { VectorStoreProvider, IndexType, FilterOperator, VectorStoreConfig };
export type { VectorEntry, SearchOptions, VectorSearchResult, AddOptions, DeleteOptions };
export type { HNSWConfig, VectorStoreStats, BatchResult, MigrationProgress };

// Base & Utilities
export { BaseVectorStore, cosineSimilarity, euclideanDistance, dotProduct };
export { normalizeVector, validateVector };

// Implementations
export { InMemoryVectorStore, createInMemoryVectorStore };
export { SQLiteVSSStore, createSQLiteVSSStore };
export { ChromaVectorStore, createChromaVectorStore };
export { MockVectorStore, createMockVectorStore };

// Factory
export { createVectorStore, createAndInitializeVectorStore };
export { configureVectorStore, getVectorStore, getInitializedVectorStore, resetVectorStore };
export { getAvailableVectorProviders, getBestVectorProvider };

// Migration
export { migrateVectorStore, reindexVectorStore, getDefaultVectorStoreConfig };
```

#### Relationship Detection
```typescript
// Types
export type { RelationshipConfig, RelationshipThresholds };
export type { RelationshipCandidate, DetectedRelationship, RelationshipDetectionResult };
export type { Contradiction, ContradictionType, ContradictionResolution };
export type { DetectionStrategy, DetectionStrategyType, StrategyInput, StrategyOutput };

// Constants
export { DEFAULT_RELATIONSHIP_CONFIG, DEFAULT_RELATIONSHIP_THRESHOLDS };

// Strategies
export { SimilarityStrategy, TemporalStrategy, EntityOverlapStrategy };
export { LLMVerificationStrategy, HybridStrategy };
export { createStrategy, createDefaultStrategy };

// Detector
export { EmbeddingRelationshipDetector, InMemoryVectorStoreAdapter };
export { createEmbeddingRelationshipDetector };

// Factory
export { getRelationshipDetector, resetRelationshipDetector, createRelationshipDetector };
export { detectRelationshipsQuick, batchDetectRelationshipsQuick, detectContradictionsQuick };

// Integration
export { indexMemoryForRelationships, removeMemoryFromRelationshipIndex, clearRelationshipIndex };
export { EnhancedMemoryService, createEnhancedMemoryService, getEnhancedMemoryService };
```

---

### File Summary

#### New Files Created (25 files)

**LLM Module (7 files):**
- `/src/services/llm/types.ts` - 369 lines
- `/src/services/llm/base.ts` - 472 lines
- `/src/services/llm/openai.ts` - 366 lines
- `/src/services/llm/anthropic.ts` - 386 lines
- `/src/services/llm/mock.ts` - 400 lines
- `/src/services/llm/prompts.ts` - 451 lines
- `/src/services/llm/index.ts` - 261 lines

**Vector Store Module (8 files):**
- `/src/services/vectorstore/types.ts` - 265 lines
- `/src/services/vectorstore/base.ts` - 369 lines
- `/src/services/vectorstore/memory.ts` - 295 lines
- `/src/services/vectorstore/sqlite-vss.ts` - SQLite-VSS implementation
- `/src/services/vectorstore/chroma.ts` - ChromaDB implementation
- `/src/services/vectorstore/mock.ts` - Mock implementation with operation recording
- `/src/services/vectorstore/implementations/sqlite-vss.ts` - Alternative implementation path
- `/src/services/vectorstore/implementations/chroma.ts` - Alternative implementation path
- `/src/services/vectorstore/index.ts` - 458 lines

**Relationships Module (5 files):**
- `/src/services/relationships/types.ts` - 406 lines
- `/src/services/relationships/strategies.ts` - 642 lines
- `/src/services/relationships/detector.ts` - 797 lines
- `/src/services/relationships/memory-integration.ts` - 487 lines
- `/src/services/relationships/index.ts` - 298 lines

#### Modified Files (2 files)

- `/src/services/index.ts` - Added comprehensive exports for all new modules
- `/src/config/index.ts` - Added LLM and vector store configuration options

---

### Breaking Changes

None. All new functionality is additive. Existing code will continue to work with the regex-based extraction and detection.

---

### Migration Guide

#### Upgrading from v0.1.x

1. **Update environment variables** (optional):
   ```bash
   # .env
   LLM_PROVIDER=openai  # or 'anthropic' or 'mock'
   OPENAI_API_KEY=sk-...
   # or
   ANTHROPIC_API_KEY=sk-ant-...

   VECTOR_STORE_PROVIDER=memory  # or 'sqlite-vss' or 'chroma'
   ```

2. **Use enhanced memory service** (optional):
   ```typescript
   import { getEnhancedMemoryService } from './services';

   const service = getEnhancedMemoryService({
     useEmbeddingDetection: true,
     detectContradictions: true,
   });

   const result = await service.processAndStoreMemoriesEnhanced(content);
   ```

3. **Use LLM extraction directly** (optional):
   ```typescript
   import { getLLMProvider } from './services';

   const provider = getLLMProvider();
   const result = await provider.extractMemories(text);
   ```

4. **Use vector store** (optional):
   ```typescript
   import { createVectorStore } from './services';

   const store = await createVectorStore({
     provider: 'sqlite-vss',
     dimensions: 1536,
     sqlitePath: './data/vectors.db',
   });
   await store.initialize();
   ```

---

### Performance Considerations

- **LLM Extraction**: Adds latency (500ms-3s per extraction) but significantly improves accuracy
- **Caching**: LLM responses are cached for 15 minutes by default to reduce API costs
- **Vector Search**: In-memory store is O(n) linear search; use SQLite-VSS or ChromaDB for large datasets
- **Batch Processing**: Use batch methods (`batchEmbed`, `addBatch`, `batchDetectRelationships`) for efficiency

---

### Known Limitations

1. **SQLite-VSS** requires native compilation; may not work in all environments
2. **ChromaDB** requires a running ChromaDB server
3. **LLM providers** require API keys; fallback to mock provider provides basic functionality
4. **Memory vector store** is ephemeral and lost on restart

---

## [0.1.0] - 2026-01-31

### Initial Release

- Core memory extraction with regex-based patterns
- Memory types: fact, event, preference, skill, relationship, context, note
- Profile system with static and dynamic facts
- Search service with hybrid BM25 + semantic search
- SQLite database with Drizzle ORM
- MCP server integration
- REST API with Hono
- TypeScript SDK client
