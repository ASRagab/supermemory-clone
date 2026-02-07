/**
 * Base Profile Types for Supermemory Clone
 *
 * Shared base interfaces for profile-related types to prevent duplication
 * across profile.types.ts and types/index.ts
 */

import { z } from 'zod';

// ============================================================================
// Base Schemas
// ============================================================================

/**
 * Fact lifecycle category - determines expiration behavior
 * Used in types/index.ts Profile system
 */
export const FactLifecycleCategorySchema = z.enum([
  'static', // Long-term, rarely changes
  'dynamic', // Temporary, expires over time
  'inferred', // Derived from other facts
]);

export type FactLifecycleCategory = z.infer<typeof FactLifecycleCategorySchema>;

/**
 * Fact semantic category - describes what the fact is about
 * Used in services/profile.types.ts ProfileFact
 */
export const FactSemanticCategorySchema = z.enum([
  'identity', // Name, role, company
  'preference', // Likes, dislikes, preferences
  'skill', // Technical skills, expertise
  'background', // Education, history
  'relationship', // Connections, team members
  'project', // Current/past projects
  'goal', // Objectives, aspirations
  'context', // Current situation, temporary context
  'other', // Uncategorized
]);

export type FactSemanticCategory = z.infer<typeof FactSemanticCategorySchema>;

/**
 * Fact type - static or dynamic lifecycle
 */
export const FactTypeSchema = z.enum(['static', 'dynamic']);

export type FactType = z.infer<typeof FactTypeSchema>;

// ============================================================================
// Base ProfileFact Schema
// ============================================================================

/**
 * Base schema for ProfileFact - shared between service and type layers
 * Contains the common fields that all ProfileFact implementations must have
 */
export const BaseProfileFactSchema = z.object({
  /** Unique identifier for the fact */
  id: z.string(),

  /** The actual fact content */
  content: z.string().min(1),

  /** Confidence score of the extraction (0-1) */
  confidence: z.number().min(0).max(1),

  /** When this fact was created/extracted */
  createdAt: z.date(),

  /** When this fact was last updated */
  updatedAt: z.date(),

  /** Source content or document this was extracted from */
  sourceId: z.string().optional(),
});

export type BaseProfileFact = z.infer<typeof BaseProfileFactSchema>;

// ============================================================================
// Service Layer ProfileFact (extended version)
// ============================================================================

/**
 * Service layer ProfileFact schema - used in profile.service.ts
 * Extends base with service-specific fields
 */
export const ServiceProfileFactSchema = BaseProfileFactSchema.extend({
  /** Whether this is a static (long-term) or dynamic (temporary) fact */
  type: FactTypeSchema,

  /** When this fact was extracted */
  extractedAt: z.date(),

  /** When this fact expires (only for dynamic facts) */
  expiresAt: z.date().optional(),

  /** Category of the fact for organization */
  category: FactSemanticCategorySchema.optional(),

  /** Number of times this fact has been reinforced */
  reinforcementCount: z.number().int().min(0),

  /** Last time this fact was accessed or reinforced */
  lastAccessedAt: z.date(),
});

export type ServiceProfileFact = z.infer<typeof ServiceProfileFactSchema>;

// ============================================================================
// Type Layer ProfileFact (API version)
// ============================================================================

/**
 * Type layer ProfileFact schema - used in types/index.ts
 * Simpler version for API contracts
 */
export const TypeProfileFactSchema = BaseProfileFactSchema.extend({
  /** Key-value style fact key */
  key: z.string(),

  /** Fact value */
  value: z.string(),

  /** Lifecycle category */
  category: FactLifecycleCategorySchema,

  /** Source identifier */
  source: z.string().optional(),
});

export type TypeProfileFact = z.infer<typeof TypeProfileFactSchema>;
