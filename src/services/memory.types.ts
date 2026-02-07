/**
 * Memory Types for Supermemory Clone
 *
 * Defines the core data structures for the memory system including
 * memories, relationships, and classification types.
 *
 * Note: These types extend the base types from ../types/index.ts
 * for use specifically within the memory service layer.
 */

import type {
  Memory as BaseMemory,
  MemoryType as BaseMemoryType,
  MemoryRelationship,
  RelationshipType as BaseRelationshipType,
  Entity,
} from '../types/index.js';

// Re-export base types for convenience
export type { BaseMemory, MemoryRelationship, Entity };
export type MemoryType = BaseMemoryType;
export type RelationshipType = BaseRelationshipType;

/**
 * Service-level memory type (compatible with base Memory)
 * Includes additional service-specific fields
 */
export interface Memory extends BaseMemory {
  /** Source content this memory was extracted from */
  sourceContent?: string;

  /** Source identifier (URL, document ID, etc.) */
  sourceId?: string;

  /** Confidence score of extraction (0-1) - moved to top level for convenience */
  confidence: number;
}

/**
 * Relationship edge between two memories (standalone, for graph storage)
 */
export interface Relationship {
  /** Unique identifier */
  id: string;

  /** Source memory ID */
  sourceMemoryId: string;

  /** Target memory ID */
  targetMemoryId: string;

  /** Type of relationship */
  type: BaseRelationshipType;

  /** Confidence score for this relationship (0-1) */
  confidence: number;

  /** Optional description of the relationship */
  description?: string;

  /** Timestamp of creation */
  createdAt: Date;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Confidence levels for memory extraction and relationships
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Result of memory extraction from content
 */
export interface MemoryExtractionResult {
  /** Extracted memories */
  memories: Memory[];

  /** Raw extraction response (for debugging) */
  rawResponse?: string;

  /** Processing statistics */
  stats: {
    totalExtracted: number;
    factsCount: number;
    preferencesCount: number;
    episodesCount: number;
    processingTimeMs: number;
  };
}

/**
 * Result of relationship detection
 */
export interface RelationshipDetectionResult {
  /** Detected relationships */
  relationships: Relationship[];

  /** Memories that should be marked as superseded */
  supersededMemoryIds: string[];

  /** Processing statistics */
  stats: {
    totalRelationships: number;
    updatesCount: number;
    extendsCount: number;
    contradictsCount: number;
    processingTimeMs: number;
  };
}

/**
 * Update check result
 */
export interface UpdateCheckResult {
  /** Whether the new memory updates an existing one */
  isUpdate: boolean;

  /** The existing memory being updated (if applicable) */
  existingMemory?: Memory;

  /** Confidence of the update detection */
  confidence: number;

  /** Reason for the determination */
  reason: string;
}

/**
 * Extension check result
 */
export interface ExtensionCheckResult {
  /** Whether the new memory extends an existing one */
  isExtension: boolean;

  /** The existing memory being extended (if applicable) */
  existingMemory?: Memory;

  /** Confidence of the extension detection */
  confidence: number;

  /** Reason for the determination */
  reason: string;
}

/**
 * Options for memory queries
 */
export interface MemoryQueryOptions {
  /** Filter by container tag */
  containerTag?: string;

  /** Filter by memory type */
  type?: BaseMemoryType;

  /** Only return latest versions */
  latestOnly?: boolean;

  /** Minimum confidence threshold */
  minConfidence?: number;

  /** Maximum number of results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Sort field */
  sortBy?: 'createdAt' | 'updatedAt' | 'confidence';

  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Options for semantic search
 */
export interface SemanticSearchOptions extends MemoryQueryOptions {
  /** Query text to search for */
  query: string;

  /** Similarity threshold (0-1) */
  similarityThreshold?: number;
}

/**
 * Configuration for the memory service
 */
export interface MemoryServiceConfig {
  /** Default container tag for new memories */
  defaultContainerTag: string;

  /** Minimum confidence threshold for storing memories */
  minConfidenceThreshold: number;

  /** Whether to automatically detect relationships */
  autoDetectRelationships: boolean;

  /** Maximum memories to compare for relationship detection */
  maxRelationshipComparisons: number;

  /** Embedding model configuration */
  embeddingConfig?: {
    model: string;
    dimensions: number;
  };

  /** LLM configuration for extraction */
  llmConfig?: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_MEMORY_CONFIG: MemoryServiceConfig = {
  defaultContainerTag: 'default',
  minConfidenceThreshold: 0.5,
  autoDetectRelationships: true,
  maxRelationshipComparisons: 100,
  embeddingConfig: {
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },
  llmConfig: {
    model: 'gpt-4o-mini',
    temperature: 0.1,
    maxTokens: 2000,
  },
};
