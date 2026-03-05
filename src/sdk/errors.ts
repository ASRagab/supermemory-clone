/**
 * Supermemory SDK Error Classes
 * Drop-in replacement for the official supermemory npm package
 */

/**
 * Base error class for all Supermemory errors
 */
export class SupermemoryError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = 'SupermemoryError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Base class for API-related errors
 */
export class APIError<
  TStatus extends number | undefined = number | undefined,
  THeaders extends Headers | undefined = Headers | undefined,
  TError = unknown,
> extends SupermemoryError {
  readonly status: TStatus
  readonly headers: THeaders
  readonly error: TError
  readonly request_id?: string

  constructor(status: TStatus, error: TError, message: string | undefined, headers: THeaders) {
    super(message || APIError.makeMessage(status, error))
    this.status = status
    this.headers = headers
    this.error = error
    this.name = 'APIError'

    // Extract request ID from headers if available
    if (headers && typeof headers.get === 'function') {
      this.request_id = headers.get('x-request-id') || undefined
    }
  }

  private static makeMessage(status: number | undefined, error: unknown): string {
    if (typeof error === 'string') {
      return error
    }

    if (error && typeof error === 'object') {
      const errorObj = error as Record<string, unknown>
      if (typeof errorObj.message === 'string') {
        return errorObj.message
      }
      if (typeof errorObj.error === 'string') {
        return errorObj.error
      }
    }

    return status ? `Request failed with status ${status}` : 'Request failed'
  }

  /**
   * Generate an appropriate error class instance based on status code
   */
  static generate(
    status: number | undefined,
    error: unknown,
    message: string | undefined,
    headers: Headers | undefined
  ): APIError {
    if (!status) {
      return new APIConnectionError({ message })
    }

    switch (status) {
      case 400:
        return new BadRequestError(status, error, message, headers)
      case 401:
        return new AuthenticationError(status, error, message, headers)
      case 403:
        return new PermissionDeniedError(status, error, message, headers)
      case 404:
        return new NotFoundError(status, error, message, headers)
      case 409:
        return new ConflictError(status, error, message, headers)
      case 422:
        return new UnprocessableEntityError(status, error, message, headers)
      case 429:
        return new RateLimitError(status, error, message, headers)
      default:
        if (status >= 500) {
          return new InternalServerError(status, error, message, headers)
        }
        return new APIError(status, error, message, headers)
    }
  }
}

/**
 * Error thrown when the user aborts a request
 */
export class APIUserAbortError extends APIError<undefined, undefined, undefined> {
  constructor(message?: string) {
    super(undefined, undefined, message || 'Request was aborted', undefined)
    this.name = 'APIUserAbortError'
  }
}

/**
 * Error thrown when a connection to the API cannot be established
 */
export class APIConnectionError extends APIError<undefined, undefined, undefined> {
  override readonly cause?: Error

  constructor({ message, cause }: { message?: string; cause?: Error } = {}) {
    super(undefined, undefined, message || 'Connection error', undefined)
    this.name = 'APIConnectionError'
    this.cause = cause
  }
}

/**
 * Error thrown when a request times out
 */
export class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message }: { message?: string } = {}) {
    super({ message: message || 'Request timed out' })
    this.name = 'APIConnectionTimeoutError'
  }
}

/**
 * Error thrown for 400 Bad Request responses
 */
export class BadRequestError extends APIError<400, Headers | undefined> {
  constructor(status: 400, error: unknown, message: string | undefined, headers: Headers | undefined) {
    super(status, error, message, headers)
    this.name = 'BadRequestError'
  }
}

/**
 * Error thrown for 401 Unauthorized responses
 */
export class AuthenticationError extends APIError<401, Headers | undefined> {
  constructor(status: 401, error: unknown, message: string | undefined, headers: Headers | undefined) {
    super(status, error, message, headers)
    this.name = 'AuthenticationError'
  }
}

/**
 * Error thrown for 403 Forbidden responses
 */
export class PermissionDeniedError extends APIError<403, Headers | undefined> {
  constructor(status: 403, error: unknown, message: string | undefined, headers: Headers | undefined) {
    super(status, error, message, headers)
    this.name = 'PermissionDeniedError'
  }
}

/**
 * Error thrown for 404 Not Found responses
 */
export class NotFoundError extends APIError<404, Headers | undefined> {
  constructor(status: 404, error: unknown, message: string | undefined, headers: Headers | undefined) {
    super(status, error, message, headers)
    this.name = 'NotFoundError'
  }
}

/**
 * Error thrown for 409 Conflict responses
 */
export class ConflictError extends APIError<409, Headers | undefined> {
  constructor(status: 409, error: unknown, message: string | undefined, headers: Headers | undefined) {
    super(status, error, message, headers)
    this.name = 'ConflictError'
  }
}

/**
 * Error thrown for 422 Unprocessable Entity responses
 */
export class UnprocessableEntityError extends APIError<422, Headers | undefined> {
  constructor(status: 422, error: unknown, message: string | undefined, headers: Headers | undefined) {
    super(status, error, message, headers)
    this.name = 'UnprocessableEntityError'
  }
}

/**
 * Error thrown for 429 Rate Limit responses
 */
export class RateLimitError extends APIError<429, Headers | undefined> {
  readonly retryAfter?: number

  constructor(status: 429, error: unknown, message: string | undefined, headers: Headers | undefined) {
    super(status, error, message, headers)
    this.name = 'RateLimitError'

    // Extract retry-after header if available
    if (headers && typeof headers.get === 'function') {
      const retryAfter = headers.get('retry-after')
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10)
        if (!Number.isNaN(parsed)) {
          this.retryAfter = parsed
        }
      }
    }
  }
}

/**
 * Error thrown for 5xx Internal Server Error responses
 */
export class InternalServerError extends APIError<number, Headers | undefined> {
  constructor(status: number, error: unknown, message: string | undefined, headers: Headers | undefined) {
    super(status, error, message, headers)
    this.name = 'InternalServerError'
  }
}

/**
 * Type guard to check if an error is a Supermemory API error
 */
export function isAPIError(error: unknown): error is APIError {
  return error instanceof APIError
}

/**
 * Type guard to check if an error is a rate limit error
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError
}

/**
 * Type guard to check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof APIConnectionError) {
    return true
  }
  if (error instanceof RateLimitError) {
    return true
  }
  if (error instanceof InternalServerError) {
    return true
  }
  // Also retry on generic network errors (e.g., fetch failures)
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('timeout') ||
      message.includes('connection')
    ) {
      return true
    }
  }
  return false
}
