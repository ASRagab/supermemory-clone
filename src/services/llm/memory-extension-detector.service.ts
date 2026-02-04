/**
 * Memory Extension Detector Service
 *
 * LLM-based detection of whether a new memory extends/enriches an existing memory.
 * Replaces length-based heuristics for TODO-003 in memory.service.ts
 *
 * Cost optimization:
 * - Similarity-based caching
 * - Prompt optimization
 * - Batch processing support
 * - Fallback to heuristic matching
 *
 * Target: <$0.60/month with typical usage
 */

import { getLogger } from '../../utils/logger.js';
import { createHash } from 'crypto';
import type { Memory } from '../../types/index.js';
import { getLLMProvider, isLLMAvailable } from './index.js';
import { LLMError } from './base.js';

const logger = getLogger('ExtensionDetector');

// ============================================================================
// Prompt Templates
// ============================================================================

export const EXTENSION_DETECTOR_SYSTEM_PROMPT = `You are an expert at determining if one statement extends or adds detail to another.

Compare two statements and determine:
1. Does the NEW statement add detail, elaboration, or context to the OLD statement?
2. Do they NOT contradict each other?
3. What is your confidence (0.0-1.0)?

Extension criteria:
- NEW provides additional details about the same topic as OLD
- NEW elaborates on aspects mentioned in OLD
- NEW adds context without contradicting OLD
- NEW is NOT just a subset of OLD (already contained)

NOT an extension if:
- NEW contradicts OLD
- NEW is about a different topic
- NEW is already fully contained in OLD
- NEW replaces OLD entirely

Respond with ONLY a JSON object:
{
  "isExtension": boolean,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}`;

export function buildExtensionUserPrompt(newContent: string, existingContent: string): string {
  return `Compare these statements:\n\nOLD: "${existingContent}"\nNEW: "${newContent}"\n\nDoes NEW extend OLD? Respond with JSON only.`;
}

// ============================================================================
// Types
// ============================================================================

export interface ExtensionResult {
  isExtension: boolean;
  confidence: number;
  reason: string;
  cached: boolean;
  usedLLM: boolean;
}

export interface ExtensionDetectorConfig {
  /** Minimum confidence for extension (0-1) */
  minConfidence?: number;
  /** Whether to enable caching */
  enableCache?: boolean;
  /** Cache TTL in milliseconds */
  cacheTTLMs?: number;
  /** Maximum cache size */
  maxCacheSize?: number;
  /** Whether to fallback to heuristics on errors */
  fallbackToHeuristics?: boolean;
  /** Minimum word overlap ratio to even check (0-1) */
  minOverlapForCheck?: number;
}

interface CacheEntry {
  isExtension: boolean;
  confidence: number;
  reason: string;
  timestamp: number;
}

// ============================================================================
// Heuristic Patterns
// ============================================================================

const EXTENSION_INDICATORS = [
  /\b(also|additionally|furthermore|moreover|in addition|plus|and|as well)\b/i,
  /\b(more specifically|more detail|to elaborate|to expand|to clarify)\b/i,
  /\b(including|such as|for example|e\.g\.|specifically)\b/i,
];

// ============================================================================
// Memory Extension Detector Service
// ============================================================================

export class MemoryExtensionDetectorService {
  private config: Required<ExtensionDetectorConfig>;
  private cache: Map<string, CacheEntry> = new Map();
  private stats = {
    totalChecks: 0,
    llmChecks: 0,
    heuristicChecks: 0,
    cacheHits: 0,
    extensionsFound: 0,
    errors: 0,
    totalCost: 0,
  };

  constructor(config: ExtensionDetectorConfig = {}) {
    this.config = {
      minConfidence: config.minConfidence ?? 0.65,
      enableCache: config.enableCache ?? true,
      cacheTTLMs: config.cacheTTLMs ?? 30 * 60 * 1000, // 30 minutes
      maxCacheSize: config.maxCacheSize ?? 500,
      fallbackToHeuristics: config.fallbackToHeuristics ?? true,
      minOverlapForCheck: config.minOverlapForCheck ?? 0.15,
    };

    logger.info('Extension detector initialized', {
      cacheEnabled: this.config.enableCache,
      fallbackEnabled: this.config.fallbackToHeuristics,
    });
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Check if a new memory extends/enriches an existing memory
   *
   * @param newMemory - The new memory being added
   * @param existingMemory - The existing memory to compare against
   * @returns Extension detection result
   */
  async checkExtension(newMemory: Memory, existingMemory: Memory): Promise<ExtensionResult> {
    this.stats.totalChecks++;

    // Quick filter: check word overlap first
    const overlap = this.calculateWordOverlap(newMemory.content, existingMemory.content);
    if (overlap < this.config.minOverlapForCheck) {
      logger.debug('Skipping extension check due to low overlap', { overlap });
      return {
        isExtension: false,
        confidence: 0,
        reason: 'Insufficient content overlap',
        cached: false,
        usedLLM: false,
      };
    }

    // Quick filter: if new content is contained in old, it's not an extension
    if (this.isSubstring(newMemory.content, existingMemory.content)) {
      logger.debug('New content is substring of old, not an extension');
      return {
        isExtension: false,
        confidence: 0.8,
        reason: 'New content is already contained in existing memory',
        cached: false,
        usedLLM: false,
      };
    }

    // Check cache
    if (this.config.enableCache) {
      const cached = this.getCached(newMemory.content, existingMemory.content);
      if (cached) {
        this.stats.cacheHits++;
        logger.debug('Cache hit for extension check');
        return {
          ...cached,
          cached: true,
          usedLLM: false,
        };
      }
    }

    // Try LLM detection if available
    if (isLLMAvailable()) {
      try {
        const result = await this.detectWithLLM(newMemory, existingMemory);
        this.stats.llmChecks++;

        if (result.isExtension) {
          this.stats.extensionsFound++;
        }

        // Cache the result
        if (this.config.enableCache && result.confidence >= this.config.minConfidence) {
          this.setCached(newMemory.content, existingMemory.content, {
            isExtension: result.isExtension,
            confidence: result.confidence,
            reason: result.reason,
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
        logger.warn('LLM extension detection failed, falling back to heuristics', {
          error: error instanceof Error ? error.message : String(error),
        });

        if (!this.config.fallbackToHeuristics) {
          throw error;
        }
      }
    }

    // Fallback to heuristics
    const heuristicResult = this.detectWithHeuristics(newMemory, existingMemory);
    this.stats.heuristicChecks++;

    if (heuristicResult.isExtension) {
      this.stats.extensionsFound++;
    }

    return {
      ...heuristicResult,
      cached: false,
      usedLLM: false,
    };
  }

  /**
   * Get detection statistics
   */
  getStats() {
    const cacheHitRate =
      this.stats.totalChecks > 0 ? (this.stats.cacheHits / this.stats.totalChecks) * 100 : 0;

    const extensionRate =
      this.stats.totalChecks > 0 ? (this.stats.extensionsFound / this.stats.totalChecks) * 100 : 0;

    return {
      ...this.stats,
      cacheHitRate: parseFloat(cacheHitRate.toFixed(2)),
      extensionRate: parseFloat(extensionRate.toFixed(2)),
      cacheSize: this.cache.size,
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Extension cache cleared');
  }

  // ============================================================================
  // LLM Detection
  // ============================================================================

  private async detectWithLLM(
    newMemory: Memory,
    existingMemory: Memory
  ): Promise<{
    isExtension: boolean;
    confidence: number;
    reason: string;
  }> {
    const provider = getLLMProvider();

    try {
      const response = await provider.generateJson(
        EXTENSION_DETECTOR_SYSTEM_PROMPT,
        buildExtensionUserPrompt(newMemory.content, existingMemory.content)
      );

      const parsed = this.parseJsonResponse(response.rawResponse, response.provider);

      // Estimate cost
      const inputCost = ((response.tokensUsed?.prompt ?? 0) / 1000000) * 0.25;
      const outputCost = ((response.tokensUsed?.completion ?? 0) / 1000000) * 1.25;
      this.stats.totalCost += inputCost + outputCost;

      logger.debug('LLM extension detection successful', {
        isExtension: parsed.isExtension,
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
        `LLM extension detection failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private parseJsonResponse(
    rawResponse: string,
    provider: 'openai' | 'anthropic' | 'mock'
  ): {
    isExtension: boolean;
    confidence: number;
    reason: string;
  } {
    const trimmed = rawResponse.trim();
    const jsonMatch = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) {
      throw LLMError.invalidResponse(provider, 'No JSON object found in response');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch);
    } catch {
      throw LLMError.invalidResponse(provider, 'Invalid JSON response');
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('isExtension' in parsed) ||
      !('confidence' in parsed) ||
      !('reason' in parsed)
    ) {
      throw LLMError.invalidResponse(provider, 'Missing required fields in JSON response');
    }

    const isExtension = (parsed as { isExtension: boolean }).isExtension;
    const confidence = (parsed as { confidence: number }).confidence;
    const reason = (parsed as { reason: string }).reason;

    if (typeof isExtension !== 'boolean') {
      throw LLMError.invalidResponse(provider, 'Invalid isExtension in response');
    }
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
      throw LLMError.invalidResponse(provider, 'Invalid confidence in response');
    }
    if (typeof reason !== 'string') {
      throw LLMError.invalidResponse(provider, 'Invalid reason in response');
    }

    return { isExtension, confidence, reason };
  }

  // ============================================================================
  // Heuristic Detection
  // ============================================================================

  private detectWithHeuristics(
    newMemory: Memory,
    existingMemory: Memory
  ): {
    isExtension: boolean;
    confidence: number;
    reason: string;
  } {
    const newLower = newMemory.content.toLowerCase();
    const existingLower = existingMemory.content.toLowerCase();

    // Calculate metrics
    const overlap = this.calculateWordOverlap(newLower, existingLower);
    const hasMoreDetail = newMemory.content.length > existingMemory.content.length * 0.8;
    const newContentInOld = existingLower.includes(newLower.slice(0, 20));

    // Check for extension indicators
    let hasExtensionIndicator = false;
    for (const pattern of EXTENSION_INDICATORS) {
      if (pattern.test(newLower)) {
        hasExtensionIndicator = true;
        break;
      }
    }

    // Decision logic
    const isExtension =
      overlap > 0.2 && // Sufficient overlap
      overlap < 0.9 && // Not duplicate
      !newContentInOld && // Not contained
      (hasMoreDetail || hasExtensionIndicator); // Has additional content

    const confidence = isExtension ? Math.min(0.65, overlap + 0.2) : 0.3;

    let reason = 'No extension detected via heuristics';
    if (isExtension) {
      if (hasExtensionIndicator) {
        reason = 'Contains extension indicators and adds detail (via pattern matching)';
      } else {
        reason = 'Adds detail without contradicting (via pattern matching)';
      }
    } else if (newContentInOld) {
      reason = 'New content already contained in existing memory';
    } else if (overlap < 0.2) {
      reason = 'Insufficient overlap between memories';
    }

    logger.debug('Heuristic extension detection', {
      isExtension,
      confidence,
      overlap,
      hasMoreDetail,
    });

    return {
      isExtension,
      confidence,
      reason,
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private calculateWordOverlap(text1: string, text2: string): number {
    const words1 = new Set(
      text1
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );
    const words2 = new Set(
      text2
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private isSubstring(shorter: string, longer: string): boolean {
    const shortNorm = shorter.trim().toLowerCase();
    const longNorm = longer.trim().toLowerCase();

    // Check if significant portion of shorter is in longer
    const significantPortion = shortNorm.slice(0, Math.min(50, shortNorm.length));
    return longNorm.includes(significantPortion);
  }

  // ============================================================================
  // Caching
  // ============================================================================

  private getCacheKey(content1: string, content2: string): string {
    // Create deterministic key regardless of order
    const normalized = [content1, content2]
      .map((c) => c.substring(0, 200).trim().toLowerCase())
      .sort()
      .join('|||');
    return createHash('sha256').update(normalized).digest('hex');
  }

  private getCached(content1: string, content2: string): CacheEntry | null {
    const key = this.getCacheKey(content1, content2);
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

  private setCached(content1: string, content2: string, entry: CacheEntry): void {
    // Enforce cache size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, Math.floor(this.config.maxCacheSize * 0.1));
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }

    const key = this.getCacheKey(content1, content2);
    this.cache.set(key, entry);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _instance: MemoryExtensionDetectorService | null = null;

/**
 * Get the singleton instance
 */
export function getMemoryExtensionDetector(
  config?: ExtensionDetectorConfig
): MemoryExtensionDetectorService {
  if (!_instance) {
    _instance = new MemoryExtensionDetectorService(config);
  }
  return _instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetMemoryExtensionDetector(): void {
  _instance = null;
}
