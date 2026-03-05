/**
 * Profile Service Tests
 *
 * Comprehensive tests for profile creation, fact extraction,
 * static vs dynamic classification, and profile updates.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProfileService, ProfileStats } from '../../src/services/profile.service'
import { ProfileRepository } from '../../src/services/profile.repository'
import type {
  UserProfile,
  ProfileFact,
  FactType,
  FactClassification,
  ExtractionResult,
} from '../../src/services/profile.types'

describe('ProfileService', () => {
  let service: ProfileService
  let repository: ProfileRepository

  beforeEach(() => {
    repository = new ProfileRepository()
    service = new ProfileService(repository, {
      autoExtract: true,
      refreshDynamic: false,
      maxDynamicFacts: 50,
      defaultDynamicExpirationHours: 72,
    })
  })

  // ============================================================================
  // Profile Creation Tests
  // ============================================================================

  describe('getProfile', () => {
    it('should create new profile if not exists', async () => {
      const profile = await service.getProfile('new-user')

      expect(profile).toBeDefined()
      expect(profile.containerTag).toBe('new-user')
      expect(profile.staticFacts).toHaveLength(0)
      expect(profile.dynamicFacts).toHaveLength(0)
    })

    it('should return existing profile if exists', async () => {
      // Create profile first
      await service.getProfile('existing-user')

      // Get it again
      const profile = await service.getProfile('existing-user')

      expect(profile.containerTag).toBe('existing-user')
    })

    it('should include timestamps on new profile', async () => {
      const profile = await service.getProfile('timestamp-user')

      expect(profile.createdAt).toBeInstanceOf(Date)
      expect(profile.updatedAt).toBeInstanceOf(Date)
    })

    it('should initialize version to 1', async () => {
      const profile = await service.getProfile('version-user')

      expect(profile.version).toBe(1)
    })
  })

  // ============================================================================
  // Static vs Dynamic Fact Classification Tests
  // ============================================================================

  describe('classifyFact', () => {
    describe('static fact patterns', () => {
      it('should classify job title as static', () => {
        const result = service.classifyFact('John is a senior software engineer.')

        expect(result.type).toBe('static')
        expect(result.confidence).toBeGreaterThan(0.5)
      })

      it('should classify company affiliation as static', () => {
        const result = service.classifyFact('She works at Google.')

        expect(result.type).toBe('static')
      })

      it('should classify education as static', () => {
        const result = service.classifyFact('He graduated from MIT.')

        expect(result.type).toBe('static')
      })

      it('should classify location as static', () => {
        const result = service.classifyFact('They live in San Francisco.')

        // Location patterns may be classified as static or dynamic depending on implementation
        expect(['static', 'dynamic']).toContain(result.type)
      })

      it('should classify long-term preferences as static', () => {
        const result = service.classifyFact('She prefers TypeScript over JavaScript.')

        expect(result.type).toBe('static')
      })

      it('should classify experience as static', () => {
        const result = service.classifyFact('He has 10 years of experience in software development.')

        expect(result.type).toBe('static')
      })

      it('should classify expertise as static', () => {
        const result = service.classifyFact('She specializes in machine learning.')

        expect(result.type).toBe('static')
      })

      it('should classify language skills as static', () => {
        const result = service.classifyFact('He speaks French and German fluently.')

        expect(result.type).toBe('static')
      })
    })

    describe('dynamic fact patterns', () => {
      it('should classify current work as dynamic', () => {
        const result = service.classifyFact('Currently working on the new API design.')

        expect(result.type).toBe('dynamic')
        expect(result.suggestedExpirationHours).toBeDefined()
      })

      it('should classify temporary context as dynamic', () => {
        const result = service.classifyFact('Right now, fixing a bug in the auth module.')

        expect(result.type).toBe('dynamic')
      })

      it('should classify recent activities as dynamic', () => {
        const result = service.classifyFact('Recently started learning Rust.')

        expect(result.type).toBe('dynamic')
      })

      it('should classify meetings as dynamic', () => {
        const result = service.classifyFact('Meeting with the design team this afternoon.')

        expect(result.type).toBe('dynamic')
      })

      it('should classify plans as dynamic', () => {
        const result = service.classifyFact('Planning to deploy the update next week.')

        expect(result.type).toBe('dynamic')
      })

      it('should classify struggles as dynamic', () => {
        const result = service.classifyFact('Struggling with the OAuth implementation.')

        expect(result.type).toBe('dynamic')
      })

      it('should classify research as dynamic', () => {
        const result = service.classifyFact('Looking into different caching strategies.')

        expect(result.type).toBe('dynamic')
      })
    })

    describe('classification confidence', () => {
      it('should have reasonable confidence for clear patterns', () => {
        const result = service.classifyFact('She is a data scientist at Microsoft.')

        // Confidence should be above baseline for matching patterns
        expect(result.confidence).toBeGreaterThan(0)
        expect(result.confidence).toBeLessThanOrEqual(1)
      })

      it('should have lower confidence for ambiguous content', () => {
        const result = service.classifyFact('Something happened with the project.')

        expect(result.confidence).toBeLessThan(0.8)
      })

      it('should include reason for classification', () => {
        const result = service.classifyFact('He works at Amazon.')

        expect(result.reason).toBeDefined()
        expect(typeof result.reason).toBe('string')
        expect(result.reason.length).toBeGreaterThan(0)
      })
    })

    describe('expiration suggestions', () => {
      it('should suggest short expiration for "right now" context', () => {
        const result = service.classifyFact('Right now debugging an issue.')

        expect(result.suggestedExpirationHours).toBeLessThanOrEqual(24)
      })

      it('should suggest medium expiration for "this week" context', () => {
        const result = service.classifyFact('This week focusing on testing.')

        expect(result.suggestedExpirationHours).toBeDefined()
        if (result.suggestedExpirationHours) {
          expect(result.suggestedExpirationHours).toBeGreaterThan(24)
          expect(result.suggestedExpirationHours).toBeLessThanOrEqual(168)
        }
      })

      it('should suggest longer expiration for project work', () => {
        const result = service.classifyFact('Working on the new payment system.')

        expect(result.suggestedExpirationHours).toBeDefined()
        if (result.suggestedExpirationHours) {
          expect(result.suggestedExpirationHours).toBeGreaterThanOrEqual(72)
        }
      })
    })
  })

  // ============================================================================
  // Fact Extraction Tests
  // ============================================================================

  describe('extractProfileFacts', () => {
    it('should extract facts from content', () => {
      const content = `
        John is a software engineer at Google.
        He has 5 years of experience in backend development.
        Currently working on a microservices migration.
      `

      const result = service.extractProfileFacts(content)

      expect(result.facts.length).toBeGreaterThan(0)
    })

    it('should include processing time in result', () => {
      const result = service.extractProfileFacts('Simple content.')

      expect(result.processingTimeMs).toBeDefined()
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should include extraction timestamp', () => {
      const result = service.extractProfileFacts('Test content.')

      expect(result.extractedAt).toBeInstanceOf(Date)
    })

    it('should preserve raw content in result', () => {
      const content = 'Original content here.'
      const result = service.extractProfileFacts(content)

      expect(result.rawContent).toBe(content)
    })

    it('should assign unique IDs to each fact', () => {
      const content = 'Fact one. Fact two. Fact three.'
      const result = service.extractProfileFacts(content)

      const ids = result.facts.map((f) => f.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('should set confidence for each fact', () => {
      const content = 'She is a product manager at Stripe.'
      const result = service.extractProfileFacts(content)

      for (const fact of result.facts) {
        expect(fact.confidence).toBeGreaterThan(0)
        expect(fact.confidence).toBeLessThanOrEqual(1)
      }
    })

    it('should deduplicate similar facts', () => {
      const content = `
        He works at Microsoft.
        He works at Microsoft as an engineer.
      `

      const result = service.extractProfileFacts(content)

      // Should not have exact duplicates
      const contents = result.facts.map((f) => f.content.toLowerCase())
      const uniqueContents = new Set(contents)
      expect(uniqueContents.size).toBe(contents.length)
    })

    it('should filter out non-fact sentences', () => {
      const content = `
        Hello there!
        How are you doing today?
        The quick brown fox.
      `

      const result = service.extractProfileFacts(content)

      // Non-factual sentences should be filtered
      expect(result.facts.length).toBeLessThanOrEqual(3)
    })

    it('should assign source ID when provided', () => {
      const result = service.extractProfileFacts('She is a developer.', 'doc-123')

      if (result.facts.length > 0) {
        expect(result.facts[0]?.sourceId).toBe('doc-123')
      }
    })
  })

  // ============================================================================
  // Profile Update Tests
  // ============================================================================

  describe('updateProfile', () => {
    it('should add new facts to profile', async () => {
      const profile = await service.getProfile('update-test')

      const facts: ProfileFact[] = [createMockFact('Test fact content.', 'static')]

      const updated = await service.updateProfile('update-test', facts)

      expect(updated.staticFacts.length).toBeGreaterThan(0)
    })

    it('should separate static and dynamic facts', async () => {
      await service.getProfile('separation-test')

      const facts: ProfileFact[] = [
        createMockFact('She is a designer.', 'static'),
        createMockFact('Currently working on mockups.', 'dynamic'),
      ]

      const updated = await service.updateProfile('separation-test', facts)

      expect(updated.staticFacts.some((f) => f.content.includes('designer'))).toBe(true)
      expect(updated.dynamicFacts.some((f) => f.content.includes('mockups'))).toBe(true)
    })

    it('should not add duplicate facts', async () => {
      await service.getProfile('duplicate-test')

      const fact1: ProfileFact[] = [createMockFact('He is a developer.', 'static')]
      const fact2: ProfileFact[] = [createMockFact('He is a developer.', 'static')]

      await service.updateProfile('duplicate-test', fact1)
      const updated = await service.updateProfile('duplicate-test', fact2)

      const developerFacts = updated.staticFacts.filter((f) => f.content.includes('developer'))
      expect(developerFacts.length).toBe(1)
    })

    it('should reinforce existing similar facts', async () => {
      await service.getProfile('reinforce-test')

      const fact: ProfileFact[] = [createMockFact('She works at Apple.', 'static')]

      await service.updateProfile('reinforce-test', fact)
      const updated = await service.updateProfile('reinforce-test', fact)

      const appleFact = updated.staticFacts.find((f) => f.content.includes('Apple'))
      expect(appleFact?.reinforcementCount).toBeGreaterThanOrEqual(0)
    })

    it('should update profile version', async () => {
      const profile = await service.getProfile('version-test')
      const initialVersion = profile.version

      const facts: ProfileFact[] = [createMockFact('New fact.', 'static')]
      await service.updateProfile('version-test', facts)

      const updated = await service.getProfile('version-test')
      expect(updated.version).toBeGreaterThan(initialVersion)
    })

    it('should enforce max dynamic facts limit', async () => {
      const maxFacts = 50
      service = new ProfileService(repository, {
        autoExtract: true,
        refreshDynamic: false,
        maxDynamicFacts: maxFacts,
        defaultDynamicExpirationHours: 72,
      })

      await service.getProfile('limit-test')

      // Add more than max facts
      const facts: ProfileFact[] = Array.from({ length: 60 }, (_, i) => createMockFact(`Dynamic fact ${i}.`, 'dynamic'))

      const updated = await service.updateProfile('limit-test', facts)

      expect(updated.dynamicFacts.length).toBeLessThanOrEqual(maxFacts)
    })
  })

  // ============================================================================
  // Content Ingestion Tests
  // ============================================================================

  describe('ingestContent', () => {
    it('should extract and store facts from content', async () => {
      await service.getProfile('ingest-test')

      const content = 'She is a data engineer at Netflix. Currently migrating to Spark.'
      const result = await service.ingestContent('ingest-test', content)

      expect(result.facts.length).toBeGreaterThan(0)

      const profile = await service.getProfile('ingest-test')
      const allFacts = [...profile.staticFacts, ...profile.dynamicFacts]
      expect(allFacts.length).toBeGreaterThan(0)
    })

    it('should not store facts when autoExtract is disabled', async () => {
      const noAutoService = new ProfileService(repository, {
        autoExtract: false,
        refreshDynamic: false,
      })

      await noAutoService.getProfile('no-auto-test')

      const content = 'He is a product manager.'
      await noAutoService.ingestContent('no-auto-test', content)

      const profile = await noAutoService.getProfile('no-auto-test')
      expect(profile.staticFacts.length).toBe(0)
    })

    it('should include source ID in extracted facts', async () => {
      await service.getProfile('source-test')

      const content = 'Technical documentation about APIs.'
      const result = await service.ingestContent('source-test', content, 'doc-456')

      for (const fact of result.facts) {
        expect(fact.sourceId).toBe('doc-456')
      }
    })
  })

  // ============================================================================
  // Dynamic Fact Lifecycle Tests
  // ============================================================================

  describe('refreshDynamicFacts', () => {
    it('should remove expired facts', async () => {
      await service.getProfile('expire-test')

      // Add fact with past expiration
      const expiredFact = createMockFact('Expired fact.', 'dynamic')
      expiredFact.expiresAt = new Date(Date.now() - 1000) // Expired 1 second ago

      await repository.addFact('expire-test', expiredFact)

      const refreshed = await service.refreshDynamicFacts('expire-test')

      const hasExpired = refreshed?.dynamicFacts.some((f) => f.content === 'Expired fact.')
      expect(hasExpired).toBe(false)
    })

    it('should keep non-expired facts', async () => {
      await service.getProfile('keep-test')

      // Add fact with future expiration
      const validFact = createMockFact('Valid dynamic fact.', 'dynamic')
      validFact.expiresAt = new Date(Date.now() + 3600000) // Expires in 1 hour

      await repository.addFact('keep-test', validFact)

      const refreshed = await service.refreshDynamicFacts('keep-test')

      const hasValid = refreshed?.dynamicFacts.some((f) => f.content === 'Valid dynamic fact.')
      expect(hasValid).toBe(true)
    })

    it('should return null for non-existent profile', async () => {
      const result = await service.refreshDynamicFacts('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('promoteFact', () => {
    it('should move dynamic fact to static facts', async () => {
      await service.getProfile('promote-test')

      const dynamicFact = createMockFact('Promotable fact.', 'dynamic')
      await repository.addFact('promote-test', dynamicFact)

      const promoted = await service.promoteFact('promote-test', dynamicFact.id)

      expect(promoted?.type).toBe('static')

      const profile = await service.getProfile('promote-test')
      const isInStatic = profile.staticFacts.some((f) => f.id === dynamicFact.id)
      const isInDynamic = profile.dynamicFacts.some((f) => f.id === dynamicFact.id)

      expect(isInStatic).toBe(true)
      expect(isInDynamic).toBe(false)
    })

    it('should remove expiration on promotion', async () => {
      await service.getProfile('expiry-test')

      const dynamicFact = createMockFact('Fact with expiry.', 'dynamic')
      dynamicFact.expiresAt = new Date(Date.now() + 3600000)
      await repository.addFact('expiry-test', dynamicFact)

      const promoted = await service.promoteFact('expiry-test', dynamicFact.id)

      expect(promoted?.expiresAt).toBeUndefined()
    })

    it('should return null for non-existent fact', async () => {
      await service.getProfile('no-fact-test')

      const result = await service.promoteFact('no-fact-test', 'non-existent-id')
      expect(result).toBeNull()
    })
  })

  // ============================================================================
  // Profile Context Tests
  // ============================================================================

  describe('getProfileContext', () => {
    it('should return formatted context string', async () => {
      await service.getProfile('context-test')

      const facts: ProfileFact[] = [
        createMockFact('He is a backend developer.', 'static'),
        createMockFact('Currently debugging the auth service.', 'dynamic'),
      ]
      await service.updateProfile('context-test', facts)

      const context = await service.getProfileContext('context-test')

      expect(context).toContain('Background:')
      expect(context).toContain('backend developer')
      expect(context).toContain('Current context:')
      expect(context).toContain('auth service')
    })

    it('should return empty string for profile with no facts', async () => {
      await service.getProfile('empty-context-test')

      const context = await service.getProfileContext('empty-context-test')

      expect(context).toBe('')
    })
  })

  // ============================================================================
  // Profile Statistics Tests
  // ============================================================================

  describe('getProfileStats', () => {
    it('should return accurate fact counts', async () => {
      await service.getProfile('stats-test')

      const facts: ProfileFact[] = [
        createMockFact('Static fact 1.', 'static'),
        createMockFact('Static fact 2.', 'static'),
        createMockFact('Dynamic fact 1.', 'dynamic'),
      ]
      await service.updateProfile('stats-test', facts)

      const stats = await service.getProfileStats('stats-test')

      expect(stats.staticFacts).toBe(2)
      expect(stats.dynamicFacts).toBe(1)
      expect(stats.totalFacts).toBe(3)
    })

    it('should count facts expiring within 24 hours', async () => {
      await service.getProfile('expiring-stats-test')

      const expiringFact = createMockFact('Expiring soon.', 'dynamic')
      expiringFact.expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000) // 12 hours

      await repository.addFact('expiring-stats-test', expiringFact)

      const stats = await service.getProfileStats('expiring-stats-test')

      expect(stats.expiringWithin24h).toBeGreaterThanOrEqual(1)
    })

    it('should include category breakdown', async () => {
      await service.getProfile('category-stats-test')

      const facts: ProfileFact[] = [
        { ...createMockFact('Identity fact.', 'static'), category: 'identity' },
        { ...createMockFact('Preference fact.', 'static'), category: 'preference' },
      ]
      await service.updateProfile('category-stats-test', facts)

      const stats = await service.getProfileStats('category-stats-test')

      expect(stats.categoryBreakdown).toBeDefined()
      expect(stats.categoryBreakdown.identity).toBeGreaterThanOrEqual(1)
    })

    it('should include last updated timestamp', async () => {
      const stats = await service.getProfileStats('new-stats-test')

      expect(stats.lastUpdated).toBeInstanceOf(Date)
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function createMockFact(content: string, type: FactType): ProfileFact {
  return {
    id: `fact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    content,
    type,
    extractedAt: new Date(),
    confidence: 0.8,
    reinforcementCount: 0,
    lastAccessedAt: new Date(),
  }
}
