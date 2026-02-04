/**
 * Anthropic LLM Provider
 *
 * Implements LLM-based memory extraction using Anthropic's Claude models.
 * Uses the Anthropic SDK with structured output prompting.
 */

import { getLogger } from '../../utils/logger.js';
import { BaseLLMProvider, LLMError } from './base.js';
import type {
  AnthropicLLMConfig,
  LLMProviderType,
  ExtractedMemory,
  DetectedRelationship,
  ExtractionOptions,
  RelationshipDetectionOptions,
} from './types.js';
import { LLMErrorCode } from './types.js';
import type { MemoryType } from '../../types/index.js';
import {
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
  MEMORY_EXTRACTION_EXAMPLES,
  RELATIONSHIP_DETECTION_SYSTEM_PROMPT,
  RELATIONSHIP_DETECTION_EXAMPLES,
  generateExtractionPrompt,
  generateRelationshipPrompt,
  parseExtractionResponse,
  parseRelationshipResponse,
} from './prompts.js';

const logger = getLogger('AnthropicProvider');

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_ANTHROPIC_CONFIG: Partial<AnthropicLLMConfig> = {
  model: 'claude-3-haiku-20240307',
  maxTokens: 2000,
  temperature: 0.1,
  timeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 1000,
};

// ============================================================================
// Anthropic API Types (minimal, since we're not using the full SDK)
// ============================================================================

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

// ============================================================================
// Anthropic Provider Implementation
// ============================================================================

export class AnthropicLLMProvider extends BaseLLMProvider {
  readonly type: LLMProviderType = 'anthropic';

  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: AnthropicLLMConfig) {
    super({
      ...DEFAULT_ANTHROPIC_CONFIG,
      ...config,
    });

    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_ANTHROPIC_CONFIG.model!;
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com';

    logger.debug('Anthropic provider initialized', {
      model: this.model,
      hasApiKey: !!this.apiKey,
    });
  }

  // ============================================================================
  // Availability Check
  // ============================================================================

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  // ============================================================================
  // API Communication
  // ============================================================================

  private async callAnthropicAPI(
    systemPrompt: string,
    userMessage: string
  ): Promise<{ content: string; usage: { input: number; output: number } }> {
    if (!this.apiKey) {
      throw LLMError.providerUnavailable('anthropic');
    }

    const messages: AnthropicMessage[] = [{ role: 'user', content: userMessage }];

    const requestBody = {
      model: this.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system: systemPrompt,
      messages,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as
          | AnthropicError
          | Record<string, unknown>;
        throw this.handleAnthropicHttpError(response.status, errorBody);
      }

      // Parse and validate JSON response (with error handling for concurrent request corruption)
      let data: AnthropicResponse;
      try {
        data = (await response.json()) as AnthropicResponse;
      } catch (parseError) {
        throw LLMError.invalidResponse(
          'anthropic',
          `JSON parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        );
      }

      // Validate response structure (handles concurrent request JSON corruption)
      if (!data || typeof data !== 'object') {
        throw LLMError.invalidResponse('anthropic', 'Malformed JSON response');
      }

      if (!data.content || !Array.isArray(data.content)) {
        throw LLMError.invalidResponse('anthropic', 'Invalid response structure: missing content array');
      }

      if (!data.content?.[0]?.text) {
        throw LLMError.invalidResponse('anthropic', 'Empty response from model');
      }

      return {
        content: data.content[0].text,
        usage: {
          input: data.usage.input_tokens,
          output: data.usage.output_tokens,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof LLMError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw LLMError.timeout('anthropic');
      }

      throw this.handleAnthropicError(error);
    }
  }

  // ============================================================================
  // Memory Extraction
  // ============================================================================

  protected async doExtractMemories(
    text: string,
    options: ExtractionOptions
  ): Promise<{
    memories: ExtractedMemory[];
    rawResponse?: string;
    tokensUsed?: { prompt: number; completion: number; total: number };
  }> {
    const systemPrompt = `${MEMORY_EXTRACTION_SYSTEM_PROMPT}\n\n${MEMORY_EXTRACTION_EXAMPLES}`;
    const userPrompt = generateExtractionPrompt(text, options);

    const response = await this.callAnthropicAPI(systemPrompt, userPrompt);
    const parsed = parseExtractionResponse(response.content);

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
    }));

    if (options.minConfidence) {
      memories = memories.filter((m) => m.confidence >= options.minConfidence!);
    }

    if (options.maxMemories) {
      memories = memories.slice(0, options.maxMemories);
    }

    return {
      memories,
      rawResponse: response.content,
      tokensUsed: {
        prompt: response.usage.input,
        completion: response.usage.output,
        total: response.usage.input + response.usage.output,
      },
    };
  }

  // ============================================================================
  // Relationship Detection
  // ============================================================================

  protected async doDetectRelationships(
    newMemory: { id: string; content: string; type: MemoryType },
    existingMemories: Array<{ id: string; content: string; type: MemoryType }>,
    options: RelationshipDetectionOptions
  ): Promise<{
    relationships: DetectedRelationship[];
    supersededMemoryIds: string[];
  }> {
    // If no existing memories, return empty
    if (existingMemories.length === 0) {
      return { relationships: [], supersededMemoryIds: [] };
    }

    const systemPrompt = `${RELATIONSHIP_DETECTION_SYSTEM_PROMPT}\n\n${RELATIONSHIP_DETECTION_EXAMPLES}`;
    const userPrompt = generateRelationshipPrompt(newMemory, existingMemories, options);

    const response = await this.callAnthropicAPI(systemPrompt, userPrompt);
    const parsed = parseRelationshipResponse(response.content);

    // Filter and validate relationships
    let relationships: DetectedRelationship[] = parsed.relationships.map((r) => ({
      sourceMemoryId: r.sourceMemoryId,
      targetMemoryId: r.targetMemoryId,
      type: r.type as DetectedRelationship['type'],
      confidence: r.confidence,
      reason: r.reason,
    }));

    if (options.minConfidence) {
      relationships = relationships.filter((r) => r.confidence >= options.minConfidence!);
    }

    if (options.maxRelationships) {
      relationships = relationships.slice(0, options.maxRelationships);
    }

    return {
      relationships,
      supersededMemoryIds: parsed.supersededMemoryIds,
    };
  }

  // ============================================================================
  // Generic JSON Task
  // ============================================================================

  protected async doGenerateJson(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
    rawResponse: string;
    tokensUsed?: { prompt: number; completion: number; total: number };
  }> {
    const response = await this.callAnthropicAPI(systemPrompt, userPrompt);

    return {
      rawResponse: response.content,
      tokensUsed: {
        prompt: response.usage.input,
        completion: response.usage.output,
        total: response.usage.input + response.usage.output,
      },
    };
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  private handleAnthropicHttpError(
    status: number,
    body: AnthropicError | Record<string, unknown>
  ): LLMError {
    const message =
      'error' in body && typeof body.error === 'object' && body.error
        ? ((body.error as { message?: string }).message ?? 'Unknown error')
        : 'Unknown error';

    // Rate limiting
    if (status === 429) {
      return LLMError.rateLimited('anthropic', 60000);
    }

    // Authentication errors
    if (status === 401) {
      return LLMError.invalidApiKey('anthropic');
    }

    // Content filtering (400 with specific message)
    if (status === 400 && message.toLowerCase().includes('content')) {
      return new LLMError(
        'Content was filtered by Anthropic',
        LLMErrorCode.CONTENT_FILTERED,
        'anthropic',
        false
      );
    }

    // Token limit exceeded
    if (status === 400 && message.toLowerCase().includes('token')) {
      return new LLMError(
        'Token limit exceeded',
        LLMErrorCode.TOKEN_LIMIT_EXCEEDED,
        'anthropic',
        false
      );
    }

    // Overloaded (503)
    if (status === 529 || status === 503) {
      return LLMError.providerUnavailable('anthropic');
    }

    // Server errors (retryable)
    if (status >= 500) {
      return LLMError.providerUnavailable('anthropic');
    }

    // Default
    return LLMError.invalidResponse('anthropic', message);
  }

  private handleAnthropicError(error: unknown): LLMError {
    if (error instanceof LLMError) {
      return error;
    }

    if (error instanceof Error) {
      // Network errors
      if (
        error.message.includes('fetch') ||
        error.message.includes('network') ||
        error.message.includes('ECONNREFUSED')
      ) {
        return LLMError.providerUnavailable('anthropic');
      }

      return new LLMError(error.message, LLMErrorCode.PROVIDER_UNAVAILABLE, 'anthropic', true);
    }

    return new LLMError(String(error), LLMErrorCode.PROVIDER_UNAVAILABLE, 'anthropic', true);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an Anthropic LLM provider
 */
export function createAnthropicProvider(config: AnthropicLLMConfig): AnthropicLLMProvider {
  return new AnthropicLLMProvider(config);
}
