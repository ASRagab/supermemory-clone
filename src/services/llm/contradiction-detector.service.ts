/**
 * Contradiction Detector Service
 *
 * LLM-based semantic contradiction detection between memory pairs.
 * Replaces heuristic matching for TODO-002 in memory.service.ts
 *
 * Cost optimization:
 * - HNSW similarity search to reduce comparison pairs
 * - Prompt caching for repeated patterns
 * - Batch contradiction detection
 * - Fallback to heuristic matching
 *
 * Target: <$0.60/month with typical usage
 */

import { getLogger } from '../../utils/logger.js'
import { createHash } from 'crypto'
import type { Memory } from '../../types/index.js'
import { getLLMProvider, isLLMAvailable } from './index.js'
import { LLMError } from './base.js'

const logger = getLogger('ContradictionDetector')

// ============================================================================
// Prompt Templates
// ============================================================================

export const CONTRADICTION_DETECTOR_SYSTEM_PROMPT = `You are an expert at detecting contradictions and updates between statements.

Compare two statements and determine:
1. Do they contradict each other?
2. Does the NEW statement update or supersede the OLD statement?
3. What is your confidence (0.0-1.0)?

Types of relationships:
- CONTRADICTION: Statements directly conflict (both may be valid from different times)
- UPDATE: NEW corrects or modifies OLD (making OLD outdated)
- SUPERSEDE: NEW completely replaces OLD (OLD should be archived)
- COMPATIBLE: No contradiction (related or compatible information)

Respond with ONLY a JSON object:
{
  "isContradiction": boolean,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "shouldSupersede": boolean
}`

export function buildContradictionUserPrompt(newContent: string, existingContent: string): string {
  return `Compare these statements:\n\nOLD: "${existingContent}"\nNEW: "${newContent}"\n\nRespond with JSON only.`
}

// ============================================================================
// Types
// ============================================================================

export interface ContradictionResult {
  isContradiction: boolean
  confidence: number
  reason: string
  shouldSupersede: boolean
  cached: boolean
  usedLLM: boolean
}

export interface DetectorConfig {
  /** Minimum confidence for contradiction (0-1) */
  minConfidence?: number
  /** Whether to enable caching */
  enableCache?: boolean
  /** Cache TTL in milliseconds */
  cacheTTLMs?: number
  /** Maximum cache size */
  maxCacheSize?: number
  /** Whether to fallback to heuristics on errors */
  fallbackToHeuristics?: boolean
  /** Minimum word overlap ratio to even check (0-1) */
  minOverlapForCheck?: number
}

interface CacheEntry {
  isContradiction: boolean
  confidence: number
  reason: string
  shouldSupersede: boolean
  timestamp: number
}

// ============================================================================
// Heuristic Patterns
// ============================================================================

const RELATIONSHIP_INDICATORS = {
  updates: [
    /\b(now|currently|as of|updated to|changed to|modified to)\b/i,
    /\b(no longer|not anymore|stopped|quit|left)\b/i,
  ],
  contradicts: [
    /\b(but|however|actually|instead|rather|on the contrary)\b/i,
    /\b(never|not|don't|doesn't|didn't|won't|can't)\b/i,
  ],
  supersedes: [/\b(replaced|superseded|obsolete|deprecated|archived)\b/i, /\b(new version|latest|updated|revised)\b/i],
}

// ============================================================================
// Contradiction Detector Service
// ============================================================================

export class ContradictionDetectorService {
  private config: Required<DetectorConfig>
  private cache: Map<string, CacheEntry> = new Map()
  private stats = {
    totalChecks: 0,
    llmChecks: 0,
    heuristicChecks: 0,
    cacheHits: 0,
    contradictionsFound: 0,
    errors: 0,
    totalCost: 0,
  }

  constructor(config: DetectorConfig = {}) {
    this.config = {
      minConfidence: config.minConfidence ?? 0.7,
      enableCache: config.enableCache ?? true,
      cacheTTLMs: config.cacheTTLMs ?? 30 * 60 * 1000, // 30 minutes
      maxCacheSize: config.maxCacheSize ?? 500,
      fallbackToHeuristics: config.fallbackToHeuristics ?? true,
      minOverlapForCheck: config.minOverlapForCheck ?? 0.2,
    }

    logger.info('Contradiction detector initialized', {
      cacheEnabled: this.config.enableCache,
      fallbackEnabled: this.config.fallbackToHeuristics,
    })
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Check if a new memory contradicts or updates an existing memory
   *
   * @param newMemory - The new memory being added
   * @param existingMemory - The existing memory to compare against
   * @returns Contradiction detection result
   */
  async checkContradiction(newMemory: Memory, existingMemory: Memory): Promise<ContradictionResult> {
    this.stats.totalChecks++

    // Check cache first
    if (this.config.enableCache) {
      const cached = this.getCached(newMemory.content, existingMemory.content)
      if (cached) {
        this.stats.cacheHits++
        logger.debug('Cache hit for contradiction check')
        return {
          ...cached,
          cached: true,
          usedLLM: false,
        }
      }
    }

    // NOTE: We don't skip LLM based on word overlap anymore.
    // The LLM should handle semantic analysis - "I live in New York" vs "I moved to San Francisco"
    // have 0% word overlap but ARE semantically related and need LLM analysis.
    // Only skip for truly empty content.

    // Try LLM detection if available (semantic analysis with minimal overlap filter)
    if (isLLMAvailable()) {
      try {
        const result = await this.detectWithLLM(newMemory, existingMemory)
        this.stats.llmChecks++

        if (result.isContradiction) {
          this.stats.contradictionsFound++
        }

        // Cache the result
        if (this.config.enableCache && result.confidence >= this.config.minConfidence) {
          this.setCached(newMemory.content, existingMemory.content, {
            isContradiction: result.isContradiction,
            confidence: result.confidence,
            reason: result.reason,
            shouldSupersede: result.shouldSupersede,
            timestamp: Date.now(),
          })
        }

        return {
          ...result,
          cached: false,
          usedLLM: true,
        }
      } catch (error) {
        this.stats.errors++
        logger.warn('LLM contradiction detection failed, falling back to heuristics', {
          error: error instanceof Error ? error.message : String(error),
        })

        if (!this.config.fallbackToHeuristics) {
          throw error
        }
      }
    }

    // Fallback to heuristics
    // Only apply overlap filter for heuristics (semantic analysis not available)
    const overlap = this.calculateWordOverlap(newMemory.content, existingMemory.content)
    if (overlap < this.config.minOverlapForCheck) {
      logger.debug('Skipping heuristic check due to low overlap', { overlap })
      return {
        isContradiction: false,
        confidence: 0,
        reason: 'Insufficient content overlap for heuristic analysis',
        shouldSupersede: false,
        cached: false,
        usedLLM: false,
      }
    }

    const heuristicResult = this.detectWithHeuristics(newMemory, existingMemory)
    this.stats.heuristicChecks++

    if (heuristicResult.isContradiction) {
      this.stats.contradictionsFound++
    }

    return {
      ...heuristicResult,
      cached: false,
      usedLLM: false,
    }
  }

  /**
   * Get detection statistics
   */
  getStats() {
    const cacheHitRate = this.stats.totalChecks > 0 ? (this.stats.cacheHits / this.stats.totalChecks) * 100 : 0

    const contradictionRate =
      this.stats.totalChecks > 0 ? (this.stats.contradictionsFound / this.stats.totalChecks) * 100 : 0

    return {
      ...this.stats,
      cacheHitRate: parseFloat(cacheHitRate.toFixed(2)),
      contradictionRate: parseFloat(contradictionRate.toFixed(2)),
      cacheSize: this.cache.size,
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear()
    logger.info('Contradiction cache cleared')
  }

  // ============================================================================
  // LLM Detection
  // ============================================================================

  private async detectWithLLM(
    newMemory: Memory,
    existingMemory: Memory
  ): Promise<{
    isContradiction: boolean
    confidence: number
    reason: string
    shouldSupersede: boolean
  }> {
    const provider = getLLMProvider()

    try {
      const response = await provider.generateJson(
        CONTRADICTION_DETECTOR_SYSTEM_PROMPT,
        buildContradictionUserPrompt(newMemory.content, existingMemory.content)
      )

      const parsed = this.parseJsonResponse(response.rawResponse, response.provider)

      // Estimate cost
      const inputCost = ((response.tokensUsed?.prompt ?? 0) / 1000000) * 0.25
      const outputCost = ((response.tokensUsed?.completion ?? 0) / 1000000) * 1.25
      this.stats.totalCost += inputCost + outputCost

      logger.debug('LLM contradiction detection successful', {
        isContradiction: parsed.isContradiction,
        confidence: parsed.confidence,
        tokensUsed: response.tokensUsed?.total ?? 0,
        cost: inputCost + outputCost,
      })

      return parsed
    } catch (error) {
      if (error instanceof LLMError) {
        throw error
      }
      throw new Error(`LLM contradiction detection failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private parseJsonResponse(
    rawResponse: string,
    provider: 'openai' | 'anthropic' | 'mock'
  ): {
    isContradiction: boolean
    confidence: number
    reason: string
    shouldSupersede: boolean
  } {
    const trimmed = rawResponse.trim()
    const jsonMatch = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0]
    if (!jsonMatch) {
      throw LLMError.invalidResponse(provider, 'No JSON object found in response')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonMatch)
    } catch {
      throw LLMError.invalidResponse(provider, 'Invalid JSON response')
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('isContradiction' in parsed) ||
      !('confidence' in parsed) ||
      !('reason' in parsed) ||
      !('shouldSupersede' in parsed)
    ) {
      throw LLMError.invalidResponse(provider, 'Missing required fields in JSON response')
    }

    const isContradiction = (parsed as { isContradiction: boolean }).isContradiction
    const confidence = (parsed as { confidence: number }).confidence
    const reason = (parsed as { reason: string }).reason
    const shouldSupersede = (parsed as { shouldSupersede: boolean }).shouldSupersede

    if (typeof isContradiction !== 'boolean' || typeof shouldSupersede !== 'boolean') {
      throw LLMError.invalidResponse(provider, 'Invalid boolean fields in response')
    }
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
      throw LLMError.invalidResponse(provider, 'Invalid confidence in response')
    }
    if (typeof reason !== 'string') {
      throw LLMError.invalidResponse(provider, 'Invalid reason in response')
    }

    return { isContradiction, confidence, reason, shouldSupersede }
  }

  // ============================================================================
  // Heuristic Detection
  // ============================================================================

  private detectWithHeuristics(
    newMemory: Memory,
    existingMemory: Memory
  ): {
    isContradiction: boolean
    confidence: number
    reason: string
    shouldSupersede: boolean
  } {
    const newLower = newMemory.content.toLowerCase()
    const existingLower = existingMemory.content.toLowerCase()

    // Calculate word overlap
    const overlap = this.calculateWordOverlap(newLower, existingLower)

    // Check for update indicators
    let hasUpdateIndicator = false
    for (const pattern of RELATIONSHIP_INDICATORS.updates) {
      if (pattern.test(newLower)) {
        hasUpdateIndicator = true
        break
      }
    }

    // Check for contradiction indicators
    let hasContradiction = false
    for (const pattern of RELATIONSHIP_INDICATORS.contradicts) {
      if (pattern.test(newLower) && overlap > 0.3) {
        hasContradiction = true
        break
      }
    }

    // Check for superseding indicators
    let hasSuperseding = false
    for (const pattern of RELATIONSHIP_INDICATORS.supersedes) {
      if (pattern.test(newLower) && overlap > 0.4) {
        hasSuperseding = true
        break
      }
    }

    const isContradiction = (hasUpdateIndicator || hasContradiction || hasSuperseding) && overlap > 0.3
    const confidence = isContradiction ? Math.min(0.6, overlap + 0.2) : 0.3
    const shouldSupersede = hasSuperseding || (hasUpdateIndicator && overlap > 0.5)

    let reason = 'No contradiction detected via heuristics'
    if (isContradiction) {
      if (hasSuperseding) {
        reason = 'New memory supersedes existing (via pattern matching)'
      } else if (hasUpdateIndicator) {
        reason = 'New memory updates existing (via pattern matching)'
      } else {
        reason = 'Contradiction detected (via pattern matching)'
      }
    }

    logger.debug('Heuristic contradiction detection', {
      isContradiction,
      confidence,
      overlap,
      shouldSupersede,
    })

    return {
      isContradiction,
      confidence,
      reason,
      shouldSupersede,
    }
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
    )
    const words2 = new Set(
      text2
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
    )

    const intersection = new Set([...words1].filter((x) => words2.has(x)))
    const union = new Set([...words1, ...words2])

    return union.size > 0 ? intersection.size / union.size : 0
  }

  // ============================================================================
  // Caching
  // ============================================================================

  private getCacheKey(content1: string, content2: string): string {
    // Normalize and create deterministic key regardless of order
    const normalized = [content1, content2]
      .map((c) => c.substring(0, 200).trim().toLowerCase())
      .sort()
      .join('|||')
    return createHash('sha256').update(normalized).digest('hex')
  }

  private getCached(content1: string, content2: string): CacheEntry | null {
    const key = this.getCacheKey(content1, content2)
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // Check if expired
    const age = Date.now() - entry.timestamp
    if (age > this.config.cacheTTLMs) {
      this.cache.delete(key)
      return null
    }

    return entry
  }

  private setCached(content1: string, content2: string, entry: CacheEntry): void {
    // Enforce cache size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      const entries = Array.from(this.cache.entries())
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
      const toRemove = entries.slice(0, Math.floor(this.config.maxCacheSize * 0.1))
      for (const [key] of toRemove) {
        this.cache.delete(key)
      }
    }

    const key = this.getCacheKey(content1, content2)
    this.cache.set(key, entry)
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _instance: ContradictionDetectorService | null = null

/**
 * Get the singleton instance
 */
export function getContradictionDetector(config?: DetectorConfig): ContradictionDetectorService {
  if (!_instance) {
    _instance = new ContradictionDetectorService(config)
  }
  return _instance
}

/**
 * Reset the singleton (for testing)
 */
export function resetContradictionDetector(): void {
  _instance = null
}
