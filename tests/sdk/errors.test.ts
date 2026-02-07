/**
 * SDK Error Classes Tests
 *
 * Tests for all error classes and type guards.
 */

import { describe, it, expect } from 'vitest';
import {
  SupermemoryError,
  APIError,
  APIUserAbortError,
  APIConnectionError,
  APIConnectionTimeoutError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
  InternalServerError,
  isAPIError,
  isRateLimitError,
  isRetryableError,
} from '../../src/sdk/errors.js';

describe('SupermemoryError', () => {
  it('should create error with message', () => {
    const error = new SupermemoryError('Test error');

    expect(error.message).toBe('Test error');
    expect(error.name).toBe('SupermemoryError');
  });

  it('should be an instance of Error', () => {
    const error = new SupermemoryError('Test');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SupermemoryError);
  });
});

describe('APIError', () => {
  it('should create error with status, error body, and headers', () => {
    const headers = new Headers({ 'x-request-id': 'req-123' });
    const error = new APIError(400, { message: 'Bad request' }, 'Validation failed', headers);

    expect(error.status).toBe(400);
    expect(error.error).toEqual({ message: 'Bad request' });
    expect(error.message).toBe('Validation failed');
    expect(error.request_id).toBe('req-123');
  });

  it('should extract message from error object', () => {
    const error = new APIError(400, { message: 'Error from body' }, undefined, undefined);

    expect(error.message).toBe('Error from body');
  });

  it('should extract message from error.error property', () => {
    const error = new APIError(400, { error: 'Error string' }, undefined, undefined);

    expect(error.message).toBe('Error string');
  });

  it('should use status code in default message', () => {
    const error = new APIError(500, {}, undefined, undefined);

    expect(error.message).toBe('Request failed with status 500');
  });

  it('should use fallback message when no status', () => {
    const error = new APIError(undefined, undefined, undefined, undefined);

    expect(error.message).toBe('Request failed');
  });

  describe('generate()', () => {
    it('should return BadRequestError for 400', () => {
      const error = APIError.generate(400, {}, 'Bad request', undefined);

      expect(error).toBeInstanceOf(BadRequestError);
      expect(error.status).toBe(400);
    });

    it('should return AuthenticationError for 401', () => {
      const error = APIError.generate(401, {}, 'Unauthorized', undefined);

      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.status).toBe(401);
    });

    it('should return PermissionDeniedError for 403', () => {
      const error = APIError.generate(403, {}, 'Forbidden', undefined);

      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect(error.status).toBe(403);
    });

    it('should return NotFoundError for 404', () => {
      const error = APIError.generate(404, {}, 'Not found', undefined);

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.status).toBe(404);
    });

    it('should return ConflictError for 409', () => {
      const error = APIError.generate(409, {}, 'Conflict', undefined);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.status).toBe(409);
    });

    it('should return UnprocessableEntityError for 422', () => {
      const error = APIError.generate(422, {}, 'Unprocessable', undefined);

      expect(error).toBeInstanceOf(UnprocessableEntityError);
      expect(error.status).toBe(422);
    });

    it('should return RateLimitError for 429', () => {
      const error = APIError.generate(429, {}, 'Rate limited', undefined);

      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.status).toBe(429);
    });

    it('should return InternalServerError for 500', () => {
      const error = APIError.generate(500, {}, 'Server error', undefined);

      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.status).toBe(500);
    });

    it('should return InternalServerError for other 5xx codes', () => {
      const error = APIError.generate(503, {}, 'Service unavailable', undefined);

      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.status).toBe(503);
    });

    it('should return generic APIError for unknown status codes', () => {
      const error = APIError.generate(418, {}, "I'm a teapot", undefined);

      expect(error).toBeInstanceOf(APIError);
      expect(error.constructor.name).toBe('APIError');
      expect(error.status).toBe(418);
    });

    it('should return APIConnectionError when no status', () => {
      const error = APIError.generate(undefined, {}, 'Connection failed', undefined);

      expect(error).toBeInstanceOf(APIConnectionError);
    });
  });
});

describe('APIUserAbortError', () => {
  it('should create with default message', () => {
    const error = new APIUserAbortError();

    expect(error.message).toBe('Request was aborted');
    expect(error.name).toBe('APIUserAbortError');
  });

  it('should create with custom message', () => {
    const error = new APIUserAbortError('User cancelled');

    expect(error.message).toBe('User cancelled');
  });

  it('should have undefined status', () => {
    const error = new APIUserAbortError();

    expect(error.status).toBeUndefined();
  });
});

describe('APIConnectionError', () => {
  it('should create with default message', () => {
    const error = new APIConnectionError();

    expect(error.message).toBe('Connection error');
    expect(error.name).toBe('APIConnectionError');
  });

  it('should create with custom message', () => {
    const error = new APIConnectionError({ message: 'Network unreachable' });

    expect(error.message).toBe('Network unreachable');
  });

  it('should store cause', () => {
    const cause = new Error('Original error');
    const error = new APIConnectionError({ message: 'Connection failed', cause });

    expect(error.cause).toBe(cause);
  });

  it('should have undefined status', () => {
    const error = new APIConnectionError();

    expect(error.status).toBeUndefined();
  });
});

describe('APIConnectionTimeoutError', () => {
  it('should create with default message', () => {
    const error = new APIConnectionTimeoutError();

    expect(error.message).toBe('Request timed out');
    expect(error.name).toBe('APIConnectionTimeoutError');
  });

  it('should create with custom message', () => {
    const error = new APIConnectionTimeoutError({ message: 'Timeout after 30s' });

    expect(error.message).toBe('Timeout after 30s');
  });

  it('should extend APIConnectionError', () => {
    const error = new APIConnectionTimeoutError();

    expect(error).toBeInstanceOf(APIConnectionError);
  });
});

describe('RateLimitError', () => {
  it('should extract retryAfter from headers', () => {
    const headers = new Headers({ 'retry-after': '120' });
    const error = new RateLimitError(429, {}, 'Rate limited', headers);

    expect(error.retryAfter).toBe(120);
  });

  it('should handle missing retry-after header', () => {
    const error = new RateLimitError(429, {}, 'Rate limited', new Headers());

    expect(error.retryAfter).toBeUndefined();
  });

  it('should handle non-numeric retry-after', () => {
    const headers = new Headers({ 'retry-after': 'invalid' });
    const error = new RateLimitError(429, {}, 'Rate limited', headers);

    expect(error.retryAfter).toBeUndefined();
  });
});

describe('Type Guards', () => {
  describe('isAPIError', () => {
    it('should return true for APIError instances', () => {
      const error = new APIError(400, {}, 'Error', undefined);

      expect(isAPIError(error)).toBe(true);
    });

    it('should return true for APIError subclasses', () => {
      expect(isAPIError(new BadRequestError(400, {}, 'Error', undefined))).toBe(true);
      expect(isAPIError(new AuthenticationError(401, {}, 'Error', undefined))).toBe(true);
      expect(isAPIError(new NotFoundError(404, {}, 'Error', undefined))).toBe(true);
      expect(isAPIError(new RateLimitError(429, {}, 'Error', undefined))).toBe(true);
    });

    it('should return false for regular errors', () => {
      expect(isAPIError(new Error('Regular error'))).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isAPIError(null)).toBe(false);
      expect(isAPIError(undefined)).toBe(false);
      expect(isAPIError('error string')).toBe(false);
      expect(isAPIError({ message: 'object' })).toBe(false);
    });
  });

  describe('isRateLimitError', () => {
    it('should return true for RateLimitError', () => {
      const error = new RateLimitError(429, {}, 'Rate limited', undefined);

      expect(isRateLimitError(error)).toBe(true);
    });

    it('should return false for other APIErrors', () => {
      expect(isRateLimitError(new BadRequestError(400, {}, 'Error', undefined))).toBe(false);
      expect(isRateLimitError(new InternalServerError(500, {}, 'Error', undefined))).toBe(false);
    });

    it('should return false for regular errors', () => {
      expect(isRateLimitError(new Error('Error'))).toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for APIConnectionError', () => {
      expect(isRetryableError(new APIConnectionError())).toBe(true);
    });

    it('should return true for APIConnectionTimeoutError', () => {
      expect(isRetryableError(new APIConnectionTimeoutError())).toBe(true);
    });

    it('should return true for RateLimitError', () => {
      expect(isRetryableError(new RateLimitError(429, {}, 'Rate limited', undefined))).toBe(true);
    });

    it('should return true for InternalServerError', () => {
      expect(isRetryableError(new InternalServerError(500, {}, 'Server error', undefined))).toBe(
        true
      );
    });

    it('should return false for BadRequestError', () => {
      expect(isRetryableError(new BadRequestError(400, {}, 'Bad request', undefined))).toBe(false);
    });

    it('should return false for AuthenticationError', () => {
      expect(isRetryableError(new AuthenticationError(401, {}, 'Unauthorized', undefined))).toBe(
        false
      );
    });

    it('should return false for NotFoundError', () => {
      expect(isRetryableError(new NotFoundError(404, {}, 'Not found', undefined))).toBe(false);
    });

    it('should return false for regular errors', () => {
      expect(isRetryableError(new Error('Error'))).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
    });
  });
});

describe('Error Inheritance', () => {
  it('BadRequestError should have correct hierarchy', () => {
    const error = new BadRequestError(400, {}, 'Error', undefined);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SupermemoryError);
    expect(error).toBeInstanceOf(APIError);
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.name).toBe('BadRequestError');
  });

  it('AuthenticationError should have correct hierarchy', () => {
    const error = new AuthenticationError(401, {}, 'Error', undefined);

    expect(error).toBeInstanceOf(APIError);
    expect(error.name).toBe('AuthenticationError');
  });

  it('PermissionDeniedError should have correct hierarchy', () => {
    const error = new PermissionDeniedError(403, {}, 'Error', undefined);

    expect(error).toBeInstanceOf(APIError);
    expect(error.name).toBe('PermissionDeniedError');
  });

  it('NotFoundError should have correct hierarchy', () => {
    const error = new NotFoundError(404, {}, 'Error', undefined);

    expect(error).toBeInstanceOf(APIError);
    expect(error.name).toBe('NotFoundError');
  });

  it('ConflictError should have correct hierarchy', () => {
    const error = new ConflictError(409, {}, 'Error', undefined);

    expect(error).toBeInstanceOf(APIError);
    expect(error.name).toBe('ConflictError');
  });

  it('UnprocessableEntityError should have correct hierarchy', () => {
    const error = new UnprocessableEntityError(422, {}, 'Error', undefined);

    expect(error).toBeInstanceOf(APIError);
    expect(error.name).toBe('UnprocessableEntityError');
  });

  it('RateLimitError should have correct hierarchy', () => {
    const error = new RateLimitError(429, {}, 'Error', undefined);

    expect(error).toBeInstanceOf(APIError);
    expect(error.name).toBe('RateLimitError');
  });

  it('InternalServerError should have correct hierarchy', () => {
    const error = new InternalServerError(500, {}, 'Error', undefined);

    expect(error).toBeInstanceOf(APIError);
    expect(error.name).toBe('InternalServerError');
  });
});
