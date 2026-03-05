/**
 * LLM Provider Types
 *
 * Defines interfaces and types for LLM-based memory extraction.
 * Supports multiple providers (OpenAI, Anthropic) with a unified interface.
 */

import type { MemoryType, Entity } from '../../types/index.js'

// ============================================================================
// Extracted Memory Types
// ============================================================================

/**
 * A memory extracted by an LLM from text content
 */
export interface ExtractedMemory {
  /** The extracted memory content as a clear, standalone statement */
  content: string

  /** Classification of the memory type */
  type: MemoryType

  /** Confidence score for this extraction (0-1) */
  confidence: number

  /** Extracted entities mentioned in the memory */
  entities: Entity[]

  /** Keywords extracted from the memory */
  keywords: string[]

  /** Optional reasoning from the LLM about why this was extracted */
  reasoning?: string
}

/**
 * Result of LLM memory extraction
 */
export interface LLMExtractionResult {
  /** Successfully extracted memories */
  memories: ExtractedMemory[]

  /** Raw LLM response for debugging */
  rawResponse?: string

  /** Tokens used for this extraction */
  tokensUsed?: {
    prompt: number
    completion: number
    total: number
  }

  /** Processing time in milliseconds */
  processingTimeMs: number

  /** Whether the extraction used cache */
  cached: boolean

  /** Provider used for this extraction */
  provider: LLMProviderType
}

// ============================================================================
// Relationship Detection Types
// ============================================================================

/**
 * Relationship type detected by LLM
 */
export type LLMRelationshipType = 'updates' | 'extends' | 'derives' | 'contradicts' | 'related' | 'supersedes'

/**
 * A relationship between memories detected by an LLM
 */
export interface DetectedRelationship {
  /** Source memory ID */
  sourceMemoryId: string

  /** Target memory ID */
  targetMemoryId: string

  /** Type of relationship */
  type: LLMRelationshipType

  /** Confidence score for this relationship (0-1) */
  confidence: number

  /** Explanation of why this relationship was detected */
  reason: string
}

/**
 * Result of LLM relationship detection
 */
export interface LLMRelationshipResult {
  /** Detected relationships */
  relationships: DetectedRelationship[]

  /** Memories that should be marked as superseded */
  supersededMemoryIds: string[]

  /** Processing time in milliseconds */
  processingTimeMs: number

  /** Provider used for this detection */
  provider: LLMProviderType
}

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Supported LLM providers
 */
export type LLMProviderType = 'openai' | 'anthropic' | 'mock'

/**
 * Base configuration for all LLM providers
 */
export interface BaseLLMConfig {
  /** Maximum tokens for responses */
  maxTokens?: number

  /** Temperature for generation (0-2) */
  temperature?: number

  /** Timeout in milliseconds */
  timeoutMs?: number

  /** Maximum retries on failure */
  maxRetries?: number

  /** Initial delay between retries in milliseconds */
  retryDelayMs?: number
}

/**
 * OpenAI-specific configuration
 */
export interface OpenAILLMConfig extends BaseLLMConfig {
  /** API key for OpenAI */
  apiKey: string

  /** Model to use (default: gpt-4o-mini) */
  model?: string

  /** Base URL for API (for proxies/custom endpoints) */
  baseUrl?: string

  /** Organization ID */
  organization?: string
}

/**
 * Anthropic-specific configuration
 */
export interface AnthropicLLMConfig extends BaseLLMConfig {
  /** API key for Anthropic */
  apiKey: string

  /** Model to use (default: claude-3-haiku-20240307) */
  model?: string

  /** Base URL for API */
  baseUrl?: string
}

/**
 * Mock provider configuration (for testing)
 */
export interface MockLLMConfig extends BaseLLMConfig {
  /** Predefined responses for testing */
  mockResponses?: ExtractedMemory[][]
  /** Predefined JSON responses for task-specific prompts */
  mockJsonResponses?: Array<string | Record<string, unknown>>

  /** Simulate latency in milliseconds */
  simulatedLatencyMs?: number

  /** Simulate errors */
  simulateErrors?: boolean

  /** Error rate (0-1) when simulateErrors is true */
  errorRate?: number
}

/**
 * Combined configuration type
 */
export type LLMConfig = OpenAILLMConfig | AnthropicLLMConfig | MockLLMConfig

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Interface that all LLM providers must implement
 */
export interface LLMProvider {
  /** Provider type identifier */
  readonly type: LLMProviderType

  /**
   * Extract memories from text content
   *
   * @param text - Text content to extract memories from
   * @param options - Optional extraction options
   * @returns Promise resolving to extraction result
   */
  extractMemories(text: string, options?: ExtractionOptions): Promise<LLMExtractionResult>

  /**
   * Detect relationships between memories
   *
   * @param newMemory - The new memory being added
   * @param existingMemories - Existing memories to compare against
   * @param options - Optional detection options
   * @returns Promise resolving to relationship detection result
   */
  detectRelationships(
    newMemory: { id: string; content: string; type: MemoryType },
    existingMemories: Array<{ id: string; content: string; type: MemoryType }>,
    options?: RelationshipDetectionOptions
  ): Promise<LLMRelationshipResult>

  /**
   * Check if the provider is available and configured
   */
  isAvailable(): boolean

  /**
   * Get provider health status
   */
  getHealthStatus(): Promise<ProviderHealthStatus>

  /**
   * Run a JSON-only prompt task with custom system/user prompts.
   */
  generateJson(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
    rawResponse: string
    tokensUsed?: { prompt: number; completion: number; total: number }
    provider: LLMProviderType
  }>
}

/**
 * Options for memory extraction
 */
export interface ExtractionOptions {
  /** Container tag for context */
  containerTag?: string

  /** Minimum confidence threshold (0-1) */
  minConfidence?: number

  /** Maximum memories to extract */
  maxMemories?: number

  /** Whether to include entity extraction */
  extractEntities?: boolean

  /** Whether to include keyword extraction */
  extractKeywords?: boolean

  /** Additional context for extraction */
  context?: string
}

/**
 * Options for relationship detection
 */
export interface RelationshipDetectionOptions {
  /** Maximum relationships to return */
  maxRelationships?: number

  /** Minimum confidence threshold */
  minConfidence?: number

  /** Container tag filter */
  containerTag?: string
}

/**
 * Provider health status
 */
export interface ProviderHealthStatus {
  /** Whether the provider is healthy */
  healthy: boolean

  /** Provider type */
  provider: LLMProviderType

  /** Latency of last request in ms */
  latencyMs?: number

  /** Error message if unhealthy */
  error?: string

  /** Last successful request timestamp */
  lastSuccess?: Date

  /** Rate limit info if available */
  rateLimit?: {
    remaining: number
    reset: Date
  }
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Cache entry for LLM responses
 */
export interface CacheEntry<T> {
  /** Cached value */
  value: T

  /** When this entry was created */
  createdAt: Date

  /** When this entry expires */
  expiresAt: Date

  /** Hash of the input that generated this entry */
  inputHash: string
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Whether caching is enabled */
  enabled: boolean

  /** Time-to-live in milliseconds */
  ttlMs: number

  /** Maximum cache size */
  maxSize: number
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * LLM-specific error codes
 */
export const LLMErrorCode = {
  /** Provider is not available */
  PROVIDER_UNAVAILABLE: 'LLM_PROVIDER_UNAVAILABLE',
  /** Rate limit exceeded */
  RATE_LIMITED: 'LLM_RATE_LIMITED',
  /** Invalid API key */
  INVALID_API_KEY: 'LLM_INVALID_API_KEY',
  /** Timeout */
  TIMEOUT: 'LLM_TIMEOUT',
  /** Invalid response format */
  INVALID_RESPONSE: 'LLM_INVALID_RESPONSE',
  /** Content filtered */
  CONTENT_FILTERED: 'LLM_CONTENT_FILTERED',
  /** Token limit exceeded */
  TOKEN_LIMIT_EXCEEDED: 'LLM_TOKEN_LIMIT_EXCEEDED',
} as const

export type LLMErrorCodeType = (typeof LLMErrorCode)[keyof typeof LLMErrorCode]
