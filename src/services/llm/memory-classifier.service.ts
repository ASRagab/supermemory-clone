/**
 * Memory Type Classifier Service
 *
 * LLM-based semantic memory type classification with caching and fallback.
 * Replaces pattern matching for TODO-001 in memory.service.ts
 *
 * Cost optimization:
 * - Prompt caching to reduce API calls
 * - In-memory cache with TTL
 * - Batch classification when possible
 * - Fallback to pattern matching on API errors
 *
 * Target: <$0.60/month with typical usage
 */

import { getLogger } from '../../utils/logger.js';
import { createHash } from 'crypto';
import type { MemoryType } from '../../types/index.js';
import { getLLMProvider, isLLMAvailable } from './index.js';
import { LLMError } from './base.js';

const logger = getLogger('MemoryClassifier');

// ============================================================================
// Prompt Templates
// ============================================================================

export const MEMORY_CLASSIFIER_SYSTEM_PROMPT = `You are a memory classification expert. Classify the given content into ONE of these types:

- fact: Objective information, statements of truth, definitions
- event: Time-bound occurrences, meetings, experiences
- preference: Personal likes, dislikes, preferences, opinions
- skill: Abilities, capabilities, expertise, knowledge areas
- relationship: Interpersonal connections, social bonds
- context: Current situations, states, or ongoing activities
- note: General notes, reminders, todos

Respond with ONLY a JSON object:
{
  "type": "one of the types above",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

export function buildMemoryClassifierUserPrompt(content: string): string {
  return `Classify this content:\n\n"${content}"\n\nRespond with JSON only.`;
}

// ============================================================================
// Types
// ============================================================================

export interface ClassificationResult {
  type: MemoryType;
  confidence: number;
  reasoning?: string;
  cached: boolean;
  usedLLM: boolean;
}

export interface ClassifierConfig {
  /** Minimum confidence for LLM classification (0-1) */
  minConfidence?: number;
  /** Whether to enable caching */
  enableCache?: boolean;
  /** Cache TTL in milliseconds */
  cacheTTLMs?: number;
  /** Maximum cache size */
  maxCacheSize?: number;
  /** Whether to fallback to pattern matching on errors */
  fallbackToPatterns?: boolean;
}

interface CacheEntry {
  type: MemoryType;
  confidence: number;
  reasoning?: string;
  timestamp: number;
}

// ============================================================================
// Pattern Matching Fallback
// ============================================================================

const MEMORY_TYPE_PATTERNS: Record<MemoryType, RegExp[]> = {
  fact: [
    /^(the |a |an )?.*\b(is|are|was|were|has|have|had|will|would|can|could|does|did)\b/i,
    /\b(definition|means|refers to|known as|called)\b/i,
    /^\w+\s+(is|are)\s+/i,
  ],
  event: [
    /\b(yesterday|today|tomorrow|last|next|on|at|during|when)\b.*\b(met|happened|occurred|took place|went|came|attended|joined)\b/i,
    /\b(meeting|appointment|conference|event|session|call)\b/i,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\b\d{1,2}:\d{2}\b/i, // Time patterns
  ],
  preference: [
    /\b(prefer|like|love|enjoy|hate|dislike|favorite|favour)\b/i,
    /\b(better than|rather than|instead of)\b/i,
    /\b(always|never|usually|typically|tend to)\b.*\b(use|choose|pick|select)\b/i,
  ],
  skill: [
    /\b(expert|proficient|experienced|skilled|know|understand|can|able)\b.*\b(in|with|at)\b/i,
    /\b(years?|months?)\s+(of\s+)?(experience|working|using|building)\b/i,
    /\b(programming|development|design|analysis|testing)\b/i,
  ],
  relationship: [
    /\b(works? for|employed by|colleague|teammate|manager|friend|mentor|family)\b/i,
    /\b(knows?|met|introduced|connected with)\b.*\b(person|people|team)\b/i,
    /\b(relationship|connection|association)\b/i,
  ],
  context: [
    /\b(currently|now|at the moment|working on|in progress)\b/i,
    /\b(status|situation|state|condition)\b/i,
  ],
  note: [
    /\b(note|reminder|todo|task|remember|don't forget)\b/i,
    /^(note:|reminder:|todo:)/i,
  ],
};

// ============================================================================
// Memory Type Classifier
// ============================================================================

export class MemoryClassifierService {
  private config: Required<ClassifierConfig>;
  private cache: Map<string, CacheEntry> = new Map();
  private stats = {
    totalClassifications: 0,
    llmClassifications: 0,
    patternClassifications: 0,
    cacheHits: 0,
    errors: 0,
    totalCost: 0,
  };

  constructor(config: ClassifierConfig = {}) {
    this.config = {
      minConfidence: config.minConfidence ?? 0.6,
      enableCache: config.enableCache ?? true,
      cacheTTLMs: config.cacheTTLMs ?? 15 * 60 * 1000, // 15 minutes
      maxCacheSize: config.maxCacheSize ?? 1000,
      fallbackToPatterns: config.fallbackToPatterns ?? true,
    };

    logger.info('Memory classifier initialized', {
      cacheEnabled: this.config.enableCache,
      fallbackEnabled: this.config.fallbackToPatterns,
    });
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Classify memory content into a type using LLM or pattern matching
   *
   * @param content - The content to classify
   * @returns Classification result with type, confidence, and metadata
   */
  async classify(content: string): Promise<ClassificationResult> {
    this.stats.totalClassifications++;

    // Check cache first
    if (this.config.enableCache) {
      const cached = this.getCached(content);
      if (cached) {
        this.stats.cacheHits++;
        logger.debug('Cache hit for classification', { contentPreview: content.substring(0, 50) });
        return {
          type: cached.type,
          confidence: cached.confidence,
          reasoning: cached.reasoning,
          cached: true,
          usedLLM: false,
        };
      }
    }

    // Try LLM classification if available
    if (isLLMAvailable()) {
      try {
        const result = await this.classifyWithLLM(content);
        this.stats.llmClassifications++;

        // Cache the result
        if (this.config.enableCache && result.confidence >= this.config.minConfidence) {
          this.setCached(content, {
            type: result.type,
            confidence: result.confidence,
            reasoning: result.reasoning,
            timestamp: Date.now(),
          });
        }

        return {
          ...result,
          cached: false,
          usedLLM: true,
        };
      } catch (error) {
        this.stats.errors++;
        logger.warn('LLM classification failed, falling back to patterns', {
          error: error instanceof Error ? error.message : String(error),
        });

        if (!this.config.fallbackToPatterns) {
          throw error;
        }
      }
    }

    // Fallback to pattern matching
    const patternResult = this.classifyWithPatterns(content);
    this.stats.patternClassifications++;

    return {
      type: patternResult.type,
      confidence: patternResult.confidence,
      cached: false,
      usedLLM: false,
    };
  }

  /**
   * Get classification statistics
   */
  getStats() {
    const cacheHitRate =
      this.stats.totalClassifications > 0
        ? (this.stats.cacheHits / this.stats.totalClassifications) * 100
        : 0;

    return {
      ...this.stats,
      cacheHitRate: parseFloat(cacheHitRate.toFixed(2)),
      cacheSize: this.cache.size,
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Classification cache cleared');
  }

  // ============================================================================
  // LLM Classification
  // ============================================================================

  private async classifyWithLLM(content: string): Promise<{
    type: MemoryType;
    confidence: number;
    reasoning?: string;
  }> {
    const provider = getLLMProvider();

    try {
      const response = await provider.generateJson(
        MEMORY_CLASSIFIER_SYSTEM_PROMPT,
        buildMemoryClassifierUserPrompt(content)
      );

      const parsed = this.parseJsonResponse(response.rawResponse, response.provider);

      // Estimate cost (Haiku: ~$0.25 per million input tokens, ~$1.25 per million output)
      const inputCost = ((response.tokensUsed?.prompt ?? 0) / 1000000) * 0.25;
      const outputCost = ((response.tokensUsed?.completion ?? 0) / 1000000) * 1.25;
      this.stats.totalCost += inputCost + outputCost;

      logger.debug('LLM classification successful', {
        type: parsed.type,
        confidence: parsed.confidence,
        tokensUsed: response.tokensUsed?.total ?? 0,
        cost: inputCost + outputCost,
      });

      return parsed;
    } catch (error) {
      if (error instanceof LLMError) {
        throw error;
      }
      throw new Error(
        `LLM classification failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ============================================================================
  // Pattern Matching Fallback
  // ============================================================================

  private classifyWithPatterns(content: string): {
    type: MemoryType;
    confidence: number;
  } {
    const scores: Record<MemoryType, number> = {
      fact: 0,
      event: 0,
      preference: 0,
      skill: 0,
      relationship: 0,
      context: 0,
      note: 0,
    };

    // Test each pattern
    for (const [type, patterns] of Object.entries(MEMORY_TYPE_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          scores[type as MemoryType] += 1;
        }
      }
    }

    // Find highest scoring type
    const maxScore = Math.max(...Object.values(scores));
    if (maxScore === 0) {
      return { type: 'note', confidence: 0.3 };
    }

    const matchedType = Object.entries(scores).find(([_, score]) => score === maxScore);
    const type = (matchedType?.[0] as MemoryType) || 'note';

    // Calculate confidence based on number of pattern matches
    const confidence = Math.min(0.5 + maxScore * 0.1, 0.9);

    logger.debug('Pattern classification', {
      type,
      confidence,
      matchCount: maxScore,
    });

    return { type, confidence };
  }

  private parseJsonResponse(
    rawResponse: string,
    provider: 'openai' | 'anthropic' | 'mock'
  ): {
    type: MemoryType;
    confidence: number;
    reasoning?: string;
  } {
    const trimmed = rawResponse.trim();
    const jsonMatch = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) {
      throw LLMError.invalidResponse(provider, 'No JSON object found in response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch);
    } catch (error) {
      throw LLMError.invalidResponse(provider, 'Invalid JSON response');
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('type' in parsed) ||
      !('confidence' in parsed)
    ) {
      throw LLMError.invalidResponse(provider, 'Missing required fields in JSON response');
    }

    const type = (parsed as { type: MemoryType }).type;
    const confidence = (parsed as { confidence: number }).confidence;
    const reasoning = (parsed as { reasoning?: string }).reasoning;

    const validTypes: MemoryType[] = [
      'fact',
      'event',
      'preference',
      'skill',
      'relationship',
      'context',
      'note',
    ];
    if (!validTypes.includes(type)) {
      throw LLMError.invalidResponse(provider, 'Invalid memory type in response');
    }
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
      throw LLMError.invalidResponse(provider, 'Invalid confidence in response');
    }

    return { type, confidence, reasoning };
  }

  // ============================================================================
  // Caching
  // ============================================================================

  private getCacheKey(content: string): string {
    // Use first 500 chars for cache key to avoid huge keys
    const normalized = content.substring(0, 500).trim().toLowerCase();
    return createHash('sha256').update(normalized).digest('hex');
  }

  private getCached(content: string): CacheEntry | null {
    const key = this.getCacheKey(content);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    const age = Date.now() - entry.timestamp;
    if (age > this.config.cacheTTLMs) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  private setCached(content: string, entry: CacheEntry): void {
    // Enforce cache size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      // Remove oldest 10% of entries
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const excess = this.cache.size - this.config.maxCacheSize + 1;
      const minimumToRemove = Math.max(1, Math.ceil(this.config.maxCacheSize * 0.1));
      const toRemove = entries.slice(0, Math.max(excess, minimumToRemove));
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }

    const key = this.getCacheKey(content);
    this.cache.set(key, entry);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _instance: MemoryClassifierService | null = null;

/**
 * Get the singleton instance
 */
export function getMemoryClassifier(config?: ClassifierConfig): MemoryClassifierService {
  if (!_instance) {
    _instance = new MemoryClassifierService(config);
  }
  return _instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetMemoryClassifier(): void {
  _instance = null;
}
