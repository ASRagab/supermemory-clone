/**
 * Profile Repository - Database operations for user profiles
 *
 * Handles persistence of user profiles and facts using PostgreSQL.
 */

import { UserProfile, ProfileFact, FactType, PROFILE_DEFAULTS } from './profile.types.js'
import { getPostgresDatabase } from '../db/postgres.js'
import { getDatabaseUrl, isPostgresUrl } from '../db/client.js'
import { userProfiles } from '../db/schema/profiles.schema.js'
import { containerTags } from '../db/schema/containers.schema.js'
import { eq } from 'drizzle-orm'

let _db: ReturnType<typeof getPostgresDatabase> | null = null

function getDb(): ReturnType<typeof getPostgresDatabase> {
  if (_db) return _db
  const databaseUrl = getDatabaseUrl()
  if (!isPostgresUrl(databaseUrl)) {
    throw new Error(
      'ProfileRepository requires a PostgreSQL DATABASE_URL. SQLite is only supported in tests and is not compatible with profile persistence.'
    )
  }
  _db = getPostgresDatabase(databaseUrl)
  return _db
}

const db = new Proxy({} as ReturnType<typeof getPostgresDatabase>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof getPostgresDatabase>]
  },
})

const PROFILE_VERSION_KEY = 'profileVersion'

function normalizeFacts(facts: unknown): ProfileFact[] {
  if (!Array.isArray(facts)) {
    return []
  }

  return facts.map((fact) => normalizeFact(fact as ProfileFact))
}

function normalizeFact(fact: ProfileFact): ProfileFact {
  return {
    ...fact,
    extractedAt: new Date(fact.extractedAt),
    lastAccessedAt: new Date(fact.lastAccessedAt),
    expiresAt: fact.expiresAt ? new Date(fact.expiresAt) : undefined,
  }
}

function normalizeRecordObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

function getProfileVersion(record: { computedTraits: unknown } | null | undefined): number {
  const computedTraits = normalizeRecordObject(record?.computedTraits)
  const storedVersion = computedTraits[PROFILE_VERSION_KEY]
  if (typeof storedVersion === 'number' && Number.isFinite(storedVersion)) {
    return storedVersion
  }
  return 1
}

function withProfileVersion(computedTraits: Record<string, unknown>, version: number): Record<string, unknown> {
  return {
    ...computedTraits,
    [PROFILE_VERSION_KEY]: version,
  }
}

async function ensureContainerTag(tag: string): Promise<void> {
  await db.insert(containerTags).values({ tag }).onConflictDoNothing({ target: containerTags.tag })
}

function mapDbProfile(record: typeof userProfiles.$inferSelect): UserProfile {
  const computedTraits = normalizeRecordObject(record.computedTraits)
  const version = getProfileVersion({ computedTraits })

  return {
    containerTag: record.containerTag,
    staticFacts: normalizeFacts(record.staticFacts),
    dynamicFacts: normalizeFacts(record.dynamicFacts),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version,
  }
}

/**
 * Database interface for profile storage
 * Implement this interface for different storage backends
 */
export interface ProfileDatabase {
  findByContainerTag(containerTag: string): Promise<UserProfile | null>
  upsert(profile: UserProfile): Promise<UserProfile>
  updateFacts(
    containerTag: string,
    staticFacts: ProfileFact[],
    dynamicFacts: ProfileFact[]
  ): Promise<UserProfile | null>
  delete(containerTag: string): Promise<boolean>
  listAll(): Promise<UserProfile[]>
}

/**
 * PostgreSQL implementation of ProfileDatabase
 */
class PostgresProfileDatabase implements ProfileDatabase {
  async findByContainerTag(containerTag: string): Promise<UserProfile | null> {
    const [record] = await db.select().from(userProfiles).where(eq(userProfiles.containerTag, containerTag))

    return record ? mapDbProfile(record) : null
  }

  async upsert(profile: UserProfile): Promise<UserProfile> {
    await ensureContainerTag(profile.containerTag)
    const [existing] = await db.select().from(userProfiles).where(eq(userProfiles.containerTag, profile.containerTag))

    if (existing) {
      const computedTraits = normalizeRecordObject(existing.computedTraits)
      const nextVersion = getProfileVersion({ computedTraits }) + 1

      const [updated] = await db
        .update(userProfiles)
        .set({
          staticFacts: profile.staticFacts,
          dynamicFacts: profile.dynamicFacts,
          updatedAt: new Date(),
          computedTraits: withProfileVersion(computedTraits, nextVersion),
        })
        .where(eq(userProfiles.containerTag, profile.containerTag))
        .returning()

      return updated ? mapDbProfile(updated) : profile
    }

    const computedTraits = withProfileVersion({}, 1)
    const [created] = await db
      .insert(userProfiles)
      .values({
        containerTag: profile.containerTag,
        staticFacts: profile.staticFacts,
        dynamicFacts: profile.dynamicFacts,
        createdAt: profile.createdAt ?? new Date(),
        updatedAt: profile.updatedAt ?? new Date(),
        computedTraits,
      })
      .returning()

    return created ? mapDbProfile(created) : profile
  }

  async updateFacts(
    containerTag: string,
    staticFacts: ProfileFact[],
    dynamicFacts: ProfileFact[]
  ): Promise<UserProfile | null> {
    await ensureContainerTag(containerTag)
    const [existing] = await db.select().from(userProfiles).where(eq(userProfiles.containerTag, containerTag))

    if (!existing) {
      return null
    }

    const computedTraits = normalizeRecordObject(existing.computedTraits)
    const nextVersion = getProfileVersion({ computedTraits }) + 1

    const [updated] = await db
      .update(userProfiles)
      .set({
        staticFacts,
        dynamicFacts,
        updatedAt: new Date(),
        computedTraits: withProfileVersion(computedTraits, nextVersion),
      })
      .where(eq(userProfiles.containerTag, containerTag))
      .returning()

    return updated ? mapDbProfile(updated) : null
  }

  async delete(containerTag: string): Promise<boolean> {
    const deleted = await db
      .delete(userProfiles)
      .where(eq(userProfiles.containerTag, containerTag))
      .returning({ containerTag: userProfiles.containerTag })

    return deleted.length > 0
  }

  async listAll(): Promise<UserProfile[]> {
    const records = await db.select().from(userProfiles)
    return records.map(mapDbProfile)
  }
}

/**
 * Profile Repository - Main interface for profile database operations
 */
export class ProfileRepository {
  private db: ProfileDatabase

  constructor(database?: ProfileDatabase) {
    this.db = database ?? new PostgresProfileDatabase()
  }

  /**
   * Find a profile by container tag
   */
  async findByContainerTag(containerTag: string): Promise<UserProfile | null> {
    return this.db.findByContainerTag(containerTag)
  }

  /**
   * Create or update a profile
   */
  async upsert(profile: UserProfile): Promise<UserProfile> {
    return this.db.upsert(profile)
  }

  /**
   * Update facts for a profile
   */
  async updateFacts(
    containerTag: string,
    staticFacts: ProfileFact[],
    dynamicFacts: ProfileFact[]
  ): Promise<UserProfile | null> {
    return this.db.updateFacts(containerTag, staticFacts, dynamicFacts)
  }

  /**
   * Delete a profile
   */
  async delete(containerTag: string): Promise<boolean> {
    return this.db.delete(containerTag)
  }

  /**
   * List all profiles
   */
  async listAll(): Promise<UserProfile[]> {
    return this.db.listAll()
  }

  /**
   * Add a single fact to a profile
   */
  async addFact(containerTag: string, fact: ProfileFact): Promise<UserProfile | null> {
    const profile = await this.findByContainerTag(containerTag)
    if (!profile) {
      return null
    }

    const targetArray = fact.type === 'static' ? 'staticFacts' : 'dynamicFacts'
    const updatedFacts = [...profile[targetArray], fact]

    // Enforce max dynamic facts limit
    let finalDynamicFacts = profile.dynamicFacts
    let finalStaticFacts = profile.staticFacts

    if (fact.type === 'dynamic') {
      finalDynamicFacts = updatedFacts
      if (finalDynamicFacts.length > PROFILE_DEFAULTS.maxDynamicFacts) {
        // Remove oldest expired or least recently accessed
        finalDynamicFacts = this.pruneExcessDynamicFacts(finalDynamicFacts)
      }
    } else {
      finalStaticFacts = updatedFacts
    }

    return this.updateFacts(containerTag, finalStaticFacts, finalDynamicFacts)
  }

  /**
   * Remove expired dynamic facts from a profile
   */
  async removeExpiredFacts(containerTag: string): Promise<UserProfile | null> {
    const profile = await this.findByContainerTag(containerTag)
    if (!profile) {
      return null
    }

    const now = new Date()
    const validDynamicFacts = profile.dynamicFacts.filter(
      (fact: ProfileFact) => !fact.expiresAt || fact.expiresAt > now
    )

    if (validDynamicFacts.length === profile.dynamicFacts.length) {
      return profile // No changes needed
    }

    return this.updateFacts(containerTag, profile.staticFacts, validDynamicFacts)
  }

  /**
   * Find facts by content similarity (simple substring match)
   * Replace with vector similarity for production
   */
  async findSimilarFacts(containerTag: string, content: string, type?: FactType): Promise<ProfileFact[]> {
    const profile = await this.findByContainerTag(containerTag)
    if (!profile) {
      return []
    }

    const searchTerms = content.toLowerCase().split(/\s+/)
    const allFacts =
      type === 'static'
        ? profile.staticFacts
        : type === 'dynamic'
          ? profile.dynamicFacts
          : [...profile.staticFacts, ...profile.dynamicFacts]

    return allFacts.filter((fact: ProfileFact) => {
      const factWords = fact.content.toLowerCase()
      return searchTerms.some((term) => factWords.includes(term))
    })
  }

  /**
   * Reinforce a fact (increment count and update access time)
   */
  async reinforceFact(containerTag: string, factId: string): Promise<ProfileFact | null> {
    const profile = await this.findByContainerTag(containerTag)
    if (!profile) {
      return null
    }

    const updateFact = (facts: ProfileFact[]): ProfileFact[] => {
      return facts.map((fact) => {
        if (fact.id === factId) {
          return {
            ...fact,
            reinforcementCount: fact.reinforcementCount + 1,
            lastAccessedAt: new Date(),
          }
        }
        return fact
      })
    }

    const staticFact = profile.staticFacts.find((f: ProfileFact) => f.id === factId)
    const dynamicFact = profile.dynamicFacts.find((f: ProfileFact) => f.id === factId)

    if (staticFact) {
      await this.updateFacts(containerTag, updateFact(profile.staticFacts), profile.dynamicFacts)
      return { ...staticFact, reinforcementCount: staticFact.reinforcementCount + 1 }
    }

    if (dynamicFact) {
      await this.updateFacts(containerTag, profile.staticFacts, updateFact(profile.dynamicFacts))
      return { ...dynamicFact, reinforcementCount: dynamicFact.reinforcementCount + 1 }
    }

    return null
  }

  /**
   * Promote a dynamic fact to static
   */
  async promoteFact(containerTag: string, factId: string): Promise<ProfileFact | null> {
    const profile = await this.findByContainerTag(containerTag)
    if (!profile) {
      return null
    }

    const factIndex = profile.dynamicFacts.findIndex((f: ProfileFact) => f.id === factId)
    if (factIndex === -1) {
      return null
    }

    const fact = profile.dynamicFacts[factIndex]
    if (!fact) {
      return null
    }

    const promotedFact: ProfileFact = {
      ...fact,
      type: 'static',
      expiresAt: undefined,
    }

    const newDynamicFacts = [...profile.dynamicFacts.slice(0, factIndex), ...profile.dynamicFacts.slice(factIndex + 1)]
    const newStaticFacts = [...profile.staticFacts, promotedFact]

    await this.updateFacts(containerTag, newStaticFacts, newDynamicFacts)
    return promotedFact
  }

  /**
   * Prune excess dynamic facts, keeping most relevant ones
   */
  private pruneExcessDynamicFacts(facts: ProfileFact[]): ProfileFact[] {
    const now = new Date()

    // First remove expired facts
    const validFacts = facts.filter((fact) => !fact.expiresAt || fact.expiresAt > now)

    if (validFacts.length <= PROFILE_DEFAULTS.maxDynamicFacts) {
      return validFacts
    }

    // Sort by relevance score (higher is better)
    validFacts.sort((a, b) => {
      const scoreA = this.calculateRelevanceScore(a)
      const scoreB = this.calculateRelevanceScore(b)
      return scoreB - scoreA
    })

    return validFacts.slice(0, PROFILE_DEFAULTS.maxDynamicFacts)
  }

  /**
   * Calculate relevance score for a fact
   */
  private calculateRelevanceScore(fact: ProfileFact): number {
    const now = new Date()
    const ageHours = (now.getTime() - fact.extractedAt.getTime()) / (1000 * 60 * 60)
    const recencyScore = Math.max(0, 1 - ageHours / 168) // Decay over 1 week

    const accessRecency = (now.getTime() - fact.lastAccessedAt.getTime()) / (1000 * 60 * 60)
    const accessScore = Math.max(0, 1 - accessRecency / 168)

    const reinforcementScore = Math.min(1, fact.reinforcementCount / 10)

    return fact.confidence * 0.3 + recencyScore * 0.3 + accessScore * 0.2 + reinforcementScore * 0.2
  }
}

// Export singleton instance
export const profileRepository = new ProfileRepository()
