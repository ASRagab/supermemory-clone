import { z } from 'zod'

// ============================================================================
// Security Constants
// ============================================================================

/** Maximum content size in characters (50KB) */
const MAX_CONTENT_CHARS = 50000

/** Maximum query size in characters (10KB) */
const MAX_QUERY_CHARS = 10000

/** Maximum metadata size in bytes (10KB) */
const MAX_METADATA_BYTES = 10240

// ============================================================================
// Base Response Types
// ============================================================================

export interface SuccessResponse<T> {
  data: T
  timing: number
}

export interface ErrorResponse {
  error: {
    code: string
    message: string
  }
  status: number
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse

// ============================================================================
// Document Types
// ============================================================================

export const DocumentMetadataSchema = z
  .record(z.unknown())
  .optional()
  .refine(
    (metadata) => {
      if (!metadata) return true
      try {
        const jsonSize = new TextEncoder().encode(JSON.stringify(metadata)).length
        return jsonSize <= MAX_METADATA_BYTES
      } catch {
        return false
      }
    },
    { message: `Metadata must be at most ${MAX_METADATA_BYTES} bytes (10KB)` }
  )

export const CreateDocumentSchema = z.object({
  content: z
    .string()
    .min(1, 'Content is required')
    .max(MAX_CONTENT_CHARS, `Content must be at most ${MAX_CONTENT_CHARS} characters`),
  containerTag: z.string().min(1).max(100).optional(),
  metadata: DocumentMetadataSchema,
  customId: z.string().min(1).max(255).optional(),
})

export const UpdateDocumentSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(MAX_CONTENT_CHARS, `Content must be at most ${MAX_CONTENT_CHARS} characters`)
    .optional(),
  containerTag: z.string().min(1).max(100).optional(),
  metadata: DocumentMetadataSchema,
})

export const ListDocumentsQuerySchema = z.object({
  containerTag: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export const BulkDeleteSchema = z
  .object({
    ids: z.array(z.string()).optional(),
    containerTags: z.array(z.string()).optional(),
  })
  .refine((data) => data.ids?.length || data.containerTags?.length, {
    message: 'Either ids or containerTags must be provided',
  })

export interface ApiDocument {
  id: string
  content: string
  containerTag?: string
  metadata?: Record<string, unknown>
  customId?: string
  createdAt: string
  updatedAt: string
}

export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>
export type BulkDeleteInput = z.infer<typeof BulkDeleteSchema>

// ============================================================================
// Search Types
// ============================================================================

export const SearchModeSchema = z.enum(['vector', 'fulltext', 'hybrid'])

export const SearchFiltersSchema = z.object({
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const SearchRequestSchema = z.object({
  q: z.string().min(1, 'Query is required').max(MAX_QUERY_CHARS, `Query must be at most ${MAX_QUERY_CHARS} characters`),
  containerTag: z.string().max(100).optional(),
  searchMode: SearchModeSchema.default('hybrid'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  threshold: z.coerce.number().min(0).max(1).default(0.7),
  rerank: z.boolean().default(false),
  filters: SearchFiltersSchema.optional(),
})

export interface SearchResult {
  id: string
  content: string
  score: number
  containerTag?: string
  metadata?: Record<string, unknown>
  highlights?: string[]
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
  searchMode: string
}

export type SearchRequest = z.infer<typeof SearchRequestSchema>
export type SearchFilters = z.infer<typeof SearchFiltersSchema>

// ============================================================================
// Profile Types
// ============================================================================

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  settings: z.record(z.unknown()).optional(),
})

export interface ApiProfile {
  containerTag: string
  name?: string
  description?: string
  settings?: Record<string, unknown>
  documentCount: number
  createdAt: string
  updatedAt: string
}

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

// ============================================================================
// Authentication Types
// ============================================================================

export interface AuthContext {
  userId: string
  apiKey: string
  scopes: string[]
}

// ============================================================================
// Error Codes
// ============================================================================

export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]
