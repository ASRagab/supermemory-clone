/**
 * Services Index
 *
 * Export all services for the Supermemory Clone
 */

// Memory System
export * from './memory.types.js'
export * from './memory.repository.js'
export {
  MemoryService,
  getMemoryService,
  resetMemoryService,
  createMemoryService,
  memoryService,
} from './memory.service.js'

// Profile System
export * from './profile.types.js'
export * from './profile.repository.js'
export * from './profile.service.js'

// Document System
export * from './documents.repository.js'
export * from './documents.service.js'

// Search & Embedding System
export * from './search.types.js'
export {
  EmbeddingService,
  cosineSimilarity,
  createEmbeddingService,
  getEmbeddingService,
  resetEmbeddingService,
  embeddingService,
} from './embedding.service.js'
export {
  SearchService,
  createSearchService,
  createSearchServiceWithVectorStore,
  getSearchService,
  resetSearchService,
  searchService,
} from './search.service.js'

// Vector Store System
// Using explicit exports to avoid name collisions with search.types.js
export {
  // Types
  type VectorStoreProvider,
  type IndexType,
  type FilterOperator,
  type MetadataFilter as VectorMetadataFilter,
  type VectorEntry as VectorStoreEntry,
  type SearchOptions as VectorSearchOptions,
  type VectorSearchResult as VectorStoreSearchResult,
  type AddOptions as VectorAddOptions,
  type DeleteOptions as VectorDeleteOptions,
  type VectorStoreConfig,
  type HNSWConfig,
  type VectorStoreStats,
  type BatchResult,
  type MigrationOptions,
  type MigrationProgress,
  type VectorStoreEvent,
  type VectorStoreEventListener,

  // Constants
  DEFAULT_SEARCH_OPTIONS as VECTOR_DEFAULT_SEARCH_OPTIONS,
  DEFAULT_HNSW_CONFIG,

  // Base class and utilities
  BaseVectorStore,
  cosineSimilarity as vectorCosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalizeVector,
  validateVector,

  // Implementations
  InMemoryVectorStore,
  createInMemoryVectorStore,
  MockVectorStore,
  createMockVectorStore,

  // Factory functions
  createVectorStore,
  createAndInitializeVectorStore,
  configureVectorStore,
  getVectorStore,
  getInitializedVectorStore,
  resetVectorStore,
  getAvailableProviders as getAvailableVectorProviders,
  getBestProvider as getBestVectorProvider,

  // Migration
  migrateVectorStore,
  reindexVectorStore,
  getDefaultVectorStoreConfig,
} from './vectorstore/index.js'

// Re-export singleton instances for convenience
export { profileRepository } from './profile.repository.js'
export { profileService } from './profile.service.js'

// Relationship Detection System
// Note: Using explicit exports to avoid name collisions with memory.types.js and search.types.js
export {
  // Types
  type RelationshipConfig,
  type RelationshipThresholds,
  type RelationshipCandidate,
  type DetectedRelationship,
  type RelationshipDetectionResult as EmbeddingRelationshipDetectionResult,
  type RelationshipDetectionStats,
  type Contradiction,
  type ContradictionType,
  type ContradictionResolution,
  type DetectionStrategyType,
  type VectorStore as RelationshipVectorStore,
  type VectorSearchResult as RelationshipVectorSearchResult,
  type LLMProvider,
  type LLMVerificationRequest,
  type LLMVerificationResponse,
  type CachedRelationshipScore,

  // Constants
  DEFAULT_RELATIONSHIP_CONFIG,
  DEFAULT_RELATIONSHIP_THRESHOLDS,
  generateCacheKey,

  // Detector
  EmbeddingRelationshipDetector,
  InMemoryVectorStoreAdapter,
  createEmbeddingRelationshipDetector,

  // Factory Functions
  getSharedVectorStore,
  getRelationshipDetector,
  resetRelationshipDetector,
  createRelationshipDetector,
  detectRelationshipsQuick,
  batchDetectRelationshipsQuick,
  detectContradictionsQuick,

  // Integration Helpers
  indexMemoryForRelationships,
  removeMemoryFromRelationshipIndex,
  clearRelationshipIndex,

  // Enhanced Memory Service
  EnhancedMemoryService,
  createEnhancedMemoryService,
  getEnhancedMemoryService,
  resetEnhancedMemoryService,
  enhancedMemoryService,
  type EnhancedMemoryServiceConfig,
  DEFAULT_ENHANCED_CONFIG,
} from './relationships/index.js'

// Content Extraction Pipeline
export { ExtractionService } from './extraction.service.js'
export { ChunkingService } from './chunking.service.js'
export { PipelineService } from './pipeline.service.js'

// Extractors
export { TextExtractor } from './extractors/text.extractor.js'
export { UrlExtractor } from './extractors/url.extractor.js'
export { PdfExtractor } from './extractors/pdf.extractor.js'
export { MarkdownExtractor, type MarkdownSection } from './extractors/markdown.extractor.js'
export { CodeExtractor, type CodeBlock } from './extractors/code.extractor.js'

// Secrets Management
export {
  SecretsService,
  getSecretsService,
  initializeSecretsService,
  type EncryptedSecret,
  type SecretMetadata,
  type SecretValidationResult,
} from './secrets.service.js'

// LLM Providers for Memory Extraction
export {
  // Types
  type LLMProvider as LLMExtractionProvider,
  type LLMProviderType,
  type LLMConfig,
  type OpenAILLMConfig,
  type AnthropicLLMConfig,
  type MockLLMConfig,
  type ExtractedMemory,
  type LLMExtractionResult,
  type LLMRelationshipResult,
  type DetectedRelationship as LLMDetectedRelationship,
  type ExtractionOptions,
  type RelationshipDetectionOptions as LLMRelationshipDetectionOptions,
  type ProviderHealthStatus,
  type CacheConfig as LLMCacheConfig,
  LLMErrorCode,

  // Base
  BaseLLMProvider,
  LLMError,
  DEFAULT_LLM_CONFIG,
  DEFAULT_CACHE_CONFIG as DEFAULT_LLM_CACHE_CONFIG,

  // Providers
  OpenAILLMProvider,
  createOpenAIProvider,
  AnthropicLLMProvider,
  createAnthropicProvider,
  MockLLMProvider,
  createMockProvider,

  // Factory
  createLLMProvider,
  getLLMProvider,
  resetLLMProvider,
  setLLMProvider,
  llmProvider,
  getDefaultProviderType,
  isLLMAvailable,
  getAvailableProviders,

  // Prompts (for testing/customization)
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_EXTRACTION_EXAMPLES,
  RELATIONSHIP_DETECTION_SYSTEM_PROMPT,
  RELATIONSHIP_DETECTION_EXAMPLES,
  generateExtractionPrompt,
  generateRelationshipPrompt,
  parseExtractionResponse,
  parseRelationshipResponse,
} from './llm/index.js'
