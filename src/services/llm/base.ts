/**
 * Base LLM Provider Class
 *
 * Provides common functionality for all LLM providers including:
 * - Retry logic with exponential backoff
 * - Caching
 * - Error handling
 * - Rate limit handling
 */

import { createHash } from 'crypto';
import { getLogger } from '../../utils/logger.js';
import { AppError, ErrorCode } from '../../utils/errors.js';
import type {
  LLMProvider,
  LLMProviderType,
  LLMExtractionResult,
  LLMRelationshipResult,
  ExtractedMemory,
  DetectedRelationship,
  ExtractionOptions,
  RelationshipDetectionOptions,
  ProviderHealthStatus,
  BaseLLMConfig,
  CacheEntry,
  CacheConfig,
  LLMErrorCodeType,
} from './types.js';
import { LLMErrorCode } from './types.js';
import type { MemoryType } from '../../types/index.js';

const logger = getLogger('LLMProvider');

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_LLM_CONFIG: Required<BaseLLMConfig> = {
  maxTokens: 2000,
  temperature: 0.1,
  timeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 1000,
};

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  ttlMs: 15 * 60 * 1000, // 15 minutes
  maxSize: 1000,
};

// ============================================================================
// LLM Error Class
// ============================================================================

export class LLMError extends AppError {
  readonly llmCode: LLMErrorCodeType;
  readonly provider: LLMProviderType;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    llmCode: LLMErrorCodeType,
    provider: LLMProviderType,
    retryable: boolean = false,
    retryAfterMs?: number
  ) {
    super(message, ErrorCode.EXTERNAL_SERVICE_ERROR, {
      llmCode,
      provider,
      retryable,
      retryAfterMs,
    });
    this.name = 'LLMError';
    this.llmCode = llmCode;
    this.provider = provider;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }

  static rateLimited(provider: LLMProviderType, retryAfterMs?: number): LLMError {
    return new LLMError(
      `Rate limited by ${provider}`,
      LLMErrorCode.RATE_LIMITED,
      provider,
      true,
      retryAfterMs
    );
  }

  static timeout(provider: LLMProviderType): LLMError {
    return new LLMError(`Request to ${provider} timed out`, LLMErrorCode.TIMEOUT, provider, true);
  }

  static invalidApiKey(provider: LLMProviderType): LLMError {
    return new LLMError(
      `Invalid API key for ${provider}`,
      LLMErrorCode.INVALID_API_KEY,
      provider,
      false
    );
  }

  static invalidResponse(provider: LLMProviderType, details?: string): LLMError {
    return new LLMError(
      `Invalid response from ${provider}${details ? `: ${details}` : ''}`,
      LLMErrorCode.INVALID_RESPONSE,
      provider,
      true
    );
  }

  static providerUnavailable(provider: LLMProviderType): LLMError {
    return new LLMError(
      `${provider} provider is unavailable`,
      LLMErrorCode.PROVIDER_UNAVAILABLE,
      provider,
      true
    );
  }
}

// ============================================================================
// Base LLM Provider
// ============================================================================

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly type: LLMProviderType;

  protected config: Required<BaseLLMConfig>;
  protected cacheConfig: CacheConfig;
  protected cache: Map<string, CacheEntry<LLMExtractionResult>> = new Map();
  protected lastSuccess?: Date;

  constructor(config: Partial<BaseLLMConfig> = {}, cacheConfig: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_LLM_CONFIG, ...config };
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...cacheConfig };
  }

  // ============================================================================
  // Abstract Methods - Must be implemented by subclasses
  // ============================================================================

  /**
   * Perform the actual LLM API call for memory extraction
   */
  protected abstract doExtractMemories(
    text: string,
    options: ExtractionOptions
  ): Promise<{
    memories: ExtractedMemory[];
    rawResponse?: string;
    tokensUsed?: { prompt: number; completion: number; total: number };
  }>;

  /**
   * Perform the actual LLM API call for relationship detection
   */
  protected abstract doDetectRelationships(
    newMemory: { id: string; content: string; type: MemoryType },
    existingMemories: Array<{ id: string; content: string; type: MemoryType }>,
    options: RelationshipDetectionOptions
  ): Promise<{
    relationships: DetectedRelationship[];
    supersededMemoryIds: string[];
  }>;

  /**
   * Perform a generic JSON-only prompt task.
   */
  protected abstract doGenerateJson(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
    rawResponse: string;
    tokensUsed?: { prompt: number; completion: number; total: number };
  }>;

  /**
   * Check if the provider is configured and available
   */
  abstract isAvailable(): boolean;

  // ============================================================================
  // Public Interface
  // ============================================================================

  async extractMemories(
    text: string,
    options: ExtractionOptions = {}
  ): Promise<LLMExtractionResult> {
    const startTime = Date.now();

    // Check cache first
    if (this.cacheConfig.enabled) {
      const cached = this.getCachedResult(text, options);
      if (cached) {
        logger.debug('Cache hit for memory extraction', {
          provider: this.type,
          textLength: text.length,
        });
        return {
          ...cached,
          cached: true,
          processingTimeMs: Date.now() - startTime,
        };
      }
    }

    // Perform extraction with retries
    try {
      const result = await this.withRetry(
        () => this.doExtractMemories(text, options),
        'extractMemories'
      );

      const llmResult: LLMExtractionResult = {
        memories: result.memories,
        rawResponse: result.rawResponse,
        tokensUsed: result.tokensUsed,
        processingTimeMs: Date.now() - startTime,
        cached: false,
        provider: this.type,
      };

      // Cache the result
      if (this.cacheConfig.enabled) {
        this.cacheResult(text, options, llmResult);
      }

      this.lastSuccess = new Date();
      logger.info('Memories extracted successfully', {
        provider: this.type,
        count: result.memories.length,
        processingTimeMs: llmResult.processingTimeMs,
      });

      return llmResult;
    } catch (error) {
      logger.errorWithException('Failed to extract memories', error, {
        provider: this.type,
        textLength: text.length,
      });
      throw error;
    }
  }

  async generateJson(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
    rawResponse: string;
    tokensUsed?: { prompt: number; completion: number; total: number };
    provider: LLMProviderType;
  }> {
    try {
      const result = await this.withRetry(
        () => this.doGenerateJson(systemPrompt, userPrompt),
        'generateJson'
      );

      return {
        rawResponse: result.rawResponse,
        tokensUsed: result.tokensUsed,
        provider: this.type,
      };
    } catch (error) {
      if (error instanceof LLMError) {
        throw error;
      }
      throw LLMError.invalidResponse(this.type, error instanceof Error ? error.message : String(error));
    }
  }

  async detectRelationships(
    newMemory: { id: string; content: string; type: MemoryType },
    existingMemories: Array<{ id: string; content: string; type: MemoryType }>,
    options: RelationshipDetectionOptions = {}
  ): Promise<LLMRelationshipResult> {
    const startTime = Date.now();

    try {
      const result = await this.withRetry(
        () => this.doDetectRelationships(newMemory, existingMemories, options),
        'detectRelationships'
      );

      const llmResult: LLMRelationshipResult = {
        relationships: result.relationships,
        supersededMemoryIds: result.supersededMemoryIds,
        processingTimeMs: Date.now() - startTime,
        provider: this.type,
      };

      this.lastSuccess = new Date();
      logger.info('Relationships detected successfully', {
        provider: this.type,
        count: result.relationships.length,
        processingTimeMs: llmResult.processingTimeMs,
      });

      return llmResult;
    } catch (error) {
      logger.errorWithException('Failed to detect relationships', error, {
        provider: this.type,
        newMemoryId: newMemory.id,
        existingCount: existingMemories.length,
      });
      throw error;
    }
  }

  async getHealthStatus(): Promise<ProviderHealthStatus> {
    if (!this.isAvailable()) {
      return {
        healthy: false,
        provider: this.type,
        error: 'Provider not configured',
      };
    }

    try {
      // Simple health check - extract from minimal text
      const startTime = Date.now();
      await this.extractMemories('Health check: The system is operational.', {
        maxMemories: 1,
        minConfidence: 0,
      });

      return {
        healthy: true,
        provider: this.type,
        latencyMs: Date.now() - startTime,
        lastSuccess: this.lastSuccess,
      };
    } catch (error) {
      return {
        healthy: false,
        provider: this.type,
        error: error instanceof Error ? error.message : String(error),
        lastSuccess: this.lastSuccess,
      };
    }
  }

  // ============================================================================
  // Retry Logic
  // ============================================================================

  protected async withRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.withTimeout(operation(), this.config.timeoutMs);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const isRetryable =
          error instanceof LLMError ? error.retryable : this.isRetryableError(error);

        if (!isRetryable || attempt === this.config.maxRetries) {
          throw error;
        }

        // Calculate delay with exponential backoff
        const delay =
          error instanceof LLMError && error.retryAfterMs
            ? error.retryAfterMs
            : this.config.retryDelayMs * Math.pow(2, attempt - 1);

        logger.warn(`Retrying ${operationName} after error`, {
          provider: this.type,
          attempt,
          maxRetries: this.config.maxRetries,
          delayMs: delay,
          error: lastError.message,
        });

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  protected async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(LLMError.timeout(this.type)), timeoutMs)
      ),
    ]);
  }

  protected isRetryableError(error: unknown): boolean {
    if (error instanceof LLMError) {
      return error.retryable;
    }

    // Check for common retryable error patterns
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return (
      message.includes('timeout') ||
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('503') ||
      message.includes('network')
    );
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================================
  // Caching
  // ============================================================================

  protected getCacheKey(text: string, options: ExtractionOptions): string {
    const keyData = JSON.stringify({
      text: text.substring(0, 5000), // Limit for hashing
      provider: this.type,
      options,
    });
    return createHash('sha256').update(keyData).digest('hex');
  }

  protected getCachedResult(text: string, options: ExtractionOptions): LLMExtractionResult | null {
    const key = this.getCacheKey(text, options);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt < new Date()) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  protected cacheResult(
    text: string,
    options: ExtractionOptions,
    result: LLMExtractionResult
  ): void {
    // Enforce cache size limit
    if (this.cache.size >= this.cacheConfig.maxSize) {
      // Remove oldest entries
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime());
      const toRemove = entries.slice(0, Math.floor(this.cacheConfig.maxSize * 0.1));
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }

    const key = this.getCacheKey(text, options);
    const now = new Date();

    this.cache.set(key, {
      value: result,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.cacheConfig.ttlMs),
      inputHash: key,
    });
  }

  /**
   * Clear all cached results
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Cache cleared', { provider: this.type });
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.cacheConfig.maxSize,
      ttlMs: this.cacheConfig.ttlMs,
    };
  }
}
