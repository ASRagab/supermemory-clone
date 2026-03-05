/**
 * Memory Service Integration for Embedding-Based Relationship Detection
 *
 * Provides integration helpers and an enhanced memory service wrapper
 * that uses embedding-based relationship detection instead of regex patterns.
 */

import type { Memory, Relationship, MemoryServiceConfig } from '../memory.types.js'
import type { EmbeddingService } from '../embedding.service.js'
import { getEmbeddingService } from '../embedding.service.js'
import { MemoryService, getMemoryService } from '../memory.service.js'
import { type MemoryRepository, getMemoryRepository } from '../memory.repository.js'
import { getLogger } from '../../utils/logger.js'
import type { RelationshipConfig, RelationshipDetectionResult, Contradiction, LLMProvider } from './types.js'
import {
  EmbeddingRelationshipDetector,
  InMemoryVectorStoreAdapter,
  createEmbeddingRelationshipDetector,
} from './detector.js'
import { getSharedVectorStore } from './index.js'
import { isEmbeddingRelationshipsEnabled } from '../../config/feature-flags.js'

const logger = getLogger('EnhancedMemoryService')

// ============================================================================
// Enhanced Memory Service Configuration
// ============================================================================

/**
 * Configuration for the enhanced memory service
 */
export interface EnhancedMemoryServiceConfig extends MemoryServiceConfig {
  /** Configuration for embedding-based relationship detection */
  relationshipDetection: Partial<RelationshipConfig>

  /** Whether to use embedding-based detection (true) or regex (false) */
  useEmbeddingDetection: boolean

  /** Whether to automatically index memories for relationship detection */
  autoIndexMemories: boolean

  /** Whether to detect contradictions */
  detectContradictions: boolean
}

/**
 * Default enhanced configuration
 */
export const DEFAULT_ENHANCED_CONFIG: Partial<EnhancedMemoryServiceConfig> = {
  useEmbeddingDetection: isEmbeddingRelationshipsEnabled(),
  autoIndexMemories: isEmbeddingRelationshipsEnabled(),
  detectContradictions: true,
  relationshipDetection: {
    maxCandidates: 50,
    enableLLMVerification: false,
    enableContradictionDetection: true,
    enableCausalDetection: true,
  },
}

// ============================================================================
// Enhanced Memory Service
// ============================================================================

/**
 * Enhanced Memory Service with embedding-based relationship detection.
 *
 * This extends the base MemoryService to use vector similarity for
 * relationship detection instead of regex patterns.
 *
 * @example
 * ```typescript
 * const service = createEnhancedMemoryService();
 *
 * // Process content with embedding-based relationship detection
 * const result = await service.processAndStoreMemoriesEnhanced(content, {
 *   containerTag: 'user-123',
 *   detectRelationships: true,
 * });
 *
 * console.log(`Found ${result.relationships.length} relationships`);
 * console.log(`Contradictions: ${result.contradictions.length}`);
 * ```
 */
export class EnhancedMemoryService {
  private readonly baseService: MemoryService
  private readonly repository: MemoryRepository
  private readonly embeddingService: EmbeddingService
  private readonly relationshipDetector: EmbeddingRelationshipDetector
  private readonly config: EnhancedMemoryServiceConfig
  private readonly vectorStore: InMemoryVectorStoreAdapter

  constructor(
    config: Partial<EnhancedMemoryServiceConfig> = {},
    dependencies?: {
      baseService?: MemoryService
      repository?: MemoryRepository
      embeddingService?: EmbeddingService
      vectorStore?: InMemoryVectorStoreAdapter
      llmProvider?: LLMProvider
    }
  ) {
    // Merge configuration
    this.config = {
      ...DEFAULT_ENHANCED_CONFIG,
      ...config,
    } as EnhancedMemoryServiceConfig

    // Set up dependencies
    this.baseService = dependencies?.baseService ?? getMemoryService(config)
    this.repository = dependencies?.repository ?? getMemoryRepository()
    this.embeddingService = dependencies?.embeddingService ?? getEmbeddingService()
    this.vectorStore = dependencies?.vectorStore ?? getSharedVectorStore()

    // Create relationship detector
    this.relationshipDetector = createEmbeddingRelationshipDetector(
      this.embeddingService,
      this.vectorStore,
      this.config.relationshipDetection,
      dependencies?.llmProvider
    )

    logger.debug('EnhancedMemoryService initialized', {
      useEmbeddingDetection: this.config.useEmbeddingDetection,
      autoIndexMemories: this.config.autoIndexMemories,
    })
  }

  // ============================================================================
  // Enhanced Processing Methods
  // ============================================================================

  /**
   * Process and store memories with embedding-based relationship detection.
   *
   * This is the main entry point that replaces the base service's
   * processAndStoreMemories method with enhanced detection.
   */
  async processAndStoreMemoriesEnhanced(
    content: string,
    options: {
      containerTag?: string
      sourceId?: string
      detectRelationships?: boolean
      detectContradictions?: boolean
    } = {}
  ): Promise<{
    memories: Memory[]
    relationships: Relationship[]
    supersededMemoryIds: string[]
    contradictions: Contradiction[]
    detectionResults: RelationshipDetectionResult[]
  }> {
    const shouldDetectRelationships = options.detectRelationships ?? this.config.autoDetectRelationships
    const shouldDetectContradictions = options.detectContradictions ?? this.config.detectContradictions

    if (!this.config.useEmbeddingDetection || !shouldDetectRelationships) {
      const baseResult = await this.baseService.processAndStoreMemories(content, {
        containerTag: options.containerTag,
        sourceId: options.sourceId,
        detectRelationships: shouldDetectRelationships,
      })

      return {
        ...baseResult,
        contradictions: [],
        detectionResults: [],
      }
    }

    logger.debug('Processing content with enhanced detection', {
      containerTag: options.containerTag,
      detectRelationships: shouldDetectRelationships,
      detectContradictions: shouldDetectContradictions,
    })

    // Step 1: Extract memories using base service
    const extractedMemories = await this.baseService.extractMemories(content)

    // Update container tags and source info
    for (const memory of extractedMemories) {
      memory.containerTag = options.containerTag ?? this.config.defaultContainerTag
      if (options.sourceId) {
        memory.sourceId = options.sourceId
      }
    }

    // Step 2: Generate embeddings for extracted memories
    const embeddings = await this.embeddingService.batchEmbed(extractedMemories.map((m) => m.content))

    // Attach embeddings to memories
    for (let i = 0; i < extractedMemories.length; i++) {
      const memory = extractedMemories[i]
      const embedding = embeddings[i]
      if (memory && embedding) {
        memory.embedding = embedding
      }
    }

    const allRelationships: Relationship[] = []
    const allSupersededIds: string[] = []
    const allContradictions: Contradiction[] = []
    const detectionResults: RelationshipDetectionResult[] = []

    // Step 3: Process each memory
    for (const memory of extractedMemories) {
      // Store the memory
      await this.repository.create(memory)

      // Index for future relationship detection
      if (this.config.autoIndexMemories && memory.embedding) {
        this.vectorStore.addMemory(memory, memory.embedding)
      }

      // Detect relationships if enabled
      if (shouldDetectRelationships) {
        const result = await this.relationshipDetector.detectRelationships(memory, {
          containerTag: options.containerTag,
          excludeIds: extractedMemories.map((m) => m.id),
        })

        detectionResults.push(result)

        // Process detected relationships
        for (const detected of result.relationships) {
          allRelationships.push(detected.relationship)

          // Mark superseded memories
          if (detected.relationship.type === 'updates' || detected.relationship.type === 'supersedes') {
            const target = await this.repository.findById(detected.relationship.targetMemoryId)
            if (target && memory.containerTag && target.containerTag && memory.containerTag !== target.containerTag) {
              continue
            }

            await this.repository.markSuperseded(detected.relationship.targetMemoryId, memory.id)
            allSupersededIds.push(detected.relationship.targetMemoryId)
          }
        }

        // Store relationships
        if (result.relationships.length > 0) {
          await this.repository.createRelationshipBatch(result.relationships.map((r) => r.relationship))
        }

        // Collect contradictions
        if (shouldDetectContradictions) {
          allContradictions.push(...result.contradictions)
        }
      }
    }

    logger.info('Enhanced processing complete', {
      memoriesCount: extractedMemories.length,
      relationshipsCount: allRelationships.length,
      supersededCount: allSupersededIds.length,
      contradictionsCount: allContradictions.length,
    })

    return {
      memories: extractedMemories,
      relationships: allRelationships,
      supersededMemoryIds: [...new Set(allSupersededIds)],
      contradictions: allContradictions,
      detectionResults,
    }
  }

  /**
   * Detect relationships for a single memory using embedding similarity.
   */
  async detectRelationshipsEmbedding(
    memory: Memory,
    options: {
      containerTag?: string
      excludeIds?: string[]
    } = {}
  ): Promise<RelationshipDetectionResult> {
    // Ensure memory has embedding
    if (!memory.embedding || memory.embedding.length === 0) {
      memory.embedding = await this.embeddingService.generateEmbedding(memory.content)
    }

    return this.relationshipDetector.detectRelationships(memory, options)
  }

  /**
   * Detect contradictions among a group of memories.
   */
  async detectContradictions(memories: Memory[]): Promise<Contradiction[]> {
    return this.relationshipDetector.detectContradictionsInGroup(memories)
  }

  /**
   * Index a memory for relationship detection.
   */
  async indexMemory(memory: Memory): Promise<void> {
    const embedding = memory.embedding ?? (await this.embeddingService.generateEmbedding(memory.content))
    this.vectorStore.addMemory(memory, embedding)
  }

  /**
   * Batch index memories for relationship detection.
   */
  async batchIndexMemories(memories: Memory[]): Promise<void> {
    const memoriesToEmbed = memories.filter((m) => !m.embedding || m.embedding.length === 0)

    if (memoriesToEmbed.length > 0) {
      const embeddings = await this.embeddingService.batchEmbed(memoriesToEmbed.map((m) => m.content))

      for (let i = 0; i < memoriesToEmbed.length; i++) {
        const memory = memoriesToEmbed[i]
        const embedding = embeddings[i]
        if (memory && embedding) {
          memory.embedding = embedding
        }
      }
    }

    const items = memories.map((m) => ({
      memory: m,
      embedding: m.embedding!,
    }))

    this.vectorStore.addMemories(items)
  }

  /**
   * Remove a memory from the relationship index.
   */
  removeFromIndex(memoryId: string): boolean {
    return this.vectorStore.removeMemory(memoryId)
  }

  /**
   * Clear the relationship index.
   */
  clearIndex(): void {
    this.vectorStore.clear()
  }

  // ============================================================================
  // Delegation Methods (pass through to base service)
  // ============================================================================

  async extractMemories(content: string): Promise<Memory[]> {
    return this.baseService.extractMemories(content)
  }

  classifyMemoryType(content: string) {
    return this.baseService.classifyMemoryType(content)
  }

  async storeMemory(memory: Memory): Promise<Memory> {
    const stored = await this.baseService.storeMemory(memory)

    // Auto-index if enabled
    if (this.config.autoIndexMemories) {
      await this.indexMemory(stored)
    }

    return stored
  }

  async getMemory(id: string): Promise<Memory | null> {
    return this.baseService.getMemory(id)
  }

  async getAllMemories(): Promise<Memory[]> {
    return this.baseService.getAllMemories()
  }

  async getLatestMemories(): Promise<Memory[]> {
    return this.baseService.getLatestMemories()
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  getConfig(): EnhancedMemoryServiceConfig {
    return { ...this.config }
  }

  /**
   * Update relationship detection configuration.
   */
  updateRelationshipConfig(updates: Partial<RelationshipConfig>): void {
    this.relationshipDetector.updateConfig(updates)
  }

  /**
   * Set LLM provider for verification.
   */
  setLLMProvider(provider: LLMProvider): void {
    this.relationshipDetector.setLLMProvider(provider)
  }

  /**
   * Get the underlying relationship detector.
   */
  getRelationshipDetector(): EmbeddingRelationshipDetector {
    return this.relationshipDetector
  }

  /**
   * Get the underlying base memory service.
   */
  getBaseService(): MemoryService {
    return this.baseService
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let _enhancedServiceInstance: EnhancedMemoryService | null = null

/**
 * Create an enhanced memory service instance.
 */
export function createEnhancedMemoryService(
  config?: Partial<EnhancedMemoryServiceConfig>,
  dependencies?: {
    baseService?: MemoryService
    repository?: MemoryRepository
    embeddingService?: EmbeddingService
    vectorStore?: InMemoryVectorStoreAdapter
    llmProvider?: LLMProvider
  }
): EnhancedMemoryService {
  return new EnhancedMemoryService(config, dependencies)
}

/**
 * Get the singleton enhanced memory service instance.
 */
export function getEnhancedMemoryService(config?: Partial<EnhancedMemoryServiceConfig>): EnhancedMemoryService {
  if (!_enhancedServiceInstance) {
    _enhancedServiceInstance = createEnhancedMemoryService(config)
  }
  return _enhancedServiceInstance
}

/**
 * Reset the singleton instance (for testing).
 */
export function resetEnhancedMemoryService(): void {
  _enhancedServiceInstance = null
}

/**
 * Proxy-based lazy singleton for backwards compatibility.
 */
export const enhancedMemoryService = new Proxy({} as EnhancedMemoryService, {
  get(_, prop) {
    return getEnhancedMemoryService()[prop as keyof EnhancedMemoryService]
  },
})
