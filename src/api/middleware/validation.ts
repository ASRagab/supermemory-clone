/**
 * Validation Middleware for Supermemory Clone API
 *
 * Provides request validation middleware including:
 * - Zod schema validation for request bodies
 * - Content size limits (50KB default)
 * - Path traversal protection
 * - XSS content sanitization
 */

import { Context, MiddlewareHandler, Next } from 'hono';
import { ZodSchema, ZodError } from 'zod';
import { ErrorCodes, ErrorResponse } from '../../types/api.types.js';
import { sanitizeHtml, sanitizeForStorage, isPathSafe } from '../../utils/sanitization.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default maximum content size in bytes (50KB).
 * Can be overridden via SUPERMEMORY_MAX_CONTENT_SIZE environment variable.
 */
export const MAX_CONTENT_SIZE =
  parseInt(process.env.SUPERMEMORY_MAX_CONTENT_SIZE || '', 10) || 50 * 1024;

/**
 * Maximum JSON body size for metadata (10KB).
 */
export const MAX_METADATA_SIZE = 10 * 1024;

/**
 * Maximum query string length (10KB).
 */
export const MAX_QUERY_LENGTH = 10 * 1024;

/**
 * Maximum container tag length.
 */
export const MAX_CONTAINER_TAG_LENGTH = 100;

// ============================================================================
// Error Helpers
// ============================================================================

/**
 * Creates a standardized validation error response.
 */
function createValidationErrorResponse(message: string, details?: Record<string, unknown>): {
  response: ErrorResponse;
  status: 400;
} {
  return {
    response: {
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message,
        ...(details && { details }),
      },
      status: 400,
    },
    status: 400,
  };
}

/**
 * Creates a security error response for path traversal or similar attacks.
 */
function createSecurityErrorResponse(message: string): { response: ErrorResponse; status: 400 } {
  return {
    response: {
      error: {
        code: ErrorCodes.BAD_REQUEST,
        message: `Security violation: ${message}`,
      },
      status: 400,
    },
    status: 400,
  };
}

// ============================================================================
// Content Size Middleware
// ============================================================================

/**
 * Options for content size limit middleware.
 */
interface ContentSizeLimitOptions {
  /** Maximum content size in bytes */
  maxSize?: number;
  /** Whether to include the limit in error messages */
  includeLimit?: boolean;
}

/**
 * Middleware that enforces content size limits on request bodies.
 *
 * Prevents denial-of-service attacks via extremely large payloads.
 * Returns 400 Bad Request if the content exceeds the limit.
 *
 * @param options - Configuration options
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.post('/documents', contentSizeLimit({ maxSize: 100 * 1024 }), async (c) => {
 *   // Handler only runs if content <= 100KB
 * });
 * ```
 */
export function contentSizeLimit(options: ContentSizeLimitOptions = {}): MiddlewareHandler {
  const maxSize = options.maxSize ?? MAX_CONTENT_SIZE;
  const includeLimit = options.includeLimit ?? true;

  return async (c: Context, next: Next) => {
    const contentLength = c.req.header('content-length');

    if (contentLength) {
      const size = parseInt(contentLength, 10);

      if (!isNaN(size) && size > maxSize) {
        const { response, status } = createValidationErrorResponse(
          includeLimit
            ? `Content size ${formatBytes(size)} exceeds maximum allowed size of ${formatBytes(maxSize)}`
            : 'Content size exceeds maximum allowed size'
        );
        return c.json(response, status);
      }
    }

    return next();
  };
}

/**
 * Default content size limit middleware (50KB).
 */
export const defaultContentSizeLimit = contentSizeLimit();

/**
 * Large content size limit middleware (1MB) for file uploads.
 */
export const largeContentSizeLimit = contentSizeLimit({ maxSize: 1024 * 1024 });

// ============================================================================
// Schema Validation Middleware
// ============================================================================

/**
 * Options for schema validation middleware.
 */
interface ValidateSchemaOptions {
  /** Whether to sanitize string values in the body */
  sanitize?: boolean;
  /** Whether to strip HTML from string values */
  stripHtml?: boolean;
  /** Fields that should preserve HTML (not be sanitized) */
  preserveHtmlFields?: string[];
}

/**
 * Middleware that validates request body against a Zod schema.
 *
 * Parses and validates the JSON body, attaching the validated data
 * to the context for use in handlers.
 *
 * @param schema - Zod schema to validate against
 * @param options - Validation options
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * const CreateUserSchema = z.object({
 *   name: z.string().min(1),
 *   email: z.string().email()
 * });
 *
 * app.post('/users', validateSchema(CreateUserSchema), async (c) => {
 *   const body = c.get('validatedBody');
 *   // body is typed and validated
 * });
 * ```
 */
export function validateSchema<T>(
  schema: ZodSchema<T>,
  options: ValidateSchemaOptions = {}
): MiddlewareHandler {
  const { sanitize = true, stripHtml: shouldStripHtml = false, preserveHtmlFields = [] } = options;

  return async (c: Context, next: Next) => {
    try {
      let body = await c.req.json();

      // Apply sanitization if enabled
      if (sanitize && typeof body === 'object' && body !== null) {
        body = sanitizeRequestBody(body, {
          stripHtml: shouldStripHtml,
          preserveFields: preserveHtmlFields,
        });
      }

      // Validate against schema
      const validated = schema.parse(body);

      // Store validated body for handler access
      c.set('validatedBody', validated);

      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = formatZodErrors(error);
        const { response, status } = createValidationErrorResponse(
          `Validation failed: ${formattedErrors}`,
          { fieldErrors: extractFieldErrors(error) }
        );
        return c.json(response, status);
      }

      if (error instanceof SyntaxError) {
        const { response, status } = createValidationErrorResponse('Invalid JSON in request body');
        return c.json(response, status);
      }

      throw error;
    }
  };
}

// ============================================================================
// Path Validation Middleware
// ============================================================================

/**
 * Middleware that validates path parameters for path traversal attacks.
 *
 * Checks all path parameters and rejects requests containing:
 * - Parent directory references (..)
 * - Absolute paths
 * - URL-encoded traversal sequences
 *
 * @param paramNames - Optional list of specific parameter names to validate
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.get('/files/:path', validatePathParams(), async (c) => {
 *   const path = c.req.param('path');
 *   // path is guaranteed to be safe
 * });
 * ```
 */
export function validatePathParams(paramNames?: string[]): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const params = c.req.param();

    const paramsToCheck = paramNames || Object.keys(params);

    for (const name of paramsToCheck) {
      const value = params[name];

      if (value && !isPathSafe(value)) {
        const { response, status } = createSecurityErrorResponse(
          'Path contains invalid characters or traversal sequences'
        );
        return c.json(response, status);
      }
    }

    return next();
  };
}

/**
 * Middleware that validates query parameters for dangerous content.
 *
 * Checks query string length and validates specific parameters.
 *
 * @returns Hono middleware handler
 */
export function validateQueryParams(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const url = new URL(c.req.url);
    const queryString = url.search;

    // Check total query string length
    if (queryString.length > MAX_QUERY_LENGTH) {
      const { response, status } = createValidationErrorResponse(
        `Query string exceeds maximum length of ${MAX_QUERY_LENGTH} characters`
      );
      return c.json(response, status);
    }

    return next();
  };
}

// ============================================================================
// Content Sanitization Middleware
// ============================================================================

/**
 * Options for content sanitization.
 */
interface SanitizeOptions {
  /** Whether to strip all HTML tags */
  stripHtml: boolean;
  /** Fields to preserve (not sanitize) */
  preserveFields: string[];
}

/**
 * Sanitizes a request body object, removing XSS vectors from string values.
 *
 * @param body - Request body to sanitize
 * @param options - Sanitization options
 * @returns Sanitized body
 */
function sanitizeRequestBody(
  body: Record<string, unknown>,
  options: SanitizeOptions
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (options.preserveFields.includes(key)) {
      result[key] = value;
    } else if (typeof value === 'string') {
      result[key] = options.stripHtml ? sanitizeForStorage(value) : sanitizeHtml(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? sanitizeRequestBody(item as Record<string, unknown>, options)
          : typeof item === 'string'
            ? options.stripHtml
              ? sanitizeForStorage(item)
              : sanitizeHtml(item)
            : item
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeRequestBody(value as Record<string, unknown>, options);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Middleware that sanitizes request body content for XSS.
 *
 * Applies HTML sanitization to all string values in the request body.
 * Does not reject content, just cleans it.
 *
 * @param options - Sanitization options
 * @returns Hono middleware handler
 */
export function sanitizeContent(options: Partial<SanitizeOptions> = {}): MiddlewareHandler {
  const sanitizeOptions: SanitizeOptions = {
    stripHtml: options.stripHtml ?? false,
    preserveFields: options.preserveFields ?? [],
  };

  return async (c: Context, next: Next) => {
    // Only process JSON bodies
    const contentType = c.req.header('content-type');
    if (!contentType?.includes('application/json')) {
      return next();
    }

    try {
      const body = await c.req.json();

      if (typeof body === 'object' && body !== null) {
        const sanitized = sanitizeRequestBody(body, sanitizeOptions);
        c.set('sanitizedBody', sanitized);
      }

      return next();
    } catch {
      // If JSON parsing fails, let the next middleware handle it
      return next();
    }
  };
}

// ============================================================================
// Combined Validation Middleware
// ============================================================================

/**
 * Options for combined request validation.
 */
interface RequestValidationOptions<T> {
  /** Zod schema for body validation */
  schema: ZodSchema<T>;
  /** Maximum content size in bytes */
  maxSize?: number;
  /** Whether to sanitize string values */
  sanitize?: boolean;
  /** Whether to strip HTML from strings */
  stripHtml?: boolean;
  /** Fields to preserve HTML in */
  preserveHtmlFields?: string[];
}

/**
 * Combined middleware that applies size limit, sanitization, and schema validation.
 *
 * This is the recommended middleware for most endpoints.
 *
 * @param options - Validation configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.post('/documents',
 *   validateRequest({
 *     schema: CreateDocumentSchema,
 *     maxSize: 50 * 1024,
 *     sanitize: true
 *   }),
 *   async (c) => {
 *     const body = c.get('validatedBody');
 *   }
 * );
 * ```
 */
export function validateRequest<T>(options: RequestValidationOptions<T>): MiddlewareHandler {
  const sizeLimitMiddleware = contentSizeLimit({ maxSize: options.maxSize });
  const schemaMiddleware = validateSchema(options.schema, {
    sanitize: options.sanitize,
    stripHtml: options.stripHtml,
    preserveHtmlFields: options.preserveHtmlFields,
  });

  return async (c: Context, next: Next) => {
    // Apply size limit
    const sizeResult = await sizeLimitMiddleware(c, async () => {});
    if (sizeResult) return sizeResult;

    // Apply schema validation
    return schemaMiddleware(c, next);
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Formats Zod validation errors into a human-readable string.
 */
function formatZodErrors(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * Extracts field-level errors from a ZodError.
 */
function extractFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!fieldErrors[path]) {
      fieldErrors[path] = [];
    }
    fieldErrors[path].push(issue.message);
  }

  return fieldErrors;
}

/**
 * Formats bytes into a human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Context Type Extensions
// ============================================================================

// Extend Hono's context type to include validated body
declare module 'hono' {
  interface ContextVariableMap {
    validatedBody: unknown;
    sanitizedBody: Record<string, unknown>;
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  contentSizeLimit,
  defaultContentSizeLimit,
  largeContentSizeLimit,
  validateSchema,
  validatePathParams,
  validateQueryParams,
  sanitizeContent,
  validateRequest,
  MAX_CONTENT_SIZE,
  MAX_METADATA_SIZE,
  MAX_QUERY_LENGTH,
  MAX_CONTAINER_TAG_LENGTH,
};
