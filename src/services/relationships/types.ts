/**
 * Relationship Detection Types
 *
 * Type definitions for embedding-based relationship detection between memories.
 * Supports vector similarity, temporal analysis, entity overlap, and LLM verification.
 */

import type { RelationshipType } from '../../types/index.js'
import type { Memory, Relationship } from '../memory.types.js'

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Similarity thresholds for different relationship types
 */
export interface RelationshipThresholds {
  /** Threshold for 'updates' relationship (high similarity, same topic) */
  updates: number
  /** Threshold for 'extends' relationship (moderate similarity) */
  extends: number
  /** Threshold for 'contradicts' relationship (high similarity but opposing) */
  contradicts: number
  /** Threshold for 'supersedes' relationship (very high similarity) */
  supersedes: number
  /** Threshold for 'related' relationship (lower similarity) */
  related: number
  /** Threshold for 'derives' relationship (moderate, causal) */
  derives: number
}

/**
 * Default similarity thresholds
 */
export const DEFAULT_RELATIONSHIP_THRESHOLDS: RelationshipThresholds = {
  updates: 0.85,
  extends: 0.7,
  contradicts: 0.8,
  supersedes: 0.9,
  related: 0.6,
  derives: 0.65,
}

/**
 * Configuration for the relationship detector
 */
export interface RelationshipConfig {
  /** Similarity thresholds per relationship type */
  thresholds: RelationshipThresholds

  /** Maximum candidates to retrieve for comparison */
  maxCandidates: number

  /** Whether to use LLM for verification of high-confidence relationships */
  enableLLMVerification: boolean

  /** Minimum confidence to trigger LLM verification */
  llmVerificationThreshold: number

  /** Temporal weight for recency bias (0-1) */
  temporalWeight: number

  /** Entity overlap weight for scoring (0-1) */
  entityOverlapWeight: number

  /** Whether to enable contradiction detection */
  enableContradictionDetection: boolean

  /** Batch size for processing relationships */
  batchSize: number

  /** Cache TTL for relationship scores (ms) */
  cacheTTL: number

  /** Whether to detect causal/derivation relationships */
  enableCausalDetection: boolean
}

/**
 * Default relationship detector configuration
 */
export const DEFAULT_RELATIONSHIP_CONFIG: RelationshipConfig = {
  thresholds: DEFAULT_RELATIONSHIP_THRESHOLDS,
  maxCandidates: 50,
  enableLLMVerification: false,
  llmVerificationThreshold: 0.85,
  temporalWeight: 0.1,
  entityOverlapWeight: 0.2,
  enableContradictionDetection: true,
  batchSize: 10,
  cacheTTL: 5 * 60 * 1000, // 5 minutes
  enableCausalDetection: true,
}

// ============================================================================
// Detection Result Types
// ============================================================================

/**
 * Candidate memory for relationship detection
 */
export interface RelationshipCandidate {
  /** The candidate memory */
  memory: Memory
  /** Vector similarity score (0-1) */
  vectorSimilarity: number
  /** Entity overlap score (0-1) */
  entityOverlap: number
  /** Temporal proximity score (0-1, higher = more recent) */
  temporalScore: number
  /** Combined score */
  combinedScore: number
}

/**
 * Detected relationship with scoring details
 */
export interface DetectedRelationship {
  /** The relationship object */
  relationship: Relationship
  /** Combined score for the relationship (0-1) */
  score: number
  /** Vector similarity that triggered the detection */
  vectorSimilarity: number
  /** Entity overlap score */
  entityOverlap: number
  /** Temporal proximity score */
  temporalScore: number
  /** Whether LLM verification was applied */
  llmVerified: boolean
  /** LLM verification confidence (if applied) */
  llmConfidence?: number
  /** Strategy that detected this relationship */
  detectionStrategy: DetectionStrategyType
}

/**
 * Result of relationship detection for a memory
 */
export interface RelationshipDetectionResult {
  /** The source memory analyzed */
  sourceMemory: Memory
  /** All detected relationships */
  relationships: DetectedRelationship[]
  /** Memory IDs that should be marked as superseded */
  supersededMemoryIds: string[]
  /** Detected contradictions (if enabled) */
  contradictions: Contradiction[]
  /** Processing statistics */
  stats: RelationshipDetectionStats
}

/**
 * Statistics for relationship detection
 */
export interface RelationshipDetectionStats {
  /** Total candidates evaluated */
  candidatesEvaluated: number
  /** Total relationships detected */
  relationshipsDetected: number
  /** Breakdown by relationship type */
  byType: Record<RelationshipType, number>
  /** Number of LLM verifications performed */
  llmVerifications: number
  /** Processing time in milliseconds */
  processingTimeMs: number
  /** Whether results were cached */
  fromCache: boolean
}

// ============================================================================
// Contradiction Types
// ============================================================================

/**
 * Detected contradiction between memories
 */
export interface Contradiction {
  /** Unique identifier */
  id: string
  /** First memory ID */
  memoryId1: string
  /** Second memory ID */
  memoryId2: string
  /** Content of first memory */
  content1: string
  /** Content of second memory */
  content2: string
  /** Similarity score between the memories */
  similarity: number
  /** Confidence that these are contradictory (0-1) */
  confidence: number
  /** Type of contradiction */
  type: ContradictionType
  /** Human-readable description of the contradiction */
  description: string
  /** Suggested resolution */
  suggestedResolution?: ContradictionResolution
  /** When the contradiction was detected */
  detectedAt: Date
  /** Whether the contradiction has been resolved */
  resolved: boolean
  /** Resolution notes if resolved */
  resolutionNotes?: string
}

/**
 * Types of contradictions
 */
export type ContradictionType =
  | 'factual' // Direct factual disagreement
  | 'temporal' // Time-based contradiction (old vs new info)
  | 'preference' // Conflicting preferences
  | 'partial' // Partial overlap with conflicting details
  | 'semantic' // Semantically opposite meanings

/**
 * Suggested resolution for a contradiction
 */
export interface ContradictionResolution {
  /** Recommended action */
  action: 'keep_newer' | 'keep_older' | 'merge' | 'keep_both' | 'manual_review'
  /** Reason for the recommendation */
  reason: string
  /** Confidence in the recommendation (0-1) */
  confidence: number
}

// ============================================================================
// Strategy Types (Simplified - kept for backwards compatibility in metadata)
// ============================================================================

/**
 * Detection strategy identifiers used in relationship metadata
 * Note: The strategy pattern has been removed. These are kept for metadata tracking only.
 */
export type DetectionStrategyType =
  | 'similarity' // Pure vector similarity
  | 'temporal' // Time-based relationship inference
  | 'entityOverlap' // Shared entity detection
  | 'llmVerification' // LLM-based classification
  | 'hybrid' // Combined approaches

// ============================================================================
// Vector Store Interface
// ============================================================================

/**
 * Vector search result for relationship detection
 */
export interface VectorSearchResult {
  /** Memory ID */
  memoryId: string
  /** Memory object */
  memory: Memory
  /** Similarity score */
  similarity: number
}

/**
 * Interface for vector store operations needed by relationship detector
 */
export interface VectorStore {
  /**
   * Find similar memories using vector search
   * @param embedding - Query embedding vector
   * @param limit - Maximum results to return
   * @param threshold - Minimum similarity threshold
   * @param filters - Optional metadata filters
   */
  findSimilar(
    embedding: number[],
    limit: number,
    threshold: number,
    filters?: {
      containerTag?: string
      excludeIds?: string[]
    }
  ): Promise<VectorSearchResult[]>
}

// ============================================================================
// LLM Provider Interface
// ============================================================================

/**
 * LLM verification request
 */
export interface LLMVerificationRequest {
  /** The new memory content */
  newContent: string
  /** The existing memory content */
  existingContent: string
  /** Detected relationship type */
  proposedType: RelationshipType
  /** Current confidence score */
  currentConfidence: number
}

/**
 * LLM verification response
 */
export interface LLMVerificationResponse {
  /** Verified relationship type (may differ from proposed) */
  relationshipType: RelationshipType | null
  /** Confidence in the verification (0-1) */
  confidence: number
  /** Explanation of the decision */
  explanation: string
  /** Whether a contradiction was detected */
  isContradiction: boolean
  /** Contradiction details if detected */
  contradictionDetails?: {
    type: ContradictionType
    description: string
  }
}

/**
 * Interface for LLM provider used in verification
 */
export interface LLMProvider {
  /**
   * Verify a proposed relationship using LLM
   */
  verifyRelationship(request: LLMVerificationRequest): Promise<LLMVerificationResponse>

  /**
   * Check if two memories contradict each other
   */
  checkContradiction(
    content1: string,
    content2: string
  ): Promise<{
    isContradiction: boolean
    type?: ContradictionType
    confidence: number
    description: string
  }>
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Cached relationship score
 */
export interface CachedRelationshipScore {
  /** Source memory ID */
  sourceId: string
  /** Target memory ID */
  targetId: string
  /** Cached score */
  score: number
  /** Detected relationship type */
  type: RelationshipType | null
  /** When the cache entry was created */
  cachedAt: number
}

/**
 * Cache key generator
 */
export function generateCacheKey(sourceId: string, targetId: string): string {
  // Ensure consistent ordering for bidirectional relationships
  const [first, second] = [sourceId, targetId].sort()
  return `${first}:${second}`
}
