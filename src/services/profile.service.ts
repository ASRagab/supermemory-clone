/**
 * Profile Service - User profile management for Supermemory Clone
 *
 * Manages user profiles with automatic fact extraction, classification,
 * and lifecycle management. Profiles complement search by providing
 * always-available context about users.
 */

import { v4 as uuidv4 } from 'uuid'
import {
  UserProfile,
  ProfileFact,
  FactClassification,
  FactCategory,
  ExtractionResult,
  ProfileOptions,
  PromotionCriteria,
  PROFILE_DEFAULTS,
  getStaticFactPatterns,
  getDynamicFactPatterns,
} from './profile.types.js'
import { ProfileRepository, profileRepository } from './profile.repository.js'

/**
 * Profile Service - Main class for profile operations
 */
export class ProfileService {
  private repository: ProfileRepository
  private options: Required<Omit<ProfileOptions, 'staticFactPatterns' | 'dynamicFactPatterns'>>
  private staticPatterns: RegExp[]
  private dynamicPatterns: RegExp[]

  constructor(repository?: ProfileRepository, options?: ProfileOptions) {
    this.repository = repository ?? profileRepository
    this.options = {
      autoExtract: options?.autoExtract ?? true,
      refreshDynamic: options?.refreshDynamic ?? true,
      maxDynamicFacts: options?.maxDynamicFacts ?? PROFILE_DEFAULTS.maxDynamicFacts,
      defaultDynamicExpirationHours:
        options?.defaultDynamicExpirationHours ?? PROFILE_DEFAULTS.defaultDynamicExpirationHours,
    }
    // Initialize patterns from options or environment, falling back to defaults
    this.staticPatterns = getStaticFactPatterns(options?.staticFactPatterns)
    this.dynamicPatterns = getDynamicFactPatterns(options?.dynamicFactPatterns)
  }

  /**
   * Get or create a profile for a container tag
   */
  async getProfile(containerTag: string): Promise<UserProfile> {
    let profile = await this.repository.findByContainerTag(containerTag)

    if (!profile) {
      profile = await this.createEmptyProfile(containerTag)
    }

    // Optionally refresh dynamic facts
    if (this.options.refreshDynamic) {
      profile = (await this.refreshDynamicFacts(containerTag)) ?? profile
    }

    return profile
  }

  /**
   * Update profile with new facts
   */
  async updateProfile(containerTag: string, facts: ProfileFact[]): Promise<UserProfile> {
    const profile = await this.getProfile(containerTag)

    const staticFacts = [...profile.staticFacts]
    const dynamicFacts = [...profile.dynamicFacts]

    for (const fact of facts) {
      // Check for duplicates
      const isDuplicate = this.isDuplicateFact(fact, [...staticFacts, ...dynamicFacts])
      if (isDuplicate) {
        // Reinforce existing fact instead of adding duplicate
        await this.reinforceMatchingFact(containerTag, fact)
        continue
      }

      if (fact.type === 'static') {
        staticFacts.push(fact)
      } else {
        dynamicFacts.push(fact)
      }
    }

    const updated = await this.repository.updateFacts(containerTag, staticFacts, this.enforceDynamicLimit(dynamicFacts))

    return updated ?? profile
  }

  /**
   * Extract profile facts from content
   */
  extractProfileFacts(content: string, sourceId?: string): ExtractionResult {
    const startTime = Date.now()
    const facts: ProfileFact[] = []

    // Split content into sentences
    const sentences = this.splitIntoSentences(content)

    for (const sentence of sentences) {
      const extractedFact = this.extractFactFromSentence(sentence, sourceId)
      if (extractedFact) {
        facts.push(extractedFact)
      }
    }

    // Deduplicate facts
    const uniqueFacts = this.deduplicateFacts(facts)

    return {
      facts: uniqueFacts,
      rawContent: content,
      extractedAt: new Date(),
      processingTimeMs: Date.now() - startTime,
    }
  }

  /**
   * Classify a fact as static or dynamic.
   *
   * Uses configurable patterns that can be overridden via:
   * - ProfileOptions.staticFactPatterns / ProfileOptions.dynamicFactPatterns
   * - SUPERMEMORY_STATIC_PATTERNS / SUPERMEMORY_DYNAMIC_PATTERNS environment variables
   */
  classifyFact(factContent: string): FactClassification {
    // Check for static patterns first
    for (const pattern of this.staticPatterns) {
      if (pattern.test(factContent)) {
        return {
          type: 'static',
          confidence: 0.85,
          reason: `Matches static pattern: ${pattern.source.slice(0, 30)}...`,
        }
      }
    }

    // Check for dynamic patterns
    for (const pattern of this.dynamicPatterns) {
      if (pattern.test(factContent)) {
        const expirationHours = this.estimateExpirationHours(factContent)
        return {
          type: 'dynamic',
          confidence: 0.8,
          reason: `Matches dynamic pattern: ${pattern.source.slice(0, 30)}...`,
          suggestedExpirationHours: expirationHours,
        }
      }
    }

    // Default to dynamic with lower confidence if no pattern matches
    return {
      type: 'dynamic',
      confidence: 0.5,
      reason: 'No strong pattern match, defaulting to dynamic',
      suggestedExpirationHours: this.options.defaultDynamicExpirationHours,
    }
  }

  /**
   * Refresh dynamic facts - remove expired and check for promotions
   */
  async refreshDynamicFacts(containerTag: string): Promise<UserProfile | null> {
    // Remove expired facts
    let profile = await this.repository.removeExpiredFacts(containerTag)
    if (!profile) {
      return null
    }

    // Check for facts that should be promoted to static
    const promotionCandidates = this.findPromotionCandidates(profile.dynamicFacts)

    for (const candidate of promotionCandidates) {
      await this.promoteFact(containerTag, candidate.id)
    }

    // Re-fetch profile after promotions
    if (promotionCandidates.length > 0) {
      profile = (await this.repository.findByContainerTag(containerTag)) ?? profile
    }

    return profile
  }

  /**
   * Ingest content and automatically extract/store facts
   */
  async ingestContent(containerTag: string, content: string, sourceId?: string): Promise<ExtractionResult> {
    const result = this.extractProfileFacts(content, sourceId)

    if (result.facts.length > 0 && this.options.autoExtract) {
      await this.updateProfile(containerTag, result.facts)
    }

    return result
  }

  /**
   * Get profile context for search augmentation
   */
  async getProfileContext(containerTag: string): Promise<string> {
    const profile = await this.getProfile(containerTag)

    const staticContext = profile.staticFacts.map((f: ProfileFact) => f.content).join('. ')

    const dynamicContext = profile.dynamicFacts.map((f: ProfileFact) => f.content).join('. ')

    const parts: string[] = []
    if (staticContext) {
      parts.push(`Background: ${staticContext}`)
    }
    if (dynamicContext) {
      parts.push(`Current context: ${dynamicContext}`)
    }

    return parts.join('\n\n')
  }

  /**
   * Manually promote a dynamic fact to static
   */
  async promoteFact(containerTag: string, factId: string): Promise<ProfileFact | null> {
    return this.repository.promoteFact(containerTag, factId)
  }

  /**
   * Get statistics about a profile
   */
  async getProfileStats(containerTag: string): Promise<ProfileStats> {
    const profile = await this.getProfile(containerTag)
    const now = new Date()

    const expiringWithin24h = profile.dynamicFacts.filter((f: ProfileFact) => {
      if (!f.expiresAt) return false
      const hoursUntilExpiry = (f.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
      return hoursUntilExpiry > 0 && hoursUntilExpiry <= 24
    }).length

    const promotionCandidates = this.findPromotionCandidates(profile.dynamicFacts).length

    const categoryBreakdown = this.getCategoryBreakdown([...profile.staticFacts, ...profile.dynamicFacts])

    return {
      totalFacts: profile.staticFacts.length + profile.dynamicFacts.length,
      staticFacts: profile.staticFacts.length,
      dynamicFacts: profile.dynamicFacts.length,
      expiringWithin24h,
      promotionCandidates,
      categoryBreakdown,
      lastUpdated: profile.updatedAt,
    }
  }

  // ============ Private Helper Methods ============

  /**
   * Create an empty profile
   */
  private async createEmptyProfile(containerTag: string): Promise<UserProfile> {
    const profile: UserProfile = {
      containerTag,
      staticFacts: [],
      dynamicFacts: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    }
    return this.repository.upsert(profile)
  }

  /**
   * Split content into sentences for fact extraction
   */
  private splitIntoSentences(content: string): string[] {
    // Split on sentence-ending punctuation, keeping the punctuation
    const sentences = content
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10) // Filter out very short fragments

    return sentences
  }

  /**
   * Extract a fact from a single sentence
   */
  private extractFactFromSentence(sentence: string, sourceId?: string): ProfileFact | null {
    // Check if sentence contains a fact-like structure
    if (!this.containsPotentialFact(sentence)) {
      return null
    }

    const classification = this.classifyFact(sentence)
    const category = this.categorizeFactContent(sentence)
    const now = new Date()

    const fact: ProfileFact = {
      id: uuidv4(),
      content: sentence,
      type: classification.type,
      extractedAt: now,
      confidence: classification.confidence,
      category,
      reinforcementCount: 0,
      lastAccessedAt: now,
      sourceId,
    }

    // Set expiration for dynamic facts
    if (classification.type === 'dynamic') {
      const expirationHours = classification.suggestedExpirationHours ?? this.options.defaultDynamicExpirationHours
      fact.expiresAt = new Date(now.getTime() + expirationHours * 60 * 60 * 1000)
    }

    return fact
  }

  /**
   * Check if a sentence potentially contains a fact
   */
  private containsPotentialFact(sentence: string): boolean {
    // Must have a subject-verb structure (contains "is", "are", "has", "works", etc.)
    const factIndicators = [
      /\b(is|are|was|were)\b/i,
      /\b(has|have|had)\b/i,
      /\b(works|worked|working)\b/i,
      /\b(prefers?|likes?|loves?|hates?)\b/i,
      /\b(uses?|using)\b/i,
      /\b(knows?|knowing)\b/i,
      /\b(studies|studied|studying)\b/i,
      /\b(lives?|living|based)\b/i,
      /\b(speaks?|speaking)\b/i,
      /\b(currently|right now|today)\b/i,
    ]

    return factIndicators.some((pattern) => pattern.test(sentence))
  }

  /**
   * Categorize fact content
   */
  private categorizeFactContent(content: string): FactCategory {
    const lower = content.toLowerCase()

    if (/\b(engineer|developer|manager|designer|architect|analyst)\b/.test(lower)) {
      return 'identity'
    }
    if (/\b(prefers?|likes?|loves?|hates?|favorite)\b/.test(lower)) {
      return 'preference'
    }
    if (/\b(skills?|expertise|proficient|experienced in|knows?)\b/.test(lower)) {
      return 'skill'
    }
    if (/\b(graduated|studied|degree|university|college|school)\b/.test(lower)) {
      return 'background'
    }
    if (/\b(team|colleague|reports to|works with|manager)\b/.test(lower)) {
      return 'relationship'
    }
    if (/\b(project|building|developing|working on)\b/.test(lower)) {
      return 'project'
    }
    if (/\b(goals?|objectives?|wants to|plans? to|aims? to)\b/.test(lower)) {
      return 'goal'
    }
    if (/\b(currently|right now|today|this week|at the moment)\b/.test(lower)) {
      return 'context'
    }

    return 'other'
  }

  /**
   * Estimate expiration hours based on content
   */
  private estimateExpirationHours(content: string): number {
    const lower = content.toLowerCase()

    // Very short-term indicators
    if (/\b(right now|at the moment|today)\b/.test(lower)) {
      return 24 // 1 day
    }

    // Short-term indicators
    if (/\b(this week|currently)\b/.test(lower)) {
      return 72 // 3 days
    }

    // Medium-term indicators
    if (/\b(this month|recently|lately)\b/.test(lower)) {
      return 168 // 1 week
    }

    // Project-related (longer duration)
    if (/\b(working on|building|developing|project)\b/.test(lower)) {
      return 336 // 2 weeks
    }

    return this.options.defaultDynamicExpirationHours
  }

  /**
   * Check if a fact is a duplicate of existing facts
   */
  private isDuplicateFact(newFact: ProfileFact, existingFacts: ProfileFact[]): boolean {
    const newContent = newFact.content.toLowerCase()

    return existingFacts.some((existing) => {
      const existingContent = existing.content.toLowerCase()

      // Exact match
      if (newContent === existingContent) {
        return true
      }

      // High similarity (simple Jaccard-like check)
      const similarity = this.calculateSimilarity(newContent, existingContent)
      return similarity > 0.8
    })
  }

  /**
   * Calculate simple similarity between two strings
   */
  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/))
    const wordsB = new Set(b.split(/\s+/))

    const intersection = new Set(Array.from(wordsA).filter((w) => wordsB.has(w)))
    const union = new Set([...Array.from(wordsA), ...Array.from(wordsB)])

    return intersection.size / union.size
  }

  /**
   * Reinforce a matching existing fact
   */
  private async reinforceMatchingFact(containerTag: string, newFact: ProfileFact): Promise<void> {
    const profile = await this.repository.findByContainerTag(containerTag)
    if (!profile) return

    const allFacts = [...profile.staticFacts, ...profile.dynamicFacts]
    const matching = allFacts.find(
      (f) => this.calculateSimilarity(f.content.toLowerCase(), newFact.content.toLowerCase()) > 0.8
    )

    if (matching) {
      await this.repository.reinforceFact(containerTag, matching.id)
    }
  }

  /**
   * Deduplicate a list of facts
   */
  private deduplicateFacts(facts: ProfileFact[]): ProfileFact[] {
    const unique: ProfileFact[] = []

    for (const fact of facts) {
      if (!this.isDuplicateFact(fact, unique)) {
        unique.push(fact)
      }
    }

    return unique
  }

  /**
   * Enforce the maximum dynamic facts limit
   */
  private enforceDynamicLimit(facts: ProfileFact[]): ProfileFact[] {
    if (facts.length <= this.options.maxDynamicFacts) {
      return facts
    }

    // Sort by relevance (confidence + recency)
    const scored = facts.map((fact) => ({
      fact,
      score: this.calculateFactScore(fact),
    }))

    scored.sort((a, b) => b.score - a.score)

    return scored.slice(0, this.options.maxDynamicFacts).map((s) => s.fact)
  }

  /**
   * Calculate a relevance score for a fact
   */
  private calculateFactScore(fact: ProfileFact): number {
    const now = new Date()
    const ageHours = (now.getTime() - fact.extractedAt.getTime()) / (1000 * 60 * 60)
    const recencyScore = Math.exp(-ageHours / 72) // Decay with half-life of ~50 hours

    return fact.confidence * 0.5 + recencyScore * 0.3 + (fact.reinforcementCount / 10) * 0.2
  }

  /**
   * Find dynamic facts that are candidates for promotion to static
   */
  private findPromotionCandidates(
    dynamicFacts: ProfileFact[],
    criteria: PromotionCriteria = PROFILE_DEFAULTS.promotionCriteria
  ): ProfileFact[] {
    const now = new Date()

    return dynamicFacts.filter((fact) => {
      const ageDays = (now.getTime() - fact.extractedAt.getTime()) / (1000 * 60 * 60 * 24)

      return (
        fact.reinforcementCount >= criteria.minReinforcementCount &&
        ageDays >= criteria.minAgeDays &&
        fact.confidence >= criteria.minConfidence
      )
    })
  }

  /**
   * Get category breakdown of facts
   */
  private getCategoryBreakdown(facts: ProfileFact[]): Record<FactCategory, number> {
    const breakdown: Record<FactCategory, number> = {
      identity: 0,
      preference: 0,
      skill: 0,
      background: 0,
      relationship: 0,
      project: 0,
      goal: 0,
      context: 0,
      other: 0,
    }

    for (const fact of facts) {
      const category: FactCategory = fact.category ?? 'other'
      breakdown[category] = (breakdown[category] ?? 0) + 1
    }

    return breakdown
  }
}

/**
 * Profile statistics
 */
export interface ProfileStats {
  totalFacts: number
  staticFacts: number
  dynamicFacts: number
  expiringWithin24h: number
  promotionCandidates: number
  categoryBreakdown: Record<FactCategory, number>
  lastUpdated: Date
}

// Export singleton instance
export const profileService = new ProfileService()
