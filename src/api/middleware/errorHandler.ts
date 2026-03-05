import { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { ErrorCodes, ErrorResponse } from '../../types/api.types.js'

/**
 * Custom API error class for consistent error handling.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiError'
  }

  toResponse(): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
      status: this.statusCode,
    } as ErrorResponse
  }
}

/**
 * Formats Zod validation errors into a readable format.
 */
function formatZodErrors(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  return issues.join('; ')
}

/**
 * Global error handler middleware.
 * Catches all errors and returns consistent error responses.
 */
export const errorHandlerMiddleware: MiddlewareHandler = async (c: Context, next) => {
  try {
    return await next()
  } catch (error) {
    console.error('Error caught in error handler:', error)

    // Handle custom API errors
    if (error instanceof ApiError) {
      const statusCode = error.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500
      return c.json(error.toResponse(), statusCode)
    }

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      const response: ErrorResponse = {
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: formatZodErrors(error),
        },
        status: 400,
      }
      return c.json(response, 400)
    }

    // Handle Hono HTTP exceptions
    if (error instanceof HTTPException) {
      const response: ErrorResponse = {
        error: {
          code: mapHttpStatusToCode(error.status),
          message: error.message || getDefaultMessage(error.status),
        },
        status: error.status,
      }
      return c.json(response, error.status)
    }

    // Handle generic errors
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    const response: ErrorResponse = {
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : message,
      },
      status: 500,
    }
    return c.json(response, 500)
  }
}

/**
 * Maps HTTP status codes to error codes.
 */
function mapHttpStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return ErrorCodes.BAD_REQUEST
    case 401:
      return ErrorCodes.UNAUTHORIZED
    case 403:
      return ErrorCodes.FORBIDDEN
    case 404:
      return ErrorCodes.NOT_FOUND
    case 409:
      return ErrorCodes.CONFLICT
    case 429:
      return ErrorCodes.RATE_LIMITED
    default:
      return ErrorCodes.INTERNAL_ERROR
  }
}

/**
 * Gets default error message for HTTP status codes.
 */
function getDefaultMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Bad request'
    case 401:
      return 'Unauthorized'
    case 403:
      return 'Forbidden'
    case 404:
      return 'Resource not found'
    case 409:
      return 'Resource conflict'
    case 429:
      return 'Too many requests'
    default:
      return 'Internal server error'
  }
}

/**
 * Helper function to throw not found errors.
 */
export function notFound(resource: string, id: string): never {
  throw new ApiError(ErrorCodes.NOT_FOUND, `${resource} with id '${id}' not found`, 404)
}

/**
 * Helper function to throw validation errors.
 */
export function validationError(message: string): never {
  throw new ApiError(ErrorCodes.VALIDATION_ERROR, message, 400)
}

/**
 * Helper function to throw conflict errors.
 */
export function conflict(message: string): never {
  throw new ApiError(ErrorCodes.CONFLICT, message, 409)
}

/**
 * Helper function to throw forbidden errors.
 */
export function forbidden(message: string): never {
  throw new ApiError(ErrorCodes.FORBIDDEN, message, 403)
}
