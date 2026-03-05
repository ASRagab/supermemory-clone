import { z } from 'zod'

// ============================================================================
// Memory Types
// ============================================================================

export const MemoryTypeSchema = z.enum(['fact', 'event', 'preference', 'skill', 'relationship', 'context', 'note'])

export type MemoryType = z.infer<typeof MemoryTypeSchema>

export const RelationshipTypeSchema = z.enum(['updates', 'extends', 'derives', 'contradicts', 'related', 'supersedes'])

export type RelationshipType = z.infer<typeof RelationshipTypeSchema>

export interface MemoryRelationship {
  type: RelationshipType
  targetId: string
  confidence: number
  metadata?: Record<string, unknown>
}

export interface Memory {
  id: string
  content: string
  type: MemoryType
  embedding?: number[]
  relationships: MemoryRelationship[]
  isLatest: boolean
  supersededBy?: string
  containerTag?: string
  metadata: MemoryMetadata
  createdAt: Date
  updatedAt: Date
}

export interface MemoryMetadata {
  source?: string
  confidence?: number
  extractedFrom?: string
  keywords?: string[]
  entities?: Entity[]
  [key: string]: unknown
}

export interface Entity {
  name: string
  type: 'person' | 'place' | 'organization' | 'date' | 'concept' | 'other'
  mentions: number
}

// ============================================================================
// Search Types
// ============================================================================

export const SearchModeSchema = z.enum(['vector', 'keyword', 'hybrid'])
export type SearchMode = z.infer<typeof SearchModeSchema>

export interface SearchQuery {
  query: string
  mode?: SearchMode
  containerTag?: string
  filters?: SearchFilters
  limit?: number
  offset?: number
  rerank?: boolean
  minScore?: number
}

export interface SearchFilters {
  types?: MemoryType[]
  dateRange?: {
    start?: Date
    end?: Date
  }
  metadata?: Record<string, unknown>
  isLatest?: boolean
}

export interface SearchResult {
  memory: Memory
  score: number
  highlights?: string[]
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
  mode: SearchMode
  took: number
}

// ============================================================================
// Profile Types
// ============================================================================

import { FactLifecycleCategorySchema, FactLifecycleCategory, BaseProfileFact } from './profile.base.js'

/**
 * Fact lifecycle category - determines expiration behavior
 * Re-exported from profile.base for convenience
 */
export const FactCategorySchema = FactLifecycleCategorySchema

/**
 * Fact lifecycle category type
 * Note: This represents the fact's lifecycle (static/dynamic/inferred),
 * not its semantic category. For semantic categories (identity, skill, etc.),
 * see FactSemanticCategory in profile.base.ts
 */
export type FactCategory = FactLifecycleCategory

/**
 * API-level ProfileFact - simplified version for API contracts
 * Extends BaseProfileFact with key-value structure for API compatibility
 */
export interface ProfileFact extends BaseProfileFact {
  /** Key for the fact (for key-value style access) */
  key: string
  /** Value of the fact */
  value: string
  /** Lifecycle category */
  category: FactCategory
  /** Source identifier */
  source?: string
}

export interface Profile {
  id: string
  name?: string
  facts: ProfileFact[]
  memories: string[]
  containerTags: string[]
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// Extraction Types
// ============================================================================

export const ContentTypeSchema = z.enum(['text', 'url', 'markdown', 'html', 'json', 'pdf', 'image', 'unknown'])

export type ContentType = z.infer<typeof ContentTypeSchema>

export const ChunkingStrategySchema = z.enum(['sentence', 'paragraph', 'fixed', 'semantic', 'sliding_window'])

export type ChunkingStrategy = z.infer<typeof ChunkingStrategySchema>

export interface ExtractionResult {
  content: string
  contentType: ContentType
  chunks: ContentChunk[]
  metadata: ExtractionMetadata
}

export interface ContentChunk {
  id: string
  content: string
  index: number
  startOffset: number
  endOffset: number
  metadata?: Record<string, unknown>
}

export interface ExtractionMetadata {
  originalLength: number
  chunkCount: number
  processingTime: number
  strategy: ChunkingStrategy
  sourceUrl?: string
  title?: string
  author?: string
  publishedAt?: Date
}

// ============================================================================
// Document Types
// ============================================================================

export const DocumentSchema = z.object({
  id: z.string().optional(),
  content: z.string().min(1, 'Content is required'),
  containerTag: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export type DocumentInput = z.infer<typeof DocumentSchema>

export interface Document {
  id: string
  content: string
  containerTag?: string
  memories: Memory[]
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// API Types
// ============================================================================

export interface APIError {
  code: string
  message: string
  details?: unknown
}

export interface APIResponse<T> {
  success: boolean
  data?: T
  error?: APIError
}

export interface PaginatedResponse<T> extends APIResponse<T[]> {
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

// ============================================================================
// SDK Types
// ============================================================================

export interface SDKConfig {
  apiKey: string
  baseUrl?: string
  timeout?: number
  retries?: number
  retryDelay?: number
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  reset: Date
}
