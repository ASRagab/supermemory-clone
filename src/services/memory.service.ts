/**
 * Memory Service - Core Memory Operations
 *
 * Handles extraction, classification, and relationship detection for memories.
 * This is the main service layer that orchestrates memory operations.
 *
 * LLM Integration: Uses LLM-based extraction when available, with automatic
 * fallback to regex-based extraction if no LLM provider is configured.
 *
 * Note: All storage operations are delegated to the MemoryRepository.
 * No in-memory caching is done here to avoid storage inconsistency.
 */

import type {
  Memory as BaseMemory,
  MemoryType,
  MemoryRelationship,
  RelationshipType,
  Entity,
} from '../types/index.js';
import { generateId } from '../utils/id.js';
import { getLogger } from '../utils/logger.js';
import { AppError, ValidationError, ErrorCode } from '../utils/errors.js';
import { validate, validateMemoryContent, containerTagSchema } from '../utils/validation.js';
import {
  Memory,
  Relationship,
  MemoryExtractionResult,
  RelationshipDetectionResult,
  UpdateCheckResult,
  ExtensionCheckResult,
  MemoryServiceConfig,
  DEFAULT_MEMORY_CONFIG,
} from './memory.types.js';
import { MemoryRepository, getMemoryRepository } from './memory.repository.js';
import {
  getLLMProvider,
  isLLMAvailable,
  type LLMProvider,
  type LLMExtractionResult,
  type LLMRelationshipResult,
  LLMError,
  getMemoryClassifier,
  getContradictionDetector,
  getMemoryExtensionDetector,
} from './llm/index.js';
import {
  classifyMemoryTypeHeuristically,
  countMemoryTypeMatches,
} from './llm/heuristics.js';

const logger = getLogger('MemoryService');

// ============================================================================
// Relationship Detection Patterns
// ============================================================================

/**
 * Patterns indicating a memory updates or corrects previous information.
 *
 * @example "Actually, the deadline was moved to Friday" - update indicator
 * @example "Correction: the API uses v2, not v1" - explicit correction
 */
const UPDATE_INDICATOR_PATTERNS: readonly RegExp[] = [
  /** Matches update/correction verbs: update, updated, correction, corrected */
  /\b(?:update|updated|updating|correction|corrected)\b/i,
  /** Matches correction adverbs: now, actually, instead */
  /\b(?:now|actually|instead)\b/i,
  /** Matches revision verbs: changed, revised, modified */
  /\b(?:changed|revised|modified)\b/i,
] as const;

/**
 * Patterns indicating a memory extends or adds to previous information.
 *
 * @example "Additionally, the API also supports batch operations"
 * @example "Building on the previous point..."
 */
const EXTENSION_INDICATOR_PATTERNS: readonly RegExp[] = [
  /** Matches additive conjunctions: also, additionally, furthermore, moreover */
  /\b(?:also|additionally|furthermore|moreover)\b/i,
  /** Matches additive phrases: in addition, on top of, besides */
  /\b(?:in addition|on top of|besides)\b/i,
  /** Matches building phrases: extending, building on, adding to */
  /\b(?:extending|building on|adding to)\b/i,
] as const;

/**
 * Patterns indicating a memory is derived from or caused by another.
 *
 * @example "Therefore, we need to update the schema"
 * @example "Based on the requirements, we chose PostgreSQL"
 */
const DERIVATION_INDICATOR_PATTERNS: readonly RegExp[] = [
  /** Matches consequence adverbs: therefore, thus, hence, consequently */
  /\b(?:therefore|thus|hence|consequently)\b/i,
  /** Matches causal conjunctions: because, since, as a result */
  /\b(?:because|since|as a result)\b/i,
  /** Matches derivation phrases: based on, derived from, follows from */
  /\b(?:based on|derived from|follows from)\b/i,
] as const;

/**
 * Patterns indicating a memory contradicts previous information.
 *
 * @example "However, the new tests show different results"
 * @example "That's not true; the API returns JSON, not XML"
 */
const CONTRADICTION_INDICATOR_PATTERNS: readonly RegExp[] = [
  /** Matches contrast conjunctions: however, but, although, despite */
  /\b(?:however|but|although|despite)\b/i,
  /** Matches opposition words: contrary, opposite, different */
  /\b(?:contrary|opposite|different)\b/i,
  /** Matches negation phrases: not true, incorrect, wrong */
  /\b(?:not true|incorrect|wrong)\b/i,
] as const;

/**
 * Patterns indicating a memory is semantically related to another.
 *
 * @example "This is related to the caching discussion"
 * @example "See also the authentication module docs"
 */
const RELATION_INDICATOR_PATTERNS: readonly RegExp[] = [
  /** Matches relation words: related, similar, like, same */
  /\b(?:related|similar|like|same)\b/i,
  /** Matches connection words: connected, linked, associated */
  /\b(?:connected|linked|associated)\b/i,
  /** Matches reference phrases: see also, refer to, compare */
  /\b(?:see also|refer to|compare)\b/i,
] as const;

/**
 * Patterns indicating a memory supersedes or replaces previous information.
 *
 * @example "This replaces the old authentication flow"
 * @example "The previous approach is now deprecated"
 */
const SUPERSESSION_INDICATOR_PATTERNS: readonly RegExp[] = [
  /** Matches replacement verbs: replaces, supersedes, overrides */
  /\b(?:replaces|supersedes|overrides)\b/i,
  /** Matches obsolescence phrases: no longer, obsolete, deprecated */
  /\b(?:no longer|obsolete|deprecated)\b/i,
  /** Matches recency phrases: new version, latest, current */
  /\b(?:new version|latest|current)\b/i,
] as const;

/**
 * Combined relationship indicator patterns for relationship detection.
 * Maps each RelationshipType to its corresponding regex patterns.
 */
const RELATIONSHIP_INDICATORS: Record<RelationshipType, readonly RegExp[]> = {
  updates: UPDATE_INDICATOR_PATTERNS,
  extends: EXTENSION_INDICATOR_PATTERNS,
  derives: DERIVATION_INDICATOR_PATTERNS,
  contradicts: CONTRADICTION_INDICATOR_PATTERNS,
  related: RELATION_INDICATOR_PATTERNS,
  supersedes: SUPERSESSION_INDICATOR_PATTERNS,
};

// ============================================================================
// Entity Extraction Patterns
// ============================================================================

/**
 * Patterns for extracting person names from text.
 *
 * @example "Dr. John Smith" - matches honorific + name pattern
 * @example "John Smith" - matches two capitalized words
 */
const PERSON_ENTITY_PATTERNS: readonly RegExp[] = [
  /** Matches names with honorific prefixes: Mr., Mrs., Ms., Dr., Prof. */
  /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g,
  /** Matches two consecutive capitalized words (First Last name pattern) */
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
] as const;

/**
 * Patterns for extracting place/location names from text.
 *
 * @example "based in San Francisco" - matches preposition + place pattern
 * @example "Tokyo" - matches known major city
 */
const PLACE_ENTITY_PATTERNS: readonly RegExp[] = [
  /** Matches locations after prepositions: in, at, from, to */
  /\b(?:in|at|from|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gi,
  /** Matches known major cities (extensible list) */
  /\b(?:New York|Los Angeles|San Francisco|London|Paris|Tokyo|Berlin)\b/gi,
] as const;

/**
 * Patterns for extracting organization names from text.
 *
 * @example "Acme Corp." - matches corporate suffix
 * @example "Google" - matches known tech company
 */
const ORGANIZATION_ENTITY_PATTERNS: readonly RegExp[] = [
  /** Matches corporate suffixes: Inc., Corp., LLC, Ltd., Company, Organization */
  /\b(?:Inc\.|Corp\.|LLC|Ltd\.|Company|Organization)\b/gi,
  /** Matches known major tech companies (extensible list) */
  /\b(?:Google|Microsoft|Apple|Amazon|Meta|OpenAI)\b/gi,
] as const;

/**
 * Patterns for extracting dates from text.
 *
 * @example "12/25/2024" - matches numeric date format
 * @example "December 25, 2024" - matches month name format
 */
const DATE_ENTITY_PATTERNS: readonly RegExp[] = [
  /** Matches numeric date formats: MM/DD/YYYY, DD-MM-YY, etc. */
  /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g,
  /** Matches month name formats: January 15, 2024 or January 15 */
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?\b/gi,
] as const;

/**
 * Combined entity extraction patterns.
 * Maps each entity type to its corresponding regex patterns.
 */
const ENTITY_PATTERNS: Record<string, readonly RegExp[]> = {
  person: PERSON_ENTITY_PATTERNS,
  place: PLACE_ENTITY_PATTERNS,
  organization: ORGANIZATION_ENTITY_PATTERNS,
  date: DATE_ENTITY_PATTERNS,
};

// ============================================================================
// Memory Service
// ============================================================================

export class MemoryService {
  private repository: MemoryRepository;
  private config: MemoryServiceConfig;
  private llmProvider: LLMProvider | null = null;
  private useLLM: boolean;
  // Note: Removed redundant `this.memories` Map to avoid dual storage inconsistency.
  // All storage operations now go through the repository only.

  constructor(config: Partial<MemoryServiceConfig> = {}, repository?: MemoryRepository) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.repository = repository ?? getMemoryRepository();

    // Initialize LLM provider if available
    this.useLLM = isLLMAvailable();
    if (this.useLLM) {
      try {
        this.llmProvider = getLLMProvider();
        logger.info('LLM provider initialized for memory extraction', {
          provider: this.llmProvider.type,
        });
      } catch (error) {
        logger.warn('Failed to initialize LLM provider, falling back to regex', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.useLLM = false;
      }
    } else {
      logger.info('No LLM provider configured, using regex-based extraction');
    }

    logger.debug('MemoryService initialized', {
      config: this.config,
      useLLM: this.useLLM,
    });
  }

  // ============================================================================
  // Core API Methods (as specified in requirements)
  // ============================================================================

  /**
   * Extract discrete memories/facts from content
   *
   * Uses LLM-based extraction when available, with automatic fallback
   * to regex-based extraction if LLM fails or is not configured.
   *
   * @param content - The text content to extract memories from
   * @param options - Optional extraction options
   * @returns Promise<Memory[]> - Array of extracted memories
   * @throws ValidationError if content is empty or invalid
   */
  async extractMemories(
    content: string,
    options: {
      containerTag?: string;
      minConfidence?: number;
      maxMemories?: number;
      forceLLM?: boolean;
      forceRegex?: boolean;
    } = {}
  ): Promise<Memory[]> {
    try {
      validateMemoryContent(content);
      if (options.containerTag !== undefined) {
        validate(containerTagSchema, options.containerTag);
      }
      logger.debug('Extracting memories from content', {
        contentLength: content.length,
        useLLM: this.useLLM && !options.forceRegex,
      });

      // Determine extraction method
      const shouldUseLLM =
        !options.forceRegex &&
        (options.forceLLM || (this.useLLM && this.llmProvider?.isAvailable()));

      if (shouldUseLLM && this.llmProvider) {
        try {
          return await this.extractMemoriesWithLLM(content, options);
        } catch (error) {
          // Log and fallback to regex
          logger.warn('LLM extraction failed, falling back to regex', {
            error: error instanceof Error ? error.message : String(error),
            isRetryable: error instanceof LLMError ? error.retryable : false,
          });
        }
      }

      // Fallback to regex-based extraction
      return this.extractMemoriesWithRegex(content, options);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      logger.errorWithException('Failed to extract memories', error);
      throw AppError.from(error, ErrorCode.EXTRACTION_ERROR);
    }
  }

  /**
   * Extract memories using LLM provider
   */
  private async extractMemoriesWithLLM(
    content: string,
    options: {
      containerTag?: string;
      minConfidence?: number;
      maxMemories?: number;
    }
  ): Promise<Memory[]> {
    if (!this.llmProvider) {
      throw new AppError('LLM provider not available', ErrorCode.INTERNAL_ERROR);
    }

    const startTime = Date.now();
    const result: LLMExtractionResult = await this.llmProvider.extractMemories(content, {
      containerTag: options.containerTag ?? this.config.defaultContainerTag,
      minConfidence: options.minConfidence ?? this.config.minConfidenceThreshold,
      maxMemories: options.maxMemories,
      extractEntities: true,
      extractKeywords: true,
    });

    // Convert LLM results to Memory objects
    const memories: Memory[] = result.memories.map((extracted) => ({
      id: generateId(),
      content: extracted.content,
      type: extracted.type,
      relationships: [],
      isLatest: true,
      containerTag: options.containerTag ?? this.config.defaultContainerTag,
      sourceContent: content.substring(0, 500),
      confidence: extracted.confidence,
      metadata: {
        confidence: extracted.confidence,
        extractedFrom: content.substring(0, 100),
        keywords: extracted.keywords,
        entities: extracted.entities,
        extractionMethod: 'llm',
        llmProvider: result.provider,
        tokensUsed: result.tokensUsed?.total,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    logger.info('Memories extracted with LLM', {
      count: memories.length,
      provider: result.provider,
      cached: result.cached,
      processingTimeMs: Date.now() - startTime,
      tokensUsed: result.tokensUsed?.total,
    });

    return memories;
  }

  /**
   * Extract memories using regex-based patterns (fallback)
   */
  private extractMemoriesWithRegex(
    content: string,
    options: {
      containerTag?: string;
      minConfidence?: number;
      maxMemories?: number;
    }
  ): Memory[] {
    const sentences = this.splitIntoSentences(content);
    const memories: Memory[] = [];
    const maxMemories = options.maxMemories ?? 50;
    const minConfidence = options.minConfidence ?? this.config.minConfidenceThreshold;

    for (const sentence of sentences) {
      if (memories.length >= maxMemories) break;
      if (sentence.trim().length < 10) continue;

      const type = this.classifyMemoryType(sentence);
      const entities = this.extractEntities(sentence);
      const keywords = this.extractKeywords(sentence);
      const confidence = this.calculateConfidence(sentence, type);

      if (confidence < minConfidence) continue;

      const memory: Memory = {
        id: generateId(),
        content: sentence.trim(),
        type,
        relationships: [],
        isLatest: true,
        containerTag: options.containerTag ?? this.config.defaultContainerTag,
        sourceContent: content.substring(0, 500),
        confidence,
        metadata: {
          confidence,
          extractedFrom: content.substring(0, 100),
          keywords,
          entities,
          extractionMethod: 'regex',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      memories.push(memory);
    }

    logger.info('Memories extracted with regex', { count: memories.length });
    return memories;
  }

  /**
   * Detect relationships between a new memory and existing memories
   *
   * Uses LLM-based detection when available, with automatic fallback
   * to pattern-based detection if LLM fails or is not configured.
   *
   * @param newMemory - The new memory to check
   * @param existingMemories - Array of existing memories to compare against
   * @param options - Optional detection options
   * @returns Promise<Relationship[]> - Array of detected relationships
   */
  async detectRelationshipsAsync(
    newMemory: Memory,
    existingMemories: Memory[],
    options: {
      minConfidence?: number;
      maxRelationships?: number;
      forceLLM?: boolean;
      forceRegex?: boolean;
    } = {}
  ): Promise<Relationship[]> {
    // Limit comparisons for performance
    const memoriesToCompare = existingMemories.slice(0, this.config.maxRelationshipComparisons);

    if (memoriesToCompare.length === 0) {
      return [];
    }

    const shouldUseLLM =
      !options.forceRegex && (options.forceLLM || (this.useLLM && this.llmProvider?.isAvailable()));

    if (shouldUseLLM && this.llmProvider) {
      try {
        return await this.detectRelationshipsWithLLM(newMemory, memoriesToCompare, options);
      } catch (error) {
        logger.warn('LLM relationship detection failed, falling back to patterns', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Fallback to pattern-based detection
    return this.detectRelationships(newMemory, memoriesToCompare);
  }

  /**
   * Detect relationships using LLM provider
   */
  private async detectRelationshipsWithLLM(
    newMemory: Memory,
    existingMemories: Memory[],
    options: {
      minConfidence?: number;
      maxRelationships?: number;
    }
  ): Promise<Relationship[]> {
    if (!this.llmProvider) {
      throw new AppError('LLM provider not available', ErrorCode.INTERNAL_ERROR);
    }

    const result: LLMRelationshipResult = await this.llmProvider.detectRelationships(
      { id: newMemory.id, content: newMemory.content, type: newMemory.type },
      existingMemories.map((m) => ({ id: m.id, content: m.content, type: m.type })),
      {
        minConfidence: options.minConfidence ?? 0.5,
        maxRelationships: options.maxRelationships,
      }
    );

    // Convert LLM results to Relationship objects
    const relationships: Relationship[] = result.relationships.map((rel) => ({
      id: generateId(),
      sourceMemoryId: rel.sourceMemoryId,
      targetMemoryId: rel.targetMemoryId,
      type: rel.type,
      confidence: rel.confidence,
      description: rel.reason,
      createdAt: new Date(),
      metadata: {
        detectionMethod: 'llm',
        llmProvider: result.provider,
      },
    }));

    logger.info('Relationships detected with LLM', {
      count: relationships.length,
      supersededCount: result.supersededMemoryIds.length,
      provider: result.provider,
      processingTimeMs: result.processingTimeMs,
    });

    return relationships;
  }

  /**
   * Detect relationships using pattern-based heuristics (synchronous, for backwards compatibility)
   *
   * @param newMemory - The new memory to check
   * @param existingMemories - Array of existing memories to compare against
   * @returns Relationship[] - Array of detected relationships
   */
  detectRelationships(newMemory: Memory, existingMemories: Memory[]): Relationship[] {
    const relationships: Relationship[] = [];

    // Limit comparisons for performance
    const memoriesToCompare = existingMemories.slice(0, this.config.maxRelationshipComparisons);

    for (const existing of memoriesToCompare) {
      if (existing.id === newMemory.id) continue;

      // Check for updates (new memory supersedes old)
      const updateResult = this.checkForUpdates(newMemory, existing);
      if (updateResult.isUpdate && updateResult.confidence >= 0.7) {
        relationships.push({
          id: generateId(),
          sourceMemoryId: newMemory.id,
          targetMemoryId: existing.id,
          type: 'updates',
          confidence: updateResult.confidence,
          description: updateResult.reason,
          createdAt: new Date(),
          metadata: { detectionMethod: 'pattern' },
        });
        continue;
      }

      // Check for extensions (new memory adds to old)
      const extensionResult = this.checkForExtensions(newMemory, existing);
      if (extensionResult.isExtension && extensionResult.confidence >= 0.6) {
        relationships.push({
          id: generateId(),
          sourceMemoryId: newMemory.id,
          targetMemoryId: existing.id,
          type: 'extends',
          confidence: extensionResult.confidence,
          description: extensionResult.reason,
          createdAt: new Date(),
          metadata: { detectionMethod: 'pattern' },
        });
        continue;
      }

      // Check for general semantic relationship
      const similarity = this.calculateTextSimilarity(newMemory.content, existing.content);
      if (similarity >= 0.5) {
        relationships.push({
          id: generateId(),
          sourceMemoryId: newMemory.id,
          targetMemoryId: existing.id,
          type: 'related',
          confidence: similarity,
          description: 'Semantically related content',
          createdAt: new Date(),
          metadata: { detectionMethod: 'pattern' },
        });
      }
    }

    return relationships;
  }

  /**
   * Classify the type of memory from content
   *
   * @param content - The content to classify
   * @returns MemoryType - 'fact' | 'preference' | 'episode' (mapped to full type set)
   */
  classifyMemoryType(content: string): MemoryType {
    // Use LLM-based classification service with pattern matching fallback
    // This replaces the TODO-001 implementation
    const classifier = getMemoryClassifier();

    // Note: This is synchronous for backward compatibility
    // The classifier will use cached results when available
    // For new classifications, it falls back to pattern matching
    // To use LLM async, call: await classifier.classify(content)

    const heuristic = classifyMemoryTypeHeuristically(content);
    return heuristic.type;
  }

  /**
   * Classify memory type asynchronously using LLM (preferred method)
   *
   * @param content - The content to classify
   * @returns Promise with MemoryType
   */
  async classifyMemoryTypeAsync(content: string): Promise<MemoryType> {
    const classifier = getMemoryClassifier();
    const result = await classifier.classify(content);
    return result.type;
  }

  /**
   * Check if a new memory updates/supersedes an existing memory (contradiction check)
   *
   * @param newMemory - The new memory
   * @param existing - The existing memory to compare
   * @returns UpdateCheckResult
   */
  checkForUpdates(newMemory: Memory, existing: Memory): UpdateCheckResult {
    // Use heuristic fallback for synchronous calls
    // For LLM-based detection, use checkForUpdatesAsync instead
    const newLower = newMemory.content.toLowerCase();
    const existingLower = existing.content.toLowerCase();

    const newWords = new Set(newLower.split(/\s+/).filter((w) => w.length > 3));
    const existingWords = new Set(existingLower.split(/\s+/).filter((w) => w.length > 3));

    const intersection = new Set([...newWords].filter((x) => existingWords.has(x)));
    const overlapRatio = intersection.size / Math.min(newWords.size, existingWords.size) || 0;

    let hasUpdateIndicator = false;
    for (const pattern of RELATIONSHIP_INDICATORS.updates) {
      if (pattern.test(newLower)) {
        hasUpdateIndicator = true;
        break;
      }
    }

    let hasContradiction = false;
    for (const pattern of RELATIONSHIP_INDICATORS.contradicts) {
      if (pattern.test(newLower) && overlapRatio > 0.3) {
        hasContradiction = true;
        break;
      }
    }

    let hasSuperseding = false;
    for (const pattern of RELATIONSHIP_INDICATORS.supersedes) {
      if (pattern.test(newLower) && overlapRatio > 0.4) {
        hasSuperseding = true;
        break;
      }
    }

    const isUpdate =
      (hasUpdateIndicator || hasContradiction || hasSuperseding) && overlapRatio > 0.3;
    const confidence = isUpdate ? Math.min(0.9, overlapRatio + 0.3) : 0;

    let reason = 'No update relationship detected';
    if (isUpdate) {
      if (hasContradiction) {
        reason = 'New memory contradicts existing information';
      } else if (hasSuperseding) {
        reason = 'New memory supersedes existing information';
      } else {
        reason = 'New memory updates existing information';
      }
    }

    return {
      isUpdate,
      existingMemory: isUpdate ? existing : undefined,
      confidence,
      reason,
    };
  }

  /**
   * Check for updates/contradictions asynchronously using LLM (preferred method)
   * Replaces TODO-002 with semantic analysis
   *
   * @param newMemory - The new memory
   * @param existing - The existing memory to compare
   * @returns Promise with UpdateCheckResult
   */
  async checkForUpdatesAsync(newMemory: Memory, existing: Memory): Promise<UpdateCheckResult> {
    const detector = getContradictionDetector();
    const result = await detector.checkContradiction(newMemory, existing);

    return {
      isUpdate: result.isContradiction,
      existingMemory: result.isContradiction ? existing : undefined,
      confidence: result.confidence,
      reason: result.reason,
    };
  }

  /**
   * Check if a new memory extends/enriches an existing memory
   *
   * @param newMemory - The new memory
   * @param existing - The existing memory to compare
   * @returns ExtensionCheckResult
   */
  checkForExtensions(newMemory: Memory, existing: Memory): ExtensionCheckResult {
    // TODO: Replace with actual LLM call for extension detection
    // Example LLM prompt:
    // ```
    // Compare these two statements and determine if the NEW statement
    // extends or adds detail to the OLD statement (without contradicting):
    //
    // OLD: ${existing.content}
    // NEW: ${newMemory.content}
    //
    // Return JSON: { isExtension: boolean, confidence: 0-1, reason: string }
    // ```

    const newLower = newMemory.content.toLowerCase();
    const existingLower = existing.content.toLowerCase();

    // Check for common subject matter
    const newWords = newLower.split(/\s+/).filter((w) => w.length > 3);
    const existingWords = new Set(existingLower.split(/\s+/).filter((w) => w.length > 3));

    const commonWords = newWords.filter((w) => existingWords.has(w));
    const overlapRatio = commonWords.length / Math.min(newWords.length, existingWords.size) || 0;

    // New memory should be longer or contain additional information
    const hasMoreDetail = newMemory.content.length > existing.content.length * 0.8;

    // Extension indicators
    let hasExtensionIndicator = false;
    for (const pattern of RELATIONSHIP_INDICATORS.extends) {
      if (pattern.test(newLower)) {
        hasExtensionIndicator = true;
        break;
      }
    }

    // Check if new content is contained within old (not an extension)
    const newContentInOld = existingLower.includes(newLower.slice(0, 20));

    const isExtension =
      overlapRatio > 0.2 &&
      overlapRatio < 0.9 &&
      !newContentInOld &&
      (hasMoreDetail || hasExtensionIndicator);

    const confidence = isExtension ? Math.min(0.85, overlapRatio + 0.2) : 0;

    return {
      isExtension,
      existingMemory: isExtension ? existing : undefined,
      confidence,
      reason: isExtension
        ? 'New memory adds additional detail to existing information'
        : 'No extension relationship detected',
    };
  }

  /**
   * Check for extensions asynchronously using LLM (preferred method)
   * Replaces TODO-003 with semantic analysis
   *
   * @param newMemory - The new memory
   * @param existing - The existing memory to compare
   * @returns Promise with ExtensionCheckResult
   */
  async checkForExtensionsAsync(newMemory: Memory, existing: Memory): Promise<ExtensionCheckResult> {
    const detector = getMemoryExtensionDetector();
    const result = await detector.checkExtension(newMemory, existing);

    return {
      isExtension: result.isExtension,
      existingMemory: result.isExtension ? existing : undefined,
      confidence: result.confidence,
      reason: result.reason,
    };
  }

  // ============================================================================
  // Extended API Methods
  // ============================================================================

  /**
   * Process content and store memories with automatic relationship detection
   *
   * @throws ValidationError if content or containerTag is invalid
   */
  async processAndStoreMemories(
    content: string,
    options: {
      containerTag?: string;
      sourceId?: string;
      detectRelationships?: boolean;
    } = {}
  ): Promise<{
    memories: Memory[];
    relationships: Relationship[];
    supersededMemoryIds: string[];
  }> {
    const createdMemoryIds: string[] = [];
    const relationshipIdsToRollback: string[] = [];
    const supersedeSnapshots: Array<{
      id: string;
      isLatest: boolean;
      supersededBy?: string;
    }> = [];

    const rollback = async (reason: unknown) => {
      logger.warn('Rolling back processAndStoreMemories due to failure', {
        error: reason instanceof Error ? reason.message : String(reason),
      });

      for (const snapshot of supersedeSnapshots) {
        try {
          const existing = await this.repository.findById(snapshot.id);
          if (existing) {
            await this.repository.update(snapshot.id, {
              isLatest: snapshot.isLatest,
              supersededBy: snapshot.supersededBy,
            });
          }
        } catch (error) {
          logger.warn('Failed to rollback superseded memory', {
            memoryId: snapshot.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      for (const relId of relationshipIdsToRollback) {
        try {
          await this.repository.deleteRelationship(relId);
        } catch (error) {
          logger.warn('Failed to rollback relationship', {
            relationshipId: relId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      for (const memoryId of createdMemoryIds) {
        try {
          await this.repository.delete(memoryId);
        } catch (error) {
          logger.warn('Failed to rollback memory', {
            memoryId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    try {
      const containerTag = options.containerTag ?? this.config.defaultContainerTag;
      if (containerTag) {
        validate(containerTagSchema, containerTag);
      }

      const shouldDetectRelationships =
        options.detectRelationships ?? this.config.autoDetectRelationships;

      logger.debug('Processing and storing memories', {
        containerTag,
        detectRelationships: shouldDetectRelationships,
      });

      // Extract memories from content
      const extractedMemories = await this.extractMemories(content);

      // Update container tags and source info
      for (const memory of extractedMemories) {
        memory.containerTag = containerTag;
        if (options.sourceId) {
          memory.sourceId = options.sourceId;
        }
      }

      const allRelationships: Relationship[] = [];
      const supersededMemoryIds: string[] = [];

      // Process each extracted memory
      for (const memory of extractedMemories) {
        // Store the memory in repository only (no local cache)
        await this.repository.create(memory);
        createdMemoryIds.push(memory.id);

        // Detect relationships if enabled
        if (shouldDetectRelationships) {
          const existingMemories = await this.repository.findPotentialRelations(memory, {
            containerTag,
            limit: this.config.maxRelationshipComparisons,
          });

          const relationships = this.detectRelationships(memory, existingMemories);

          // Process update relationships - mark old memories as superseded
          for (const rel of relationships) {
            if (rel.type === 'updates' || rel.type === 'supersedes') {
              const target = existingMemories.find((m) => m.id === rel.targetMemoryId);
              if (target) {
                supersedeSnapshots.push({
                  id: target.id,
                  isLatest: target.isLatest,
                  supersededBy: target.supersededBy,
                });
              }
              await this.repository.markSuperseded(rel.targetMemoryId, memory.id);
              supersededMemoryIds.push(rel.targetMemoryId);
            }
          }

          // Store relationships
          if (relationships.length > 0) {
            relationshipIdsToRollback.push(...relationships.map((rel) => rel.id));
            await this.repository.createRelationshipBatch(relationships);
            allRelationships.push(...relationships);
          }
        }
      }

      logger.info('Memories processed and stored', {
        memoriesCount: extractedMemories.length,
        relationshipsCount: allRelationships.length,
        supersededCount: supersededMemoryIds.length,
      });

      return {
        memories: extractedMemories,
        relationships: allRelationships,
        supersededMemoryIds,
      };
    } catch (error) {
      await rollback(error);
      if (error instanceof AppError) {
        throw error;
      }
      logger.errorWithException('Failed to process and store memories', error);
      throw AppError.from(error, ErrorCode.INTERNAL_ERROR);
    }
  }

  /**
   * Update isLatest status when new memory supersedes existing ones
   */
  updateIsLatest(newMemory: Memory, existingMemories: Memory[]): void {
    for (const existing of existingMemories) {
      if (
        newMemory.containerTag &&
        existing.containerTag &&
        newMemory.containerTag !== existing.containerTag
      ) {
        continue;
      }
      const updateResult = this.checkForUpdates(newMemory, existing);
      if (updateResult.isUpdate && updateResult.confidence >= 0.7) {
        existing.isLatest = false;
        existing.supersededBy = newMemory.id;
        newMemory.relationships.push({
          type: 'supersedes',
          targetId: existing.id,
          confidence: updateResult.confidence,
        });
      }
    }
  }

  /**
   * Extract memories from text (convenience wrapper matching original API)
   *
   * @throws ValidationError if text or containerTag is invalid
   */
  extractMemoriesFromText(text: string, containerTag?: string): Memory[] {
    validateMemoryContent(text);
    if (containerTag) {
      validate(containerTagSchema, containerTag);
    }

    const sentences = this.splitIntoSentences(text);
    const memories: Memory[] = [];

    for (const sentence of sentences) {
      if (sentence.trim().length < 10) continue;

      const type = this.classifyMemoryType(sentence);
      const entities = this.extractEntities(sentence);
      const keywords = this.extractKeywords(sentence);
      const confidence = this.calculateConfidence(sentence, type);

      const memory: Memory = {
        id: generateId(),
        content: sentence.trim(),
        type,
        relationships: [],
        isLatest: true,
        containerTag: containerTag ?? this.config.defaultContainerTag,
        confidence,
        metadata: {
          confidence,
          extractedFrom: text.substring(0, 100),
          keywords,
          entities,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      memories.push(memory);
    }

    // Detect relationships between extracted memories
    this.detectRelationshipsInternal(memories);

    return memories;
  }

  // ============================================================================
  // Storage Methods (delegating to repository)
  // ============================================================================

  async storeMemory(memory: Memory): Promise<Memory> {
    return this.repository.create(memory);
  }

  async getMemory(id: string): Promise<Memory | null> {
    return this.repository.findById(id);
  }

  async getAllMemories(): Promise<Memory[]> {
    return this.repository.getAllMemories();
  }

  async getLatestMemories(): Promise<Memory[]> {
    const all = await this.repository.getAllMemories();
    return all.filter((m) => m.isLatest);
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private splitIntoSentences(text: string): string[] {
    return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  }

  private extractEntities(text: string): Entity[] {
    const entities: Entity[] = [];
    const seen = new Set<string>();

    for (const [type, patterns] of Object.entries(ENTITY_PATTERNS)) {
      for (const pattern of patterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
          const name = match[1] || match[0];
          const normalizedName = name.trim().toLowerCase();

          if (!seen.has(normalizedName) && name.length > 1) {
            seen.add(normalizedName);
            entities.push({
              name: name.trim(),
              type: type as Entity['type'],
              mentions: 1,
            });
          }
        }
      }
    }

    return entities;
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'as',
      'is',
      'was',
      'are',
      'were',
      'been',
      'be',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'need',
      'it',
      'this',
      'that',
      'these',
      'those',
      'i',
      'you',
      'he',
      'she',
      'we',
      'they',
      'my',
      'your',
      'his',
      'her',
      'our',
      'their',
      'its',
    ]);

    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const keywords = words.filter((word) => !stopWords.has(word));

    return [...new Set(keywords)].slice(0, 10);
  }

  private calculateConfidence(content: string, type: MemoryType): number {
    let confidence = 0.5;

    // Longer content with more detail = higher confidence
    if (content.length > 100) confidence += 0.1;
    if (content.length > 200) confidence += 0.1;

    // Pattern matches increase confidence
    const matchCount = countMemoryTypeMatches(content, type);
    confidence += Math.min(matchCount * 0.1, 0.2);

    return Math.min(confidence, 1);
  }

  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  private detectRelationshipsInternal(memories: Memory[]): MemoryRelationship[] {
    const relationships: MemoryRelationship[] = [];

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const sourceMemory = memories[i]!;
        const targetMemory = memories[j]!;

        const relationshipType = this.detectRelationshipType(
          sourceMemory.content,
          targetMemory.content
        );

        if (relationshipType) {
          const relationship: MemoryRelationship = {
            type: relationshipType,
            targetId: targetMemory.id,
            confidence: this.calculateRelationshipConfidence(
              sourceMemory,
              targetMemory,
              relationshipType
            ),
          };

          sourceMemory.relationships.push(relationship);
          relationships.push(relationship);
        }
      }
    }

    return relationships;
  }

  private detectRelationshipType(source: string, target: string): RelationshipType | null {
    const similarity = this.calculateTextSimilarity(source, target);
    if (similarity < 0.1) {
      return null;
    }

    // Check explicit relationship indicators
    for (const [type, patterns] of Object.entries(RELATIONSHIP_INDICATORS)) {
      for (const pattern of patterns) {
        if (pattern.test(source) || pattern.test(target)) {
          return type as RelationshipType;
        }
      }
    }

    // If similar but no explicit indicator, mark as related
    if (similarity > 0.3) {
      return 'related';
    }

    return null;
  }

  private calculateRelationshipConfidence(
    source: Memory,
    target: Memory,
    type: RelationshipType
  ): number {
    let confidence = 0.5;

    // Same container increases confidence
    if (source.containerTag && source.containerTag === target.containerTag) {
      confidence += 0.1;
    }

    // Text similarity affects confidence
    const similarity = this.calculateTextSimilarity(source.content, target.content);
    confidence += similarity * 0.3;

    // Explicit indicators increase confidence
    const patterns = RELATIONSHIP_INDICATORS[type];
    if (patterns) {
      for (const pattern of patterns) {
        if (pattern.test(source.content) || pattern.test(target.content)) {
          confidence += 0.1;
          break;
        }
      }
    }

    return Math.min(confidence, 1);
  }
}

// ============================================================================
// Factory Functions (Proxy-based Lazy Singleton)
// ============================================================================

let _serviceInstance: MemoryService | null = null;

/**
 * Get the singleton MemoryService instance (created lazily)
 *
 * Note: Config is only applied on first call. Subsequent calls
 * return the existing instance regardless of config parameter.
 * Use createMemoryService() if you need a fresh instance with specific config.
 */
export function getMemoryService(config?: Partial<MemoryServiceConfig>): MemoryService {
  if (!_serviceInstance) {
    _serviceInstance = new MemoryService(config);
  }
  return _serviceInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetMemoryService(): void {
  _serviceInstance = null;
}

/**
 * Create a new MemoryService instance (for testing or custom configs)
 */
export function createMemoryService(
  config?: Partial<MemoryServiceConfig>,
  repository?: MemoryRepository
): MemoryService {
  return new MemoryService(config, repository);
}

/**
 * Proxy-based lazy singleton for backwards compatibility
 */
export const memoryService = new Proxy({} as MemoryService, {
  get(_, prop) {
    return getMemoryService()[prop as keyof MemoryService];
  },
});
