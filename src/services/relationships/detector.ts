/**
 * Embedding-Based Relationship Detector
 *
 * Main detector class that orchestrates relationship detection between memories
 * using vector similarity, temporal analysis, entity overlap, and optional LLM verification.
 */

import type { RelationshipType, Entity } from '../../types/index.js';
import type { Memory, Relationship } from '../memory.types.js';
import type { EmbeddingService } from '../embedding.service.js';
import { cosineSimilarity } from '../embedding.service.js';
import { generateId } from '../../utils/id.js';
import { getLogger } from '../../utils/logger.js';
import { AppError, ErrorCode } from '../../utils/errors.js';
import type {
  RelationshipConfig,
  RelationshipCandidate,
  RelationshipDetectionResult,
  Contradiction,
  ContradictionType,
  ContradictionResolution,
  VectorStore,
  VectorSearchResult,
  LLMProvider,
  DetectedRelationship,
  RelationshipDetectionStats,
  CachedRelationshipScore,
  LLMVerificationRequest,
  DetectionStrategyType,
} from './types.js';
import { DEFAULT_RELATIONSHIP_CONFIG, generateCacheKey } from './types.js';

const logger = getLogger('EmbeddingRelationshipDetector');

// ============================================================================
// Embedding Helper (candidate list)
// ============================================================================

/**
 * Detect relationships using embeddings from a provided candidate list.
 * This helper is useful when you already have candidate memories
 * and want a single-pass relationship detection result.
 */
export async function detectRelationshipsWithEmbeddings(
  newMemory: Memory,
  candidates: Memory[],
  embeddingService: EmbeddingService,
  options: {
    containerTag?: string;
    config?: Partial<RelationshipConfig>;
  } = {}
): Promise<RelationshipDetectionResult> {
  const vectorStore = new InMemoryVectorStoreAdapter();

  if (candidates.length > 0) {
    const embeddings = await embeddingService.batchEmbed(candidates.map((m) => m.content));
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const embedding = embeddings[i];
      if (candidate && embedding) {
        candidate.embedding = embedding;
        vectorStore.addMemory(candidate, embedding);
      }
    }
  }

  if (!newMemory.embedding || newMemory.embedding.length === 0) {
    newMemory.embedding = await embeddingService.generateEmbedding(newMemory.content);
  }

  const detector = new EmbeddingRelationshipDetector(
    embeddingService,
    vectorStore,
    options.config
  );

  return detector.detectRelationships(newMemory, {
    containerTag: options.containerTag,
    excludeIds: [newMemory.id],
  });
}

// ============================================================================
// Helper Functions (from strategies.ts)
// ============================================================================

/**
 * Create a detected relationship object
 */
function createDetectedRelationship(
  sourceMemory: Memory,
  targetMemory: Memory,
  type: RelationshipType,
  candidate: RelationshipCandidate,
  strategyName: string,
  llmVerified: boolean = false,
  llmConfidence?: number
): DetectedRelationship {
  const relationship: Relationship = {
    id: generateId(),
    sourceMemoryId: sourceMemory.id,
    targetMemoryId: targetMemory.id,
    type,
    confidence: candidate.combinedScore,
    description: `${type} relationship detected via ${strategyName} strategy`,
    createdAt: new Date(),
    metadata: {
      vectorSimilarity: candidate.vectorSimilarity,
      entityOverlap: candidate.entityOverlap,
      temporalScore: candidate.temporalScore,
      detectionStrategy: strategyName,
    },
  };

  // Validate strategy name is a valid DetectionStrategyType
  const validStrategy: DetectionStrategyType =
    strategyName === 'similarity' ||
    strategyName === 'temporal' ||
    strategyName === 'entityOverlap' ||
    strategyName === 'llmVerification' ||
    strategyName === 'hybrid'
      ? strategyName
      : 'hybrid';

  return {
    relationship,
    score: candidate.combinedScore,
    vectorSimilarity: candidate.vectorSimilarity,
    entityOverlap: candidate.entityOverlap,
    temporalScore: candidate.temporalScore,
    llmVerified,
    llmConfidence,
    detectionStrategy: validStrategy,
  };
}

/**
 * Check if content contains update/correction indicators
 */
function hasUpdateIndicators(content: string): boolean {
  const patterns = [
    /\b(?:update|updated|updating|correction|corrected)\b/i,
    /\b(?:now|actually|instead)\b/i,
    /\b(?:changed|revised|modified)\b/i,
    /\b(?:no longer|used to be|previously)\b/i,
  ];
  return patterns.some((p) => p.test(content));
}

/**
 * Check if content contains extension indicators
 */
function hasExtensionIndicators(content: string): boolean {
  const patterns = [
    /\b(?:also|additionally|furthermore|moreover)\b/i,
    /\b(?:in addition|on top of|besides)\b/i,
    /\b(?:extending|building on|adding to)\b/i,
  ];
  return patterns.some((p) => p.test(content));
}

/**
 * Check if content contains contradiction indicators
 */
function hasContradictionIndicators(content: string): boolean {
  const patterns = [
    /\b(?:however|but|although|despite)\b/i,
    /\b(?:contrary|opposite|different)\b/i,
    /\b(?:not true|incorrect|wrong|false)\b/i,
    /\b(?:disagree|dispute|reject)\b/i,
  ];
  return patterns.some((p) => p.test(content));
}

/**
 * Check if content contains supersession indicators
 */
function hasSupersessionIndicators(content: string): boolean {
  const patterns = [
    /\b(?:replaces|supersedes|overrides)\b/i,
    /\b(?:no longer|obsolete|deprecated)\b/i,
    /\b(?:new version|latest|current)\b/i,
  ];
  return patterns.some((p) => p.test(content));
}

/**
 * Check if content contains causal/derivation indicators
 */
function hasCausalIndicators(content: string): boolean {
  const patterns = [
    /\b(?:therefore|thus|hence|consequently)\b/i,
    /\b(?:because|since|as a result)\b/i,
    /\b(?:based on|derived from|follows from)\b/i,
    /\b(?:leads to|results in|causes)\b/i,
  ];
  return patterns.some((p) => p.test(content));
}

// ============================================================================
// In-Memory Vector Store Adapter
// ============================================================================

/**
 * Simple in-memory vector store adapter for relationship detection.
 * Can be replaced with a proper vector database in production.
 */
export class InMemoryVectorStoreAdapter implements VectorStore {
  private entries: Map<string, { memory: Memory; embedding: number[] }> = new Map();

  /**
   * Add a memory with its embedding
   */
  addMemory(memory: Memory, embedding: number[]): void {
    this.entries.set(memory.id, { memory, embedding });
  }

  /**
   * Add multiple memories with their embeddings
   */
  addMemories(items: Array<{ memory: Memory; embedding: number[] }>): void {
    for (const item of items) {
      this.entries.set(item.memory.id, item);
    }
  }

  /**
   * Remove a memory
   */
  removeMemory(memoryId: string): boolean {
    return this.entries.delete(memoryId);
  }

  /**
   * Update a memory's embedding
   */
  updateEmbedding(memoryId: string, embedding: number[]): boolean {
    const entry = this.entries.get(memoryId);
    if (entry) {
      entry.embedding = embedding;
      return true;
    }
    return false;
  }

  /**
   * Get all memories
   */
  getAllMemories(): Memory[] {
    return Array.from(this.entries.values()).map((e) => e.memory);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
  }

  async findSimilar(
    embedding: number[],
    limit: number,
    threshold: number,
    filters?: { containerTag?: string; excludeIds?: string[] }
  ): Promise<VectorSearchResult[]> {
    const results: VectorSearchResult[] = [];
    const excludeSet = new Set(filters?.excludeIds || []);

    for (const [id, entry] of this.entries) {
      if (excludeSet.has(id)) continue;
      if (filters?.containerTag && entry.memory.containerTag !== filters.containerTag) continue;

      const similarity = cosineSimilarity(embedding, entry.embedding);
      if (similarity >= threshold) {
        results.push({
          memoryId: id,
          memory: entry.memory,
          similarity,
        });
      }
    }

    // Sort by similarity descending and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }
}

// ============================================================================
// Embedding Relationship Detector
// ============================================================================

/**
 * Embedding-based relationship detector.
 * Uses vector similarity and configurable strategies to detect relationships
 * between memories.
 */
export class EmbeddingRelationshipDetector {
  private readonly embeddingService: EmbeddingService;
  private readonly vectorStore: VectorStore;
  private readonly config: RelationshipConfig;
  private readonly cache: Map<string, CachedRelationshipScore>;
  private llmProvider?: LLMProvider;

  constructor(
    embeddingService: EmbeddingService,
    vectorStore: VectorStore,
    config: Partial<RelationshipConfig> = {},
    llmProvider?: LLMProvider
  ) {
    this.embeddingService = embeddingService;
    this.vectorStore = vectorStore;
    this.config = { ...DEFAULT_RELATIONSHIP_CONFIG, ...config };
    this.llmProvider = llmProvider;
    this.cache = new Map();

    logger.debug('EmbeddingRelationshipDetector initialized', {
      config: this.config,
      hasLLMProvider: !!llmProvider,
    });
  }

  // ============================================================================
  // Private Detection Methods
  // ============================================================================

  /**
   * Detect relationships using vector similarity thresholds (from SimilarityStrategy)
   */
  private async detectBySimilarity(
    newMemory: Memory,
    candidates: RelationshipCandidate[]
  ): Promise<DetectedRelationship[]> {
    const relationships: DetectedRelationship[] = [];
    const { thresholds } = this.config;

    for (const candidate of candidates) {
      const sim = candidate.vectorSimilarity;
      let detectedType: RelationshipType | null = null;
      let adjustedConfidence = sim;

      // Check for supersedes (highest threshold)
      if (sim >= thresholds.supersedes) {
        if (hasSupersessionIndicators(newMemory.content)) {
          detectedType = 'supersedes';
          adjustedConfidence = Math.min(sim + 0.05, 1.0);
        } else if (hasUpdateIndicators(newMemory.content)) {
          detectedType = 'updates';
        }
      }
      // Check for updates
      else if (sim >= thresholds.updates) {
        if (hasUpdateIndicators(newMemory.content)) {
          detectedType = 'updates';
          adjustedConfidence = Math.min(sim + 0.05, 1.0);
        } else if (
          hasContradictionIndicators(newMemory.content) &&
          this.config.enableContradictionDetection
        ) {
          detectedType = 'contradicts';
        }
      }
      // Check for contradicts
      else if (sim >= thresholds.contradicts && this.config.enableContradictionDetection) {
        if (hasContradictionIndicators(newMemory.content)) {
          detectedType = 'contradicts';
        }
      }
      // Check for extends
      else if (sim >= thresholds.extends) {
        if (hasExtensionIndicators(newMemory.content)) {
          detectedType = 'extends';
          adjustedConfidence = Math.min(sim + 0.05, 1.0);
        } else {
          // High similarity but no explicit indicator - mark as related
          detectedType = 'related';
        }
      }
      // Check for derives
      else if (sim >= thresholds.derives && this.config.enableCausalDetection) {
        if (hasCausalIndicators(newMemory.content)) {
          detectedType = 'derives';
        }
      }
      // Check for related (lowest threshold)
      else if (sim >= thresholds.related) {
        detectedType = 'related';
      }

      if (detectedType) {
        // Update combined score with adjusted confidence
        const adjustedCandidate: RelationshipCandidate = {
          ...candidate,
          combinedScore: adjustedConfidence,
        };

        relationships.push(
          createDetectedRelationship(
            newMemory,
            candidate.memory,
            detectedType,
            adjustedCandidate,
            'similarity'
          )
        );
      }
    }

    return relationships;
  }

  /**
   * Detect relationships using temporal proximity (from TemporalStrategy)
   */
  private async detectByTemporal(
    newMemory: Memory,
    candidates: RelationshipCandidate[]
  ): Promise<DetectedRelationship[]> {
    const relationships: DetectedRelationship[] = [];

    // Only process candidates with moderate similarity
    const relevantCandidates = candidates.filter(
      (c) => c.vectorSimilarity >= this.config.thresholds.related * 0.8
    );

    for (const candidate of relevantCandidates) {
      const timeDiff = Math.abs(
        newMemory.createdAt.getTime() - candidate.memory.createdAt.getTime()
      );
      const oneHour = 60 * 60 * 1000;
      const oneDay = 24 * oneHour;

      // Check for rapid succession updates (within 1 hour)
      if (timeDiff < oneHour && candidate.vectorSimilarity >= 0.75) {
        // New memory likely updates the old one
        const isNewer = newMemory.createdAt > candidate.memory.createdAt;
        if (isNewer && candidate.memory.type === newMemory.type) {
          // Boost temporal score
          const adjustedCandidate: RelationshipCandidate = {
            ...candidate,
            temporalScore: 0.95,
            combinedScore: Math.min(candidate.vectorSimilarity * 0.7 + 0.3, 1.0),
          };

          relationships.push(
            createDetectedRelationship(
              newMemory,
              candidate.memory,
              'updates',
              adjustedCandidate,
              'temporal'
            )
          );
        }
      }
      // Check for related context (within same day)
      else if (timeDiff < oneDay && candidate.vectorSimilarity >= 0.6) {
        // Context-related memories from the same session/day
        if (candidate.memory.containerTag === newMemory.containerTag) {
          const adjustedCandidate: RelationshipCandidate = {
            ...candidate,
            temporalScore: 0.8,
            combinedScore: Math.min(candidate.vectorSimilarity * 0.8 + 0.1, 1.0),
          };

          relationships.push(
            createDetectedRelationship(
              newMemory,
              candidate.memory,
              'related',
              adjustedCandidate,
              'temporal'
            )
          );
        }
      }
    }

    return relationships;
  }

  /**
   * Type guard to check if an entity is valid
   */
  private isValidEntity(entity: unknown): entity is Entity {
    return (
      typeof entity === 'object' &&
      entity !== null &&
      'name' in entity &&
      typeof (entity as Entity).name === 'string'
    );
  }

  /**
   * Detect relationships using entity overlap (from EntityOverlapStrategy)
   */
  private async detectByEntityOverlap(
    newMemory: Memory,
    candidates: RelationshipCandidate[]
  ): Promise<DetectedRelationship[]> {
    const relationships: DetectedRelationship[] = [];

    const rawEntities = newMemory.metadata?.entities;
    const newEntities = Array.isArray(rawEntities)
      ? (rawEntities.filter(this.isValidEntity.bind(this)) as Entity[])
      : [];

    if (newEntities.length === 0) {
      return relationships;
    }

    for (const candidate of candidates) {
      const rawCandidateEntities = candidate.memory.metadata?.entities;
      const candidateEntities = Array.isArray(rawCandidateEntities)
        ? (rawCandidateEntities.filter(this.isValidEntity.bind(this)) as Entity[])
        : [];

      if (candidateEntities.length === 0) continue;

      // Calculate entity overlap
      const names1 = new Set(newEntities.map((e) => e.name.toLowerCase()));
      const names2 = new Set(candidateEntities.map((e) => e.name.toLowerCase()));

      const intersection = [...names1].filter((n) => names2.has(n)).length;
      const union = new Set([...names1, ...names2]).size;
      const entityOverlap = union > 0 ? intersection / union : 0;

      // Significant entity overlap (>50%) suggests strong relationship
      if (entityOverlap >= 0.5) {
        // Combine with vector similarity for relationship type
        const combinedScore =
          candidate.vectorSimilarity * (1 - this.config.entityOverlapWeight) +
          entityOverlap * this.config.entityOverlapWeight;

        let relationshipType: RelationshipType = 'related';

        // High entity overlap + high similarity = likely update or extension
        if (entityOverlap >= 0.8 && candidate.vectorSimilarity >= 0.7) {
          if (hasUpdateIndicators(newMemory.content)) {
            relationshipType = 'updates';
          } else if (hasExtensionIndicators(newMemory.content)) {
            relationshipType = 'extends';
          }
        }

        const adjustedCandidate: RelationshipCandidate = {
          ...candidate,
          entityOverlap,
          combinedScore: Math.min(combinedScore, 1.0),
        };

        relationships.push(
          createDetectedRelationship(
            newMemory,
            candidate.memory,
            relationshipType,
            adjustedCandidate,
            'entityOverlap'
          )
        );
      }
    }

    return relationships;
  }

  /**
   * Merge relationships from multiple detection approaches (from HybridStrategy)
   */
  private mergeRelationships(allRelationships: DetectedRelationship[]): DetectedRelationship[] {
    // Merge results, keeping highest confidence per relationship pair
    const relationshipMap = new Map<string, DetectedRelationship>();

    for (const rel of allRelationships) {
      const key = `${rel.relationship.sourceMemoryId}:${rel.relationship.targetMemoryId}`;
      const existing = relationshipMap.get(key);

      if (!existing || rel.relationship.confidence > existing.relationship.confidence) {
        relationshipMap.set(key, rel);
      }
    }

    return Array.from(relationshipMap.values());
  }

  // ============================================================================
  // Main Detection API
  // ============================================================================

  /**
   * Detect relationships for a new memory.
   * This is the main entry point for relationship detection.
   *
   * @param newMemory - The new memory to analyze
   * @param options - Optional filters
   * @returns Detection result with relationships, superseded IDs, and contradictions
   */
  async detectRelationships(
    newMemory: Memory,
    options: {
      containerTag?: string;
      excludeIds?: string[];
    } = {}
  ): Promise<RelationshipDetectionResult> {
    const startTime = Date.now();
    const stats: RelationshipDetectionStats = {
      candidatesEvaluated: 0,
      relationshipsDetected: 0,
      byType: {
        updates: 0,
        extends: 0,
        derives: 0,
        contradicts: 0,
        related: 0,
        supersedes: 0,
      },
      llmVerifications: 0,
      processingTimeMs: 0,
      fromCache: false,
    };

    try {
      logger.debug('Detecting relationships for memory', {
        memoryId: newMemory.id,
        contentPreview: newMemory.content.substring(0, 50),
      });

      // Step 1: Get embedding for new memory
      const embedding = await this.getOrGenerateEmbedding(newMemory);

      // Step 2: Find similar memories via vector search
      const minThreshold = Math.min(...Object.values(this.config.thresholds));
      const similarResults = await this.vectorStore.findSimilar(
        embedding,
        this.config.maxCandidates,
        minThreshold,
        {
          containerTag: options.containerTag,
          excludeIds: [...(options.excludeIds || []), newMemory.id],
        }
      );

      stats.candidatesEvaluated = similarResults.length;

      if (similarResults.length === 0) {
        logger.debug('No similar memories found', { memoryId: newMemory.id });
        return {
          sourceMemory: newMemory,
          relationships: [],
          supersededMemoryIds: [],
          contradictions: [],
          stats: {
            ...stats,
            processingTimeMs: Date.now() - startTime,
          },
        };
      }

      // Step 3: Build candidates with full scoring
      const candidates = await this.buildCandidates(newMemory, similarResults);

      // Step 4: Run detection approaches
      const similarityRels = await this.detectBySimilarity(newMemory, candidates);
      const temporalRels =
        this.config.temporalWeight > 0 ? await this.detectByTemporal(newMemory, candidates) : [];
      const entityRels =
        this.config.entityOverlapWeight > 0
          ? await this.detectByEntityOverlap(newMemory, candidates)
          : [];

      // Merge results from all approaches
      const allDetectedRelationships = this.mergeRelationships([
        ...similarityRels,
        ...temporalRels,
        ...entityRels,
      ]);

      // Step 5: Process results
      const relationships = allDetectedRelationships;
      const supersededMemoryIds: string[] = [];
      const contradictions: Contradiction[] = [];

      for (const rel of relationships) {
        stats.byType[rel.relationship.type]++;
        stats.relationshipsDetected++;

        if (rel.llmVerified) {
          stats.llmVerifications++;
        }

        // Track superseded memories
        if (rel.relationship.type === 'updates' || rel.relationship.type === 'supersedes') {
          supersededMemoryIds.push(rel.relationship.targetMemoryId);
        }
      }

      // Step 6: Detect contradictions if enabled
      if (this.config.enableContradictionDetection) {
        const detectedContradictions = await this.detectContradictions(
          newMemory,
          candidates.filter((c) => c.vectorSimilarity >= this.config.thresholds.contradicts)
        );
        contradictions.push(...detectedContradictions);
      }

      stats.processingTimeMs = Date.now() - startTime;

      logger.info('Relationship detection complete', {
        memoryId: newMemory.id,
        stats,
      });

      return {
        sourceMemory: newMemory,
        relationships,
        supersededMemoryIds: [...new Set(supersededMemoryIds)],
        contradictions,
        stats,
      };
    } catch (error) {
      logger.errorWithException('Relationship detection failed', error, {
        memoryId: newMemory.id,
      });
      throw AppError.from(error, ErrorCode.INTERNAL_ERROR);
    }
  }

  /**
   * Batch detect relationships for multiple memories.
   * More efficient than calling detectRelationships for each memory.
   */
  async batchDetectRelationships(
    memories: Memory[],
    options: {
      containerTag?: string;
    } = {}
  ): Promise<RelationshipDetectionResult[]> {
    const results: RelationshipDetectionResult[] = [];
    const processedIds = new Set<string>();

    // Process in batches
    for (let i = 0; i < memories.length; i += this.config.batchSize) {
      const batch = memories.slice(i, i + this.config.batchSize);

      const batchResults = await Promise.all(
        batch.map((memory) =>
          this.detectRelationships(memory, {
            containerTag: options.containerTag,
            excludeIds: [...processedIds],
          })
        )
      );

      for (const result of batchResults) {
        results.push(result);
        processedIds.add(result.sourceMemory.id);
      }
    }

    return results;
  }

  // ============================================================================
  // Contradiction Detection
  // ============================================================================

  /**
   * Detect contradictions between a memory and candidates.
   */
  async detectContradictions(
    memory: Memory,
    candidates: RelationshipCandidate[]
  ): Promise<Contradiction[]> {
    const contradictions: Contradiction[] = [];

    for (const candidate of candidates) {
      // Check for contradiction indicators in content
      const contradictionScore = this.calculateContradictionScore(
        memory.content,
        candidate.memory.content,
        candidate.vectorSimilarity
      );

      if (contradictionScore.isContradiction) {
        const contradiction: Contradiction = {
          id: generateId(),
          memoryId1: memory.id,
          memoryId2: candidate.memory.id,
          content1: memory.content,
          content2: candidate.memory.content,
          similarity: candidate.vectorSimilarity,
          confidence: contradictionScore.confidence,
          type: contradictionScore.type,
          description: contradictionScore.description,
          suggestedResolution: this.suggestResolution(memory, candidate.memory),
          detectedAt: new Date(),
          resolved: false,
        };

        // Optionally verify with LLM
        if (this.llmProvider && this.config.enableLLMVerification) {
          try {
            const llmResult = await this.llmProvider.checkContradiction(
              memory.content,
              candidate.memory.content
            );

            if (llmResult.isContradiction) {
              contradiction.confidence = llmResult.confidence;
              if (llmResult.type) {
                contradiction.type = llmResult.type;
              }
              contradiction.description = llmResult.description;
            } else {
              // LLM says no contradiction, skip
              continue;
            }
          } catch (error) {
            logger.warn('LLM contradiction check failed', {
              error: error instanceof Error ? error.message : 'Unknown',
            });
          }
        }

        contradictions.push(contradiction);
      }
    }

    return contradictions;
  }

  /**
   * Check multiple memories for contradictions among themselves.
   */
  async detectContradictionsInGroup(memories: Memory[]): Promise<Contradiction[]> {
    const contradictions: Contradiction[] = [];

    // Get embeddings for all memories
    const embeddings = await Promise.all(memories.map((m) => this.getOrGenerateEmbedding(m)));

    // Compare each pair
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const memory1 = memories[i]!;
        const memory2 = memories[j]!;
        const embedding1 = embeddings[i]!;
        const embedding2 = embeddings[j]!;

        const similarity = cosineSimilarity(embedding1, embedding2);

        if (similarity >= this.config.thresholds.contradicts) {
          const candidate: RelationshipCandidate = {
            memory: memory2,
            vectorSimilarity: similarity,
            entityOverlap: 0,
            temporalScore: 0,
            combinedScore: similarity,
          };

          const detectedContradictions = await this.detectContradictions(memory1, [candidate]);

          contradictions.push(...detectedContradictions);
        }
      }
    }

    return contradictions;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get or generate embedding for a memory
   */
  private async getOrGenerateEmbedding(memory: Memory): Promise<number[]> {
    if (memory.embedding && memory.embedding.length > 0) {
      return memory.embedding;
    }

    return this.embeddingService.generateEmbedding(memory.content);
  }

  /**
   * Build full candidates with all scores
   */
  private async buildCandidates(
    newMemory: Memory,
    searchResults: VectorSearchResult[]
  ): Promise<RelationshipCandidate[]> {
    const candidates: RelationshipCandidate[] = [];
    const now = Date.now();

    for (const result of searchResults) {
      // Calculate entity overlap
      const entityOverlap = this.calculateEntityOverlap(
        newMemory.metadata?.entities || [],
        result.memory.metadata?.entities || []
      );

      // Calculate temporal score (recency bias)
      const timeDiff = now - result.memory.createdAt.getTime();
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      const temporalScore = Math.exp(-timeDiff / oneWeek);

      // Calculate combined score
      const combinedScore = this.calculateCombinedScore(
        result.similarity,
        entityOverlap,
        temporalScore
      );

      candidates.push({
        memory: result.memory,
        vectorSimilarity: result.similarity,
        entityOverlap,
        temporalScore,
        combinedScore,
      });
    }

    // Sort by combined score
    candidates.sort((a, b) => b.combinedScore - a.combinedScore);

    return candidates;
  }

  /**
   * Calculate entity overlap between two entity lists
   */
  private calculateEntityOverlap(entities1: unknown[], entities2: unknown[]): number {
    if (!Array.isArray(entities1) || !Array.isArray(entities2)) return 0;
    if (entities1.length === 0 || entities2.length === 0) return 0;

    const names1 = new Set(
      entities1
        .filter((e): e is { name: string } => typeof e === 'object' && e !== null && 'name' in e)
        .map((e) => e.name.toLowerCase())
    );
    const names2 = new Set(
      entities2
        .filter((e): e is { name: string } => typeof e === 'object' && e !== null && 'name' in e)
        .map((e) => e.name.toLowerCase())
    );

    const intersection = [...names1].filter((n) => names2.has(n)).length;
    const union = new Set([...names1, ...names2]).size;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Calculate combined score from multiple signals
   */
  private calculateCombinedScore(
    vectorSimilarity: number,
    entityOverlap: number,
    temporalScore: number
  ): number {
    const weights = {
      vector: 1 - this.config.temporalWeight - this.config.entityOverlapWeight,
      temporal: this.config.temporalWeight,
      entity: this.config.entityOverlapWeight,
    };

    return (
      vectorSimilarity * weights.vector +
      temporalScore * weights.temporal +
      entityOverlap * weights.entity
    );
  }

  /**
   * Calculate contradiction score between two pieces of content
   */
  private calculateContradictionScore(
    content1: string,
    content2: string,
    similarity: number
  ): {
    isContradiction: boolean;
    type: ContradictionType;
    confidence: number;
    description: string;
  } {
    const lower1 = content1.toLowerCase();
    const lower2 = content2.toLowerCase();

    // Check for negation patterns
    const negationPatterns = [
      /\bnot\b/,
      /\bno\b/,
      /\bnever\b/,
      /\bwon't\b/,
      /\bdon't\b/,
      /\bdoesn't\b/,
      /\bisn't\b/,
      /\baren't\b/,
    ];

    const hasNegation1 = negationPatterns.some((p) => p.test(lower1));
    const hasNegation2 = negationPatterns.some((p) => p.test(lower2));

    // XOR negation (one has negation, other doesn't) with high similarity = potential contradiction
    if (hasNegation1 !== hasNegation2 && similarity >= 0.75) {
      return {
        isContradiction: true,
        type: 'factual',
        confidence: similarity * 0.9,
        description: 'Potentially contradictory statements detected (negation asymmetry)',
      };
    }

    // Check for opposite adjectives/adverbs
    const opposites: [RegExp, RegExp][] = [
      [/\bgood\b/, /\bbad\b/],
      [/\bhigh\b/, /\blow\b/],
      [/\bfast\b/, /\bslow\b/],
      [/\btrue\b/, /\bfalse\b/],
      [/\byes\b/, /\bno\b/],
      [/\blove\b/, /\bhate\b/],
      [/\blike\b/, /\bdislike\b/],
      [/\bprefer\b/, /\bavoid\b/],
    ];

    for (const [pattern1, pattern2] of opposites) {
      if (
        (pattern1.test(lower1) && pattern2.test(lower2)) ||
        (pattern2.test(lower1) && pattern1.test(lower2))
      ) {
        return {
          isContradiction: true,
          type: 'semantic',
          confidence: similarity * 0.85,
          description: 'Semantically opposite statements detected',
        };
      }
    }

    // Check for temporal contradiction indicators
    const temporalPatterns = [/\bused to\b/, /\bno longer\b/, /\bpreviously\b/, /\bformerly\b/];

    if (temporalPatterns.some((p) => p.test(lower1) || p.test(lower2)) && similarity >= 0.7) {
      return {
        isContradiction: true,
        type: 'temporal',
        confidence: similarity * 0.8,
        description: 'Temporal update detected - information may have changed',
      };
    }

    return {
      isContradiction: false,
      type: 'partial',
      confidence: 0,
      description: 'No contradiction detected',
    };
  }

  /**
   * Suggest resolution for a contradiction
   */
  private suggestResolution(memory1: Memory, memory2: Memory): ContradictionResolution {
    // Prefer newer information by default
    const isMemory1Newer = memory1.createdAt > memory2.createdAt;

    // Check confidence levels
    const confidence1 = memory1.confidence ?? 0.5;
    const confidence2 = memory2.confidence ?? 0.5;

    if (Math.abs(confidence1 - confidence2) > 0.2) {
      // Significant confidence difference - keep higher confidence
      return {
        action: confidence1 > confidence2 ? 'keep_newer' : 'keep_older',
        reason: `Higher confidence memory (${Math.max(confidence1, confidence2).toFixed(2)}) should be preferred`,
        confidence: 0.7,
      };
    }

    if (isMemory1Newer) {
      return {
        action: 'keep_newer',
        reason: 'Newer information typically supersedes older information',
        confidence: 0.6,
      };
    }

    return {
      action: 'manual_review',
      reason: 'Unable to automatically determine which memory is more accurate',
      confidence: 0.4,
    };
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Get cached relationship score
   */
  getCachedScore(sourceId: string, targetId: string): CachedRelationshipScore | null {
    const key = generateCacheKey(sourceId, targetId);
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.cachedAt < this.config.cacheTTL) {
      return cached;
    }

    // Cache expired
    if (cached) {
      this.cache.delete(key);
    }

    return null;
  }

  /**
   * Cache a relationship score
   */
  cacheScore(
    sourceId: string,
    targetId: string,
    score: number,
    type: RelationshipType | null
  ): void {
    const key = generateCacheKey(sourceId, targetId);
    this.cache.set(key, {
      sourceId,
      targetId,
      score,
      type,
      cachedAt: Date.now(),
    });
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; oldestEntry: number | null } {
    let oldest: number | null = null;

    for (const entry of this.cache.values()) {
      if (oldest === null || entry.cachedAt < oldest) {
        oldest = entry.cachedAt;
      }
    }

    return {
      size: this.cache.size,
      oldestEntry: oldest,
    };
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get current configuration
   */
  getConfig(): RelationshipConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<RelationshipConfig>): void {
    Object.assign(this.config, updates);
    logger.debug('Configuration updated', { updates });
  }

  /**
   * Set LLM provider
   */
  setLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an embedding relationship detector with default configuration
 */
export function createEmbeddingRelationshipDetector(
  embeddingService: EmbeddingService,
  vectorStore?: VectorStore,
  config?: Partial<RelationshipConfig>,
  llmProvider?: LLMProvider
): EmbeddingRelationshipDetector {
  const store = vectorStore ?? new InMemoryVectorStoreAdapter();
  return new EmbeddingRelationshipDetector(embeddingService, store, config, llmProvider);
}
