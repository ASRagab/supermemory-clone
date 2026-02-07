/**
 * Validation Utilities for Supermemory Clone
 *
 * Provides Zod schema validation helpers, common validators, and security-focused schemas.
 *
 * Security Features:
 * - Content size validation (50KB default)
 * - Path traversal prevention
 * - URL protocol whitelisting (http, https only)
 * - XSS-safe string schemas with auto-sanitization
 */

import { z, ZodError, ZodSchema } from 'zod';
import { ValidationError } from './errors.js';
import { sanitizeHtml, sanitizeForStorage, isPathSafe, sanitizeUrl } from './sanitization.js';

// ============================================================================
// Security Constants
// ============================================================================

/**
 * Maximum content size in bytes (50KB).
 */
export const MAX_CONTENT_SIZE = 50 * 1024;

/**
 * Maximum query string length (10KB).
 */
export const MAX_QUERY_LENGTH = 10 * 1024;

/**
 * Maximum metadata JSON size (10KB).
 */
export const MAX_METADATA_SIZE = 10 * 1024;

/**
 * Maximum container tag length.
 */
export const MAX_CONTAINER_TAG_LENGTH = 100;

/**
 * Allowed URL protocols.
 */
export const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'];

// ============================================================================
// Common Schemas
// ============================================================================

/**
 * Non-empty string schema
 */
export const nonEmptyString = z.string().min(1, 'Value cannot be empty');

/**
 * UUID schema
 */
export const uuidSchema = z.string().uuid('Invalid UUID format');

/**
 * Positive integer schema
 */
export const positiveInt = z.number().int().positive();

/**
 * Non-negative integer schema
 */
export const nonNegativeInt = z.number().int().nonnegative();

/**
 * Confidence score schema (0-1)
 */
export const confidenceScore = z
  .number()
  .min(0, 'Confidence must be at least 0')
  .max(1, 'Confidence must be at most 1');

/**
 * Container tag schema
 */
export const containerTagSchema = z
  .string()
  .min(1, 'Container tag cannot be empty')
  .max(100, 'Container tag must be at most 100 characters')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Container tag can only contain alphanumeric characters, underscores, and hyphens'
  );

/**
 * Pagination options schema
 */
export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).default(0),
});

/**
 * Date range schema
 */
export const dateRangeSchema = z
  .object({
    from: z.date().optional(),
    to: z.date().optional(),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return data.from <= data.to;
      }
      return true;
    },
    { message: 'Start date must be before or equal to end date' }
  );

// ============================================================================
// Memory Schemas
// ============================================================================

/**
 * Memory type enum schema
 */
export const memoryTypeSchema = z.enum([
  'fact',
  'event',
  'preference',
  'skill',
  'relationship',
  'context',
  'note',
]);

/**
 * Relationship type enum schema
 */
export const relationshipTypeSchema = z.enum([
  'updates',
  'extends',
  'derives',
  'contradicts',
  'related',
  'supersedes',
]);

/**
 * Memory creation input schema
 */
export const createMemoryInputSchema = z.object({
  content: nonEmptyString.describe('Memory content'),
  type: memoryTypeSchema.optional().describe('Memory type'),
  containerTag: containerTagSchema.optional().describe('Container tag'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});

/**
 * Memory query options schema
 */
export const memoryQueryOptionsSchema = z.object({
  containerTag: containerTagSchema.optional(),
  type: memoryTypeSchema.optional(),
  latestOnly: z.boolean().optional(),
  minConfidence: confidenceScore.optional(),
  limit: positiveInt.max(1000).optional().default(100),
  offset: nonNegativeInt.optional().default(0),
  sortBy: z.enum(['createdAt', 'updatedAt', 'confidence']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// ============================================================================
// Profile Schemas
// ============================================================================

/**
 * Fact type enum schema
 */
export const factTypeSchema = z.enum(['static', 'dynamic']);

/**
 * Fact category enum schema
 */
export const factCategorySchema = z.enum([
  'identity',
  'preference',
  'skill',
  'background',
  'relationship',
  'project',
  'goal',
  'context',
  'other',
]);

/**
 * Profile fact input schema
 */
export const profileFactInputSchema = z.object({
  content: nonEmptyString.describe('Fact content'),
  type: factTypeSchema.optional().describe('Fact type'),
  category: factCategorySchema.optional().describe('Fact category'),
  confidence: confidenceScore.optional().describe('Confidence score'),
  sourceId: z.string().optional().describe('Source identifier'),
});

// ============================================================================
// Search Schemas
// ============================================================================

/**
 * Search mode enum schema
 */
export const searchModeSchema = z.enum(['vector', 'memory', 'fulltext', 'hybrid']);

/**
 * Metadata filter operator schema
 */
export const filterOperatorSchema = z.enum([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
]);

/**
 * Metadata filter schema
 */
export const metadataFilterSchema = z.object({
  key: nonEmptyString.describe('Metadata key to filter'),
  value: z.union([z.string(), z.number(), z.boolean()]).describe('Filter value'),
  operator: filterOperatorSchema.optional().default('eq').describe('Comparison operator'),
});

/**
 * Search options schema
 */
export const searchOptionsSchema = z.object({
  query: nonEmptyString.describe('Search query'),
  containerTag: containerTagSchema.optional(),
  searchMode: searchModeSchema.optional().default('hybrid'),
  limit: positiveInt.max(100).optional().default(10),
  threshold: confidenceScore.optional().default(0.7),
  rerank: z.boolean().optional().default(true),
  rewriteQuery: z.boolean().optional().default(true),
  filters: z.array(metadataFilterSchema).optional(),
  dateRange: dateRangeSchema.optional(),
  includeEmbeddings: z.boolean().optional().default(false),
});

// ============================================================================
// Extraction Schemas
// ============================================================================

/**
 * Content type enum schema
 */
export const contentTypeSchema = z.enum([
  'text',
  'url',
  'markdown',
  'html',
  'json',
  'pdf',
  'image',
  'unknown',
]);

/**
 * Chunking strategy enum schema
 */
export const chunkingStrategySchema = z.enum([
  'sentence',
  'paragraph',
  'fixed',
  'semantic',
  'sliding_window',
]);

/**
 * Document input schema
 */
export const documentInputSchema = z.object({
  content: nonEmptyString.describe('Document content'),
  containerTag: containerTagSchema.optional(),
  contentType: contentTypeSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  chunkingStrategy: chunkingStrategySchema.optional(),
});

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate input against a schema
 * @throws ValidationError if validation fails
 */
export function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw ValidationError.fromZodError(error);
    }
    throw error;
  }
}

/**
 * Validate input against a schema, returning result without throwing
 */
export function validateSafe<T>(
  schema: ZodSchema<T>,
  input: unknown
): { success: true; data: T } | { success: false; error: ValidationError } {
  try {
    const data = schema.parse(input);
    return { success: true, data };
  } catch (error) {
    if (error instanceof ZodError) {
      return { success: false, error: ValidationError.fromZodError(error) };
    }
    return {
      success: false,
      error: new ValidationError(
        error instanceof Error ? error.message : 'Unknown validation error'
      ),
    };
  }
}

/**
 * Validate and coerce input, applying defaults
 */
export function validateWithDefaults<T>(schema: ZodSchema<T>, input: unknown): T {
  return validate(schema, input);
}

/**
 * Create a validator function for a schema
 */
export function createValidator<T>(schema: ZodSchema<T>): (input: unknown) => T {
  return (input: unknown) => validate(schema, input);
}

/**
 * Assert that a value is defined (not null or undefined)
 */
export function assertDefined<T>(value: T | null | undefined, name: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new ValidationError(`${name} is required`, { [name]: ['Value is required'] });
  }
}

/**
 * Assert that a string is non-empty
 */
export function assertNonEmpty(
  value: string | null | undefined,
  name: string
): asserts value is string {
  assertDefined(value, name);
  if (value.trim().length === 0) {
    throw new ValidationError(`${name} cannot be empty`, { [name]: ['Value cannot be empty'] });
  }
}

// ============================================================================
// Custom Validators
// ============================================================================

/**
 * Validate memory content
 */
export function validateMemoryContent(content: string): void {
  if (!content || content.trim().length === 0) {
    throw new ValidationError('Memory content cannot be empty', {
      content: ['Content is required and cannot be empty'],
    });
  }
  if (content.length > 100000) {
    throw new ValidationError('Memory content exceeds maximum length', {
      content: ['Content must be less than 100,000 characters'],
    });
  }
}

/**
 * Validate search query
 */
export function validateSearchQuery(query: string): void {
  if (!query || query.trim().length === 0) {
    throw new ValidationError('Search query cannot be empty', {
      query: ['Query is required and cannot be empty'],
    });
  }
  if (query.length > 10000) {
    throw new ValidationError('Search query exceeds maximum length', {
      query: ['Query must be less than 10,000 characters'],
    });
  }
}

/**
 * Validate container tag
 */
export function validateContainerTag(containerTag: string | undefined): void {
  if (containerTag !== undefined) {
    validate(containerTagSchema, containerTag);
  }
}

// ============================================================================
// Security Schemas
// ============================================================================

/**
 * Content with size limit schema (50KB default).
 * Use this for user-provided content fields.
 */
export const boundedContentSchema = z
  .string()
  .min(1, 'Content cannot be empty')
  .max(MAX_CONTENT_SIZE, `Content must be at most ${MAX_CONTENT_SIZE} characters (50KB)`);

/**
 * Query with size limit schema (10KB).
 * Use this for search queries.
 */
export const boundedQuerySchema = z
  .string()
  .min(1, 'Query cannot be empty')
  .max(MAX_QUERY_LENGTH, `Query must be at most ${MAX_QUERY_LENGTH} characters`);

/**
 * Safe path schema that prevents path traversal attacks.
 * Rejects paths containing:
 * - Parent directory references (..)
 * - Absolute paths (starting with / or drive letters)
 * - URL-encoded traversal sequences
 * - Null bytes and control characters
 */
export const safePathSchema = z
  .string()
  .min(1, 'Path cannot be empty')
  .max(1024, 'Path must be at most 1024 characters')
  .refine(
    (path) => isPathSafe(path),
    'Path contains invalid characters or traversal sequences (e.g., "..", absolute paths)'
  );

/**
 * Safe URL schema with protocol whitelist.
 * Only allows http and https protocols.
 * Rejects javascript:, data:, and other potentially dangerous schemes.
 */
export const safeUrlSchema = z
  .string()
  .url('Invalid URL format')
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return ALLOWED_URL_PROTOCOLS.includes(parsed.protocol);
      } catch {
        return false;
      }
    },
    { message: 'URL must use http or https protocol' }
  )
  .transform((url) => sanitizeUrl(url));

/**
 * Optional safe URL schema.
 */
export const optionalSafeUrlSchema = safeUrlSchema.optional();

/**
 * Sanitized string schema that auto-strips XSS vectors.
 * Content is sanitized during parsing, removing dangerous HTML/JavaScript.
 */
export const sanitizedStringSchema = z
  .string()
  .transform((val) => sanitizeHtml(val));

/**
 * Strictly sanitized string schema for storage.
 * Removes all HTML, preserving only plain text.
 */
export const sanitizedStorageStringSchema = z
  .string()
  .transform((val) => sanitizeForStorage(val));

/**
 * Metadata schema with size limit (10KB JSON).
 * Ensures metadata doesn't exceed reasonable size.
 */
export const boundedMetadataSchema = z
  .record(z.unknown())
  .optional()
  .refine(
    (metadata) => {
      if (!metadata) return true;
      try {
        const jsonSize = new TextEncoder().encode(JSON.stringify(metadata)).length;
        return jsonSize <= MAX_METADATA_SIZE;
      } catch {
        return false;
      }
    },
    { message: `Metadata must be at most ${MAX_METADATA_SIZE} bytes (10KB)` }
  );

/**
 * ID schema - alphanumeric with hyphens, underscores, max 255 chars.
 */
export const safeIdSchema = z
  .string()
  .min(1, 'ID cannot be empty')
  .max(255, 'ID must be at most 255 characters')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'ID can only contain alphanumeric characters, underscores, and hyphens'
  );

/**
 * Email schema with sanitization.
 */
export const safeEmailSchema = z
  .string()
  .email('Invalid email format')
  .max(255, 'Email must be at most 255 characters')
  .transform((email) => email.toLowerCase().trim());

// ============================================================================
// Composite Security Schemas
// ============================================================================

/**
 * Secure memory content input schema with all security validations.
 */
export const secureMemoryInputSchema = z.object({
  content: boundedContentSchema.describe('Memory content (max 50KB)'),
  type: memoryTypeSchema.optional().describe('Memory type'),
  containerTag: containerTagSchema.optional().describe('Container tag (max 100 chars)'),
  metadata: boundedMetadataSchema.describe('Additional metadata (max 10KB)'),
});

/**
 * Secure search query schema with input validation.
 */
export const secureSearchQuerySchema = z.object({
  query: boundedQuerySchema.describe('Search query (max 10KB)'),
  containerTag: containerTagSchema.optional(),
  limit: positiveInt.max(100).optional().default(10),
  threshold: confidenceScore.optional().default(0.7),
});

/**
 * Secure document input schema for API submissions.
 */
export const secureDocumentInputSchema = z.object({
  content: boundedContentSchema.describe('Document content (max 50KB)'),
  containerTag: containerTagSchema.optional().describe('Container tag'),
  contentType: contentTypeSchema.optional().describe('Content type'),
  sourceUrl: optionalSafeUrlSchema.describe('Source URL (http/https only)'),
  title: z.string().max(500, 'Title must be at most 500 characters').optional(),
  metadata: boundedMetadataSchema.describe('Metadata (max 10KB)'),
});

// ============================================================================
// Validation Helpers for Security
// ============================================================================

/**
 * Validates that content does not exceed maximum size.
 * @throws ValidationError if content is too large
 */
export function validateContentSize(content: string, maxSize = MAX_CONTENT_SIZE): void {
  const size = new TextEncoder().encode(content).length;
  if (size > maxSize) {
    throw new ValidationError(
      `Content size ${size} bytes exceeds maximum of ${maxSize} bytes`,
      { content: [`Content must be at most ${maxSize} bytes`] }
    );
  }
}

/**
 * Validates that a path is safe (no traversal attacks).
 * @throws ValidationError if path is unsafe
 */
export function validatePath(path: string): void {
  if (!isPathSafe(path)) {
    throw new ValidationError(
      'Path contains invalid characters or traversal sequences',
      { path: ['Path cannot contain "..", absolute paths, or control characters'] }
    );
  }
}

/**
 * Validates that a URL uses allowed protocols.
 * @throws ValidationError if URL is unsafe
 */
export function validateUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
      throw new ValidationError(
        `URL protocol "${parsed.protocol}" is not allowed`,
        { url: ['URL must use http or https protocol'] }
      );
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Invalid URL format', { url: ['Must be a valid URL'] });
  }
}

/**
 * Validates metadata size doesn't exceed limit.
 * @throws ValidationError if metadata is too large
 */
export function validateMetadataSize(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return;

  try {
    const size = new TextEncoder().encode(JSON.stringify(metadata)).length;
    if (size > MAX_METADATA_SIZE) {
      throw new ValidationError(
        `Metadata size ${size} bytes exceeds maximum of ${MAX_METADATA_SIZE} bytes`,
        { metadata: [`Metadata must be at most ${MAX_METADATA_SIZE} bytes (10KB)`] }
      );
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Invalid metadata format', { metadata: ['Metadata must be valid JSON'] });
  }
}
