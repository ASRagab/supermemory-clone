/**
 * Profile Types for Supermemory Clone
 *
 * User profiles store extracted facts that complement search results.
 * Facts are classified as static (long-term) or dynamic (temporary).
 *
 * Note: Base types are defined in types/profile.base.ts to prevent duplication.
 * This file extends those base types with service-specific fields.
 */

import { FactType as BaseFactType, FactSemanticCategory, BaseProfileFact } from '../types/profile.base.js'

/**
 * Type of fact - determines lifecycle and expiration behavior
 * Re-exported from base types for convenience
 */
export type FactType = BaseFactType

/**
 * Classification result from the fact classifier
 */
export interface FactClassification {
  type: FactType
  confidence: number
  reason: string
  suggestedExpirationHours?: number
}

/**
 * A single fact extracted from user content
 * Extends BaseProfileFact with service-specific fields
 */
export interface ProfileFact extends Omit<BaseProfileFact, 'createdAt' | 'updatedAt'> {
  /** Whether this is a static (long-term) or dynamic (temporary) fact */
  type: FactType

  /** When this fact was extracted */
  extractedAt: Date

  /** When this fact expires (only for dynamic facts) */
  expiresAt?: Date

  /** Category of the fact for organization */
  category?: FactCategory

  /** Number of times this fact has been reinforced */
  reinforcementCount: number

  /** Last time this fact was accessed or reinforced */
  lastAccessedAt: Date
}

/**
 * Categories for organizing profile facts (semantic categories)
 *
 * Note: This is distinct from FactCategory in types/index.ts which
 * represents fact lifecycle (static/dynamic/inferred). This type
 * represents the semantic category of what the fact is about.
 *
 * Re-exported from base types for convenience
 */
export type FactCategory = FactSemanticCategory

/**
 * User profile containing all extracted facts
 */
export interface UserProfile {
  /** Unique identifier for the user/container */
  containerTag: string

  /** Static facts - long-term, rarely change */
  staticFacts: ProfileFact[]

  /** Dynamic facts - temporary, expire over time */
  dynamicFacts: ProfileFact[]

  /** When the profile was created */
  createdAt: Date

  /** When the profile was last updated */
  updatedAt: Date

  /** Profile version for optimistic locking */
  version: number
}

/**
 * Options for profile operations
 */
export interface ProfileOptions {
  /** Whether to auto-extract facts from content */
  autoExtract?: boolean

  /** Whether to refresh dynamic facts */
  refreshDynamic?: boolean

  /** Maximum number of dynamic facts to keep */
  maxDynamicFacts?: number

  /** Default expiration hours for dynamic facts */
  defaultDynamicExpirationHours?: number

  /**
   * Custom patterns for classifying facts as static (long-term).
   * If provided, these will be used instead of the default STATIC_FACT_PATTERNS.
   * Set to empty array to disable static pattern matching.
   */
  staticFactPatterns?: RegExp[]

  /**
   * Custom patterns for classifying facts as dynamic (temporary).
   * If provided, these will be used instead of the default DYNAMIC_FACT_PATTERNS.
   * Set to empty array to disable dynamic pattern matching.
   */
  dynamicFactPatterns?: RegExp[]
}

/**
 * Result of fact extraction
 */
export interface ExtractionResult {
  facts: ProfileFact[]
  rawContent: string
  extractedAt: Date
  processingTimeMs: number
}

/**
 * Criteria for promoting dynamic facts to static
 */
export interface PromotionCriteria {
  /** Minimum reinforcement count to consider promotion */
  minReinforcementCount: number

  /** Minimum age in days before considering promotion */
  minAgeDays: number

  /** Minimum confidence score */
  minConfidence: number
}

/**
 * Default configuration values
 */
export const PROFILE_DEFAULTS = {
  maxDynamicFacts: 50,
  defaultDynamicExpirationHours: 72, // 3 days
  promotionCriteria: {
    minReinforcementCount: 3,
    minAgeDays: 7,
    minConfidence: 0.8,
  } as PromotionCriteria,
} as const

// ============================================================================
// Fact Classification Patterns
// ============================================================================

/**
 * Default patterns for classifying facts as static (long-term, rarely change).
 * These patterns match content that typically represents enduring information
 * about a person such as their job, education, location, or skills.
 *
 * Can be overridden via ProfileOptions.staticFactPatterns or
 * the SUPERMEMORY_STATIC_PATTERNS environment variable (JSON array of pattern strings).
 *
 * @example "John is a senior software engineer" - matches job title pattern
 * @example "She has 10 years of experience" - matches experience pattern
 * @example "He graduated from MIT" - matches education pattern
 */
export const STATIC_FACT_PATTERNS: readonly RegExp[] = [
  /** Matches job titles with optional seniority and specialty prefixes */
  /\b(is|works as|employed as|serves as)\s+(a|an|the)?\s*(senior|junior|lead|principal|staff)?\s*(software|data|machine learning|devops|cloud|frontend|backend|full[\s-]?stack)?\s*(engineer|developer|architect|manager|designer|analyst)/i,
  /** Matches employment statements: works at, employed by, works for, joined */
  /\b(works at|employed by|works for|joined)\s+\w+/i,
  /** Matches education statements: graduated from, studied at, has a degree in */
  /\b(graduated from|studied at|has a degree in|majored in)/i,
  /** Matches location statements: lives in, based in, located in, resides in */
  /\b(lives in|based in|located in|resides in)/i,
  /** Matches preference statements: prefers, always uses, favorite, loves, hates */
  /\b(prefers|always uses|favorite|loves|hates)\s+\w+/i,
  /** Matches experience statements: has X years of experience */
  /\b(has|have)\s+\d+\s+years?\s+(of\s+)?experience/i,
  /** Matches expertise statements: specializes in, expert in, proficient in */
  /\b(specializes in|expert in|proficient in|skilled in)/i,
  /** Matches language ability: speaks, fluent in */
  /\b(speaks|fluent in)\s+\w+/i,
] as const

/**
 * Default patterns for classifying facts as dynamic (temporary, time-bound).
 * These patterns match content that typically represents current activities,
 * recent events, or plans that will become outdated.
 *
 * Can be overridden via ProfileOptions.dynamicFactPatterns or
 * the SUPERMEMORY_DYNAMIC_PATTERNS environment variable (JSON array of pattern strings).
 *
 * @example "I'm currently working on the auth module" - matches temporal + activity
 * @example "Just finished debugging the API" - matches recency indicator
 * @example "Planning to refactor next week" - matches future intent
 */
export const DYNAMIC_FACT_PATTERNS: readonly RegExp[] = [
  /** Matches present-moment indicators: currently, right now, today, this week */
  /\b(currently|right now|at the moment|today|this week|this month)/i,
  /** Matches ongoing activity verbs: working on, debugging, implementing, building */
  /\b(working on|debugging|fixing|implementing|building|testing)/i,
  /** Matches recency indicators: just, recently, lately, in the last, past few */
  /\b(just|recently|lately|in the last|past few)/i,
  /** Matches active interaction: meeting with, talking to, discussing with */
  /\b(meeting with|talking to|discussing with)/i,
  /** Matches future intent: planning to, going to, about to, will be */
  /\b(planning to|going to|about to|will be)/i,
  /** Matches difficulty/blockers: struggling with, having trouble with, stuck on */
  /\b(struggling with|having trouble with|stuck on)/i,
  /** Matches investigation: looking into, investigating, researching */
  /\b(looking into|investigating|researching)/i,
] as const

/**
 * Get fact patterns from environment variable or return defaults.
 * Environment variables should contain JSON arrays of pattern strings.
 *
 * @param envKey - Environment variable name to check
 * @param defaults - Default patterns to use if env var is not set
 * @returns Array of RegExp patterns
 *
 * @example
 * ```typescript
 * // Set via environment variable:
 * // SUPERMEMORY_STATIC_PATTERNS='["\b(is|works as)\b"]'
 * const patterns = getFactPatternsFromEnv('SUPERMEMORY_STATIC_PATTERNS', STATIC_FACT_PATTERNS);
 * ```
 */
export function getFactPatternsFromEnv(envKey: string, defaults: readonly RegExp[]): RegExp[] {
  const envValue = typeof process !== 'undefined' ? process.env[envKey] : undefined

  if (!envValue) {
    return [...defaults]
  }

  try {
    const patternStrings = JSON.parse(envValue) as string[]
    return patternStrings.map((p) => new RegExp(p, 'i'))
  } catch {
    // If parsing fails, return defaults
    return [...defaults]
  }
}

/**
 * Get static fact patterns, checking environment override first.
 * Uses SUPERMEMORY_STATIC_PATTERNS environment variable.
 */
export function getStaticFactPatterns(customPatterns?: RegExp[]): RegExp[] {
  if (customPatterns !== undefined) {
    return customPatterns
  }
  return getFactPatternsFromEnv('SUPERMEMORY_STATIC_PATTERNS', STATIC_FACT_PATTERNS)
}

/**
 * Get dynamic fact patterns, checking environment override first.
 * Uses SUPERMEMORY_DYNAMIC_PATTERNS environment variable.
 */
export function getDynamicFactPatterns(customPatterns?: RegExp[]): RegExp[] {
  if (customPatterns !== undefined) {
    return customPatterns
  }
  return getFactPatternsFromEnv('SUPERMEMORY_DYNAMIC_PATTERNS', DYNAMIC_FACT_PATTERNS)
}
