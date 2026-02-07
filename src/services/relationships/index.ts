/**
 * Relationship Detection Module
 *
 * Embedding-based relationship detection for memories.
 * Provides vector similarity, temporal analysis, entity overlap,
 * and optional LLM verification for relationship detection.
 *
 * @example
 * ```typescript
 * import {
 *   createEmbeddingRelationshipDetector,
 *   EmbeddingRelationshipDetector,
 *   DEFAULT_RELATIONSHIP_CONFIG,
 * } from './relationships';
 *
 * const detector = createEmbeddingRelationshipDetector(embeddingService);
 * const result = await detector.detectRelationships(newMemory);
 *
 * console.log(`Found ${result.relationships.length} relationships`);
 * console.log(`Superseded memories: ${result.supersededMemoryIds.join(', ')}`);
 * console.log(`Contradictions: ${result.contradictions.length}`);
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Configuration
  RelationshipConfig,
  RelationshipThresholds,

  // Detection Results
  RelationshipCandidate,
  DetectedRelationship,
  RelationshipDetectionResult,
  RelationshipDetectionStats,

  // Contradictions
  Contradiction,
  ContradictionType,
  ContradictionResolution,

  // Strategy Type (kept for metadata only)
  DetectionStrategyType,

  // Vector Store
  VectorStore,
  VectorSearchResult,

  // LLM Provider
  LLMProvider,
  LLMVerificationRequest,
  LLMVerificationResponse,

  // Cache
  CachedRelationshipScore,
} from './types.js';

export {
  DEFAULT_RELATIONSHIP_CONFIG,
  DEFAULT_RELATIONSHIP_THRESHOLDS,
  generateCacheKey,
} from './types.js';

// ============================================================================
// Helper Functions
// ============================================================================

export {
  createDetectedRelationship,
  hasUpdateIndicators,
  hasExtensionIndicators,
  hasContradictionIndicators,
  hasSupersessionIndicators,
  hasCausalIndicators,
} from './strategies.js';

// ============================================================================
// Detector
// ============================================================================

export {
  EmbeddingRelationshipDetector,
  InMemoryVectorStoreAdapter,
  createEmbeddingRelationshipDetector,
} from './detector.js';

// ============================================================================
// Factory Functions
// ============================================================================

import type { EmbeddingService } from '../embedding.service.js';
import type { Memory } from '../memory.types.js';
import { EmbeddingRelationshipDetector, InMemoryVectorStoreAdapter } from './detector.js';
import type {
  RelationshipConfig,
  VectorStore,
  LLMProvider,
  RelationshipDetectionResult,
} from './types.js';

/**
 * Singleton instance (lazy initialization)
 */
let _detectorInstance: EmbeddingRelationshipDetector | null = null;
let _vectorStoreInstance: InMemoryVectorStoreAdapter | null = null;

/**
 * Get or create the shared vector store instance
 */
export function getSharedVectorStore(): InMemoryVectorStoreAdapter {
  if (!_vectorStoreInstance) {
    _vectorStoreInstance = new InMemoryVectorStoreAdapter();
  }
  return _vectorStoreInstance;
}

/**
 * Get the singleton relationship detector instance
 *
 * @param embeddingService - Required on first call to initialize
 * @param config - Optional configuration overrides
 */
export function getRelationshipDetector(
  embeddingService?: EmbeddingService,
  config?: Partial<RelationshipConfig>
): EmbeddingRelationshipDetector {
  if (!_detectorInstance) {
    if (!embeddingService) {
      throw new Error(
        'EmbeddingService is required for first initialization of RelationshipDetector'
      );
    }
    _detectorInstance = new EmbeddingRelationshipDetector(
      embeddingService,
      getSharedVectorStore(),
      config
    );
  }
  return _detectorInstance;
}

/**
 * Reset singleton instances (for testing)
 */
export function resetRelationshipDetector(): void {
  _detectorInstance = null;
  _vectorStoreInstance = null;
}

/**
 * Create a standalone relationship detector
 * (not using singleton pattern)
 */
export function createRelationshipDetector(
  embeddingService: EmbeddingService,
  options?: {
    vectorStore?: VectorStore;
    config?: Partial<RelationshipConfig>;
    llmProvider?: LLMProvider;
  }
): EmbeddingRelationshipDetector {
  const vectorStore = options?.vectorStore ?? new InMemoryVectorStoreAdapter();
  return new EmbeddingRelationshipDetector(
    embeddingService,
    vectorStore,
    options?.config,
    options?.llmProvider
  );
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick relationship detection for a single memory.
 * Uses the singleton detector instance.
 *
 * @param memory - Memory to analyze
 * @param embeddingService - Required if detector not yet initialized
 * @param containerTag - Optional container tag filter
 */
export async function detectRelationshipsQuick(
  memory: Memory,
  embeddingService?: EmbeddingService,
  containerTag?: string
): Promise<RelationshipDetectionResult> {
  const detector = getRelationshipDetector(embeddingService);
  return detector.detectRelationships(memory, { containerTag });
}

/**
 * Quick batch relationship detection.
 * Uses the singleton detector instance.
 *
 * @param memories - Memories to analyze
 * @param embeddingService - Required if detector not yet initialized
 * @param containerTag - Optional container tag filter
 */
export async function batchDetectRelationshipsQuick(
  memories: Memory[],
  embeddingService?: EmbeddingService,
  containerTag?: string
): Promise<RelationshipDetectionResult[]> {
  const detector = getRelationshipDetector(embeddingService);
  return detector.batchDetectRelationships(memories, { containerTag });
}

/**
 * Quick contradiction detection among a group of memories.
 * Uses the singleton detector instance.
 *
 * @param memories - Memories to check for contradictions
 * @param embeddingService - Required if detector not yet initialized
 */
export async function detectContradictionsQuick(
  memories: Memory[],
  embeddingService?: EmbeddingService
): Promise<import('./types.js').Contradiction[]> {
  const detector = getRelationshipDetector(embeddingService);
  return detector.detectContradictionsInGroup(memories);
}

// ============================================================================
// Integration Helpers
// ============================================================================

/**
 * Index a memory in the shared vector store.
 * Call this when adding new memories to enable relationship detection.
 *
 * @param memory - Memory to index
 * @param embedding - Pre-computed embedding (optional)
 * @param embeddingService - Service to generate embedding if not provided
 */
export async function indexMemoryForRelationships(
  memory: Memory,
  embedding?: number[],
  embeddingService?: EmbeddingService
): Promise<void> {
  const store = getSharedVectorStore();

  if (embedding) {
    store.addMemory(memory, embedding);
  } else if (embeddingService) {
    const generatedEmbedding = await embeddingService.generateEmbedding(memory.content);
    store.addMemory(memory, generatedEmbedding);
  } else if (memory.embedding && memory.embedding.length > 0) {
    store.addMemory(memory, memory.embedding);
  } else {
    throw new Error(
      'Either embedding or embeddingService must be provided if memory has no embedding'
    );
  }
}

/**
 * Remove a memory from the shared vector store.
 *
 * @param memoryId - ID of memory to remove
 */
export function removeMemoryFromRelationshipIndex(memoryId: string): boolean {
  const store = getSharedVectorStore();
  return store.removeMemory(memoryId);
}

/**
 * Clear all memories from the shared vector store.
 */
export function clearRelationshipIndex(): void {
  const store = getSharedVectorStore();
  store.clear();
}

// ============================================================================
// Memory Service Integration
// ============================================================================

export {
  EnhancedMemoryService,
  createEnhancedMemoryService,
  getEnhancedMemoryService,
  resetEnhancedMemoryService,
  enhancedMemoryService,
  type EnhancedMemoryServiceConfig,
  DEFAULT_ENHANCED_CONFIG,
} from './memory-integration.js';
