/**
 * OpenAI LLM Provider
 *
 * Implements LLM-based memory extraction using OpenAI's GPT models.
 * Uses JSON mode for reliable structured output.
 */

import OpenAI from 'openai'
import { getLogger } from '../../utils/logger.js'
import { BaseLLMProvider, LLMError } from './base.js'
import type {
  OpenAILLMConfig,
  LLMProviderType,
  ExtractedMemory,
  DetectedRelationship,
  ExtractionOptions,
  RelationshipDetectionOptions,
} from './types.js'
import { LLMErrorCode } from './types.js'
import type { MemoryType } from '../../types/index.js'
import {
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_EXTRACTION_EXAMPLES,
  RELATIONSHIP_DETECTION_SYSTEM_PROMPT,
  RELATIONSHIP_DETECTION_EXAMPLES,
  generateExtractionPrompt,
  generateRelationshipPrompt,
  normalizeJsonResponse,
  parseExtractionResponse,
  parseRelationshipResponse,
} from './prompts.js'

const logger = getLogger('OpenAIProvider')

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_OPENAI_CONFIG: Partial<OpenAILLMConfig> = {
  model: 'gpt-4o-mini',
  maxTokens: 2000,
  temperature: 0.1,
  timeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 1000,
}

// ============================================================================
// OpenAI Provider Implementation
// ============================================================================

export class OpenAILLMProvider extends BaseLLMProvider {
  readonly type: LLMProviderType = 'openai'

  private client: OpenAI | null = null
  private readonly apiKey?: string
  private readonly model: string
  private readonly baseUrl?: string
  private readonly organization?: string

  constructor(config: OpenAILLMConfig) {
    super({
      ...DEFAULT_OPENAI_CONFIG,
      ...config,
    })

    this.apiKey = config.apiKey
    this.model = config.model ?? DEFAULT_OPENAI_CONFIG.model!
    this.baseUrl = config.baseUrl
    this.organization = config.organization

    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseUrl,
        organization: this.organization,
        timeout: this.config.timeoutMs,
        maxRetries: 0, // We handle retries ourselves
      })
    }

    logger.debug('OpenAI provider initialized', {
      model: this.model,
      hasApiKey: !!this.apiKey,
    })
  }

  // ============================================================================
  // Availability Check
  // ============================================================================

  isAvailable(): boolean {
    return !!this.client && !!this.apiKey
  }

  // ============================================================================
  // Memory Extraction
  // ============================================================================

  protected async doExtractMemories(
    text: string,
    options: ExtractionOptions
  ): Promise<{
    memories: ExtractedMemory[]
    rawResponse?: string
    tokensUsed?: { prompt: number; completion: number; total: number }
  }> {
    if (!this.client) {
      throw LLMError.providerUnavailable('openai')
    }

    const userPrompt = generateExtractionPrompt(text, options)

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `${MEMORY_EXTRACTION_SYSTEM_PROMPT}\n\n${MEMORY_EXTRACTION_EXAMPLES}`,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      })

      const rawResponse = response.choices[0]?.message?.content

      if (!rawResponse) {
        throw LLMError.invalidResponse('openai', 'Empty response from model')
      }

      const parsed = parseExtractionResponse(rawResponse)

      // Filter by confidence if specified
      let memories: ExtractedMemory[] = parsed.memories.map((m) => ({
        content: m.content,
        type: m.type,
        confidence: m.confidence,
        entities: m.entities.map((e) => ({
          name: e.name,
          type: e.type as 'person' | 'place' | 'organization' | 'date' | 'concept' | 'other',
          mentions: 1,
        })),
        keywords: m.keywords,
      }))

      if (options.minConfidence) {
        memories = memories.filter((m) => m.confidence >= options.minConfidence!)
      }

      if (options.maxMemories) {
        memories = memories.slice(0, options.maxMemories)
      }

      return {
        memories,
        rawResponse,
        tokensUsed: response.usage
          ? {
              prompt: response.usage.prompt_tokens,
              completion: response.usage.completion_tokens,
              total: response.usage.total_tokens,
            }
          : undefined,
      }
    } catch (error) {
      throw this.handleOpenAIError(error)
    }
  }

  // ============================================================================
  // Relationship Detection
  // ============================================================================

  protected async doDetectRelationships(
    newMemory: { id: string; content: string; type: MemoryType },
    existingMemories: Array<{ id: string; content: string; type: MemoryType }>,
    options: RelationshipDetectionOptions
  ): Promise<{
    relationships: DetectedRelationship[]
    supersededMemoryIds: string[]
  }> {
    if (!this.client) {
      throw LLMError.providerUnavailable('openai')
    }

    // If no existing memories, return empty
    if (existingMemories.length === 0) {
      return { relationships: [], supersededMemoryIds: [] }
    }

    const userPrompt = generateRelationshipPrompt(newMemory, existingMemories, options)

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `${RELATIONSHIP_DETECTION_SYSTEM_PROMPT}\n\n${RELATIONSHIP_DETECTION_EXAMPLES}`,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      })

      const rawResponse = response.choices[0]?.message?.content

      if (!rawResponse) {
        throw LLMError.invalidResponse('openai', 'Empty response from model')
      }

      const parsed = parseRelationshipResponse(rawResponse)

      // Filter and validate relationships
      let relationships: DetectedRelationship[] = parsed.relationships.map((r) => ({
        sourceMemoryId: r.sourceMemoryId,
        targetMemoryId: r.targetMemoryId,
        type: r.type as DetectedRelationship['type'],
        confidence: r.confidence,
        reason: r.reason,
      }))

      if (options.minConfidence) {
        relationships = relationships.filter((r) => r.confidence >= options.minConfidence!)
      }

      if (options.maxRelationships) {
        relationships = relationships.slice(0, options.maxRelationships)
      }

      return {
        relationships,
        supersededMemoryIds: parsed.supersededMemoryIds,
      }
    } catch (error) {
      throw this.handleOpenAIError(error)
    }
  }

  // ============================================================================
  // Generic JSON Task
  // ============================================================================

  protected async doGenerateJson(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
    rawResponse: string
    tokensUsed?: { prompt: number; completion: number; total: number }
  }> {
    if (!this.client) {
      throw LLMError.providerUnavailable('openai')
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      })

      const rawResponse = response.choices[0]?.message?.content
      if (!rawResponse) {
        throw LLMError.invalidResponse('openai', 'Empty response from model')
      }
      const normalized = normalizeJsonResponse(rawResponse)

      return {
        rawResponse: normalized,
        tokensUsed: response.usage
          ? {
              prompt: response.usage.prompt_tokens,
              completion: response.usage.completion_tokens,
              total: response.usage.total_tokens,
            }
          : undefined,
      }
    } catch (error) {
      throw this.handleOpenAIError(error)
    }
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  private handleOpenAIError(error: unknown): LLMError {
    if (error instanceof LLMError) {
      return error
    }

    // Check for OpenAI API errors by checking error structure
    if (this.isOpenAIApiError(error)) {
      const status = error.status
      const message = error.message

      // Rate limiting
      if (status === 429) {
        const retryAfter = this.parseRetryAfter(error)
        return LLMError.rateLimited('openai', retryAfter)
      }

      // Authentication errors
      if (status === 401) {
        return LLMError.invalidApiKey('openai')
      }

      // Content filtering
      if (status === 400 && message.includes('content_filter')) {
        return new LLMError('Content was filtered by OpenAI', LLMErrorCode.CONTENT_FILTERED, 'openai', false)
      }

      // Token limit
      if (status === 400 && message.includes('maximum context length')) {
        return new LLMError('Token limit exceeded', LLMErrorCode.TOKEN_LIMIT_EXCEEDED, 'openai', false)
      }

      // Server errors (retryable)
      if (status && status >= 500) {
        return LLMError.providerUnavailable('openai')
      }

      // Default to invalid response
      return LLMError.invalidResponse('openai', message)
    }

    // Network or timeout errors
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return LLMError.timeout('openai')
      }
      return new LLMError(error.message, LLMErrorCode.PROVIDER_UNAVAILABLE, 'openai', true)
    }

    return new LLMError(String(error), LLMErrorCode.PROVIDER_UNAVAILABLE, 'openai', true)
  }

  /**
   * Type guard for OpenAI API errors
   */
  private isOpenAIApiError(
    error: unknown
  ): error is { status: number; message: string; headers?: Record<string, string> } {
    return (
      error !== null &&
      typeof error === 'object' &&
      'status' in error &&
      typeof (error as Record<string, unknown>).status === 'number' &&
      'message' in error &&
      typeof (error as Record<string, unknown>).message === 'string'
    )
  }

  private parseRetryAfter(error: {
    status: number
    message: string
    headers?: Record<string, string>
  }): number | undefined {
    // Try to parse retry-after header or message
    if (error.headers?.['retry-after']) {
      const seconds = parseInt(error.headers['retry-after'], 10)
      if (!Number.isNaN(seconds)) {
        return seconds * 1000
      }
    }

    // Default retry delay for rate limits
    return 60000 // 1 minute
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an OpenAI LLM provider
 */
export function createOpenAIProvider(config: OpenAILLMConfig): OpenAILLMProvider {
  return new OpenAILLMProvider(config)
}
