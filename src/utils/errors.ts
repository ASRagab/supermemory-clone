/**
 * Error Hierarchy for Supermemory Clone
 *
 * Provides a consistent error taxonomy and handling patterns.
 * All service-level errors should extend AppError.
 */

import { ZodError, ZodIssue } from 'zod';

/**
 * Error codes for categorization and handling
 */
export const ErrorCode = {
  // Validation errors (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',

  // Authentication/Authorization errors (401, 403)
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  INVALID_API_KEY: 'INVALID_API_KEY',
  EXPIRED_TOKEN: 'EXPIRED_TOKEN',

  // Not found errors (404)
  NOT_FOUND: 'NOT_FOUND',
  MEMORY_NOT_FOUND: 'MEMORY_NOT_FOUND',
  PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',

  // Conflict errors (409)
  CONFLICT: 'CONFLICT',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  VERSION_CONFLICT: 'VERSION_CONFLICT',

  // Rate limit errors (429)
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // Server errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EMBEDDING_ERROR: 'EMBEDDING_ERROR',
  EXTRACTION_ERROR: 'EXTRACTION_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  CRYPTO_ERROR: 'CRYPTO_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
  DATABASE_NOT_INITIALIZED: 'DATABASE_NOT_INITIALIZED',
  VECTOR_DIMENSION_MISMATCH: 'VECTOR_DIMENSION_MISMATCH',
  EMPTY_TEXT: 'EMPTY_TEXT',

  // Service unavailable (503)
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * HTTP status codes mapped to error types
 */
export const ErrorStatusCode: Record<string, number> = {
  VALIDATION_ERROR: 400,
  INVALID_INPUT: 400,
  MISSING_REQUIRED_FIELD: 400,
  INVALID_FORMAT: 400,
  AUTHENTICATION_ERROR: 401,
  INVALID_API_KEY: 401,
  EXPIRED_TOKEN: 401,
  AUTHORIZATION_ERROR: 403,
  NOT_FOUND: 404,
  MEMORY_NOT_FOUND: 404,
  PROFILE_NOT_FOUND: 404,
  DOCUMENT_NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_ENTRY: 409,
  VERSION_CONFLICT: 409,
  RATE_LIMIT_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
  DATABASE_ERROR: 500,
  EMBEDDING_ERROR: 500,
  EXTRACTION_ERROR: 500,
  EXTERNAL_SERVICE_ERROR: 502,
  CRYPTO_ERROR: 500,
  CONFIGURATION_ERROR: 500,
  DEPENDENCY_ERROR: 500,
  DATABASE_NOT_INITIALIZED: 500,
  VECTOR_DIMENSION_MISMATCH: 400,
  EMPTY_TEXT: 400,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * Base application error class
 * All custom errors should extend this class
 */
export class AppError extends Error {
  readonly code: ErrorCodeType;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly isOperational: boolean;
  readonly timestamp: Date;

  constructor(
    message: string,
    code: ErrorCodeType = ErrorCode.INTERNAL_ERROR,
    details?: unknown,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ErrorStatusCode[code] ?? 500;
    this.details = details;
    this.isOperational = isOperational;
    this.timestamp = new Date();

    // Maintains proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON representation
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
    };
  }

  /**
   * Create error from unknown value
   */
  static from(err: unknown, defaultCode?: ErrorCodeType): AppError {
    if (err instanceof AppError) {
      return err;
    }

    if (err instanceof ZodError) {
      return ValidationError.fromZodError(err);
    }

    if (err instanceof Error) {
      return new AppError(
        err.message,
        defaultCode ?? ErrorCode.INTERNAL_ERROR,
        { originalError: err.name },
        true
      );
    }

    return new AppError(String(err), defaultCode ?? ErrorCode.INTERNAL_ERROR, undefined, true);
  }
}

// ============================================================================
// Specific Error Types
// ============================================================================

/**
 * Validation error for invalid input data
 */
export class ValidationError extends AppError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(message: string, fieldErrors: Record<string, string[]> = {}, details?: unknown) {
    super(message, ErrorCode.VALIDATION_ERROR, details);
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }

  /**
   * Create from Zod validation error
   */
  static fromZodError(error: ZodError): ValidationError {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of error.issues) {
      const path = issue.path.join('.');
      const key = path || '_root';
      if (!fieldErrors[key]) {
        fieldErrors[key] = [];
      }
      fieldErrors[key].push(issue.message);
    }

    const message = error.issues
      .map((issue: ZodIssue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');

    return new ValidationError(`Validation failed: ${message}`, fieldErrors, {
      zodErrors: error.issues,
    });
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      fieldErrors: this.fieldErrors,
    };
  }
}

/**
 * Not found error for missing resources
 */
export class NotFoundError extends AppError {
  readonly resourceType: string;
  readonly resourceId?: string;

  constructor(
    resourceType: string,
    resourceId?: string,
    code: ErrorCodeType = ErrorCode.NOT_FOUND
  ) {
    const message = resourceId
      ? `${resourceType} with ID '${resourceId}' not found`
      : `${resourceType} not found`;
    super(message, code);
    this.name = 'NotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      resourceType: this.resourceType,
      resourceId: this.resourceId,
    };
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends AppError {
  constructor(
    message: string = 'Authentication required',
    code: ErrorCodeType = ErrorCode.AUTHENTICATION_ERROR
  ) {
    super(message, code);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error
 */
export class AuthorizationError extends AppError {
  readonly requiredPermission?: string;

  constructor(message: string = 'Permission denied', requiredPermission?: string) {
    super(message, ErrorCode.AUTHORIZATION_ERROR);
    this.name = 'AuthorizationError';
    this.requiredPermission = requiredPermission;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      requiredPermission: this.requiredPermission,
    };
  }
}

/**
 * Conflict error for duplicate entries or version conflicts
 */
export class ConflictError extends AppError {
  readonly conflictType: 'duplicate' | 'version' | 'other';

  constructor(
    message: string,
    conflictType: 'duplicate' | 'version' | 'other' = 'other',
    details?: unknown
  ) {
    const code =
      conflictType === 'duplicate'
        ? ErrorCode.DUPLICATE_ENTRY
        : conflictType === 'version'
          ? ErrorCode.VERSION_CONFLICT
          : ErrorCode.CONFLICT;
    super(message, code, details);
    this.name = 'ConflictError';
    this.conflictType = conflictType;
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends AppError {
  readonly retryAfterMs?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfterMs?: number) {
    super(message, ErrorCode.RATE_LIMIT_EXCEEDED);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      retryAfterMs: this.retryAfterMs,
    };
  }
}

/**
 * Database error
 */
export class DatabaseError extends AppError {
  readonly operation?: string;

  constructor(message: string, operation?: string, details?: unknown) {
    super(message, ErrorCode.DATABASE_ERROR, details);
    this.name = 'DatabaseError';
    this.operation = operation;
  }
}

/**
 * Embedding service error
 */
export class EmbeddingError extends AppError {
  readonly provider?: string;

  constructor(message: string, provider?: string, details?: unknown) {
    super(message, ErrorCode.EMBEDDING_ERROR, details);
    this.name = 'EmbeddingError';
    this.provider = provider;
  }
}

/**
 * Extraction error
 */
export class ExtractionError extends AppError {
  readonly contentType?: string;

  constructor(message: string, contentType?: string, details?: unknown) {
    super(message, ErrorCode.EXTRACTION_ERROR, details);
    this.name = 'ExtractionError';
    this.contentType = contentType;
  }
}

/**
 * External service error
 */
export class ExternalServiceError extends AppError {
  readonly serviceName: string;
  readonly serviceStatus?: number;

  constructor(serviceName: string, message: string, serviceStatus?: number, details?: unknown) {
    super(message, ErrorCode.EXTERNAL_SERVICE_ERROR, details);
    this.name = 'ExternalServiceError';
    this.serviceName = serviceName;
    this.serviceStatus = serviceStatus;
  }
}

/**
 * Crypto/encryption error
 */
export class CryptoError extends AppError {
  readonly operation?: string;

  constructor(message: string, operation?: string, details?: unknown) {
    super(message, ErrorCode.CRYPTO_ERROR, details);
    this.name = 'CryptoError';
    this.operation = operation;
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends AppError {
  readonly configKey?: string;

  constructor(message: string, configKey?: string, details?: unknown) {
    super(message, ErrorCode.CONFIGURATION_ERROR, details);
    this.name = 'ConfigurationError';
    this.configKey = configKey;
  }
}

/**
 * Dependency error for missing required dependencies
 */
export class DependencyError extends AppError {
  readonly dependency: string;
  readonly installCommand?: string;

  constructor(dependency: string, installCommand?: string, details?: unknown) {
    const message = installCommand
      ? `Missing dependency '${dependency}'. Run: ${installCommand}`
      : `Missing dependency '${dependency}'`;
    super(message, ErrorCode.DEPENDENCY_ERROR, details);
    this.name = 'DependencyError';
    this.dependency = dependency;
    this.installCommand = installCommand;
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Check if error is a validation error
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Check if error is a not found error
 */
export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof RateLimitError) {
    return true;
  }
  if (error instanceof ExternalServiceError) {
    return true;
  }
  if (error instanceof AppError) {
    return error.code === ErrorCode.SERVICE_UNAVAILABLE;
  }
  return false;
}

/**
 * Check if error is operational (expected) vs programming error
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}
