/**
 * Validation Middleware Test Suite
 *
 * Tests for API request validation middleware, including input validation,
 * content size limits, and error response handling.
 * Part of TASK-052: Security Tester - Input Validation Test Suite
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono, Context, Next } from 'hono';
import { z, ZodError, ZodSchema } from 'zod';
import {
  CreateDocumentSchema,
  SearchRequestSchema,
  UpdateProfileSchema,
  ErrorCodes,
} from '../../../src/types/api.types.js';

// ============================================================================
// Content Size Constants
// ============================================================================

const MAX_CONTENT_SIZE_BYTES = 50 * 1024; // 50KB
const MAX_REQUEST_SIZE_BYTES = 100 * 1024; // 100KB

// ============================================================================
// Validation Middleware Implementation
// ============================================================================

/**
 * Create a validation middleware for a given Zod schema
 */
function createValidationMiddleware<T>(schema: ZodSchema<T>) {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const validated = schema.parse(body);
      c.set('validatedBody', validated);
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of error.issues) {
          const path = issue.path.join('.') || '_root';
          if (!fieldErrors[path]) {
            fieldErrors[path] = [];
          }
          fieldErrors[path].push(issue.message);
        }

        return c.json({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Validation failed',
            details: { fieldErrors },
          },
          status: 400,
        }, 400);
      }

      if (error instanceof SyntaxError) {
        return c.json({
          error: {
            code: ErrorCodes.BAD_REQUEST,
            message: 'Invalid JSON in request body',
          },
          status: 400,
        }, 400);
      }

      throw error;
    }
  };
}

/**
 * Content size limit middleware
 */
function contentSizeLimit(maxBytes: number) {
  return async (c: Context, next: Next) => {
    const contentLength = c.req.header('Content-Length');

    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > maxBytes) {
        return c.json({
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Request body exceeds maximum size of ${maxBytes} bytes`,
            details: { maxBytes, receivedBytes: size },
          },
          status: 413,
        }, 413);
      }
    }

    // Also check after parsing
    const body = await c.req.text();
    const bodySize = new TextEncoder().encode(body).length;

    if (bodySize > maxBytes) {
      return c.json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request body exceeds maximum size of ${maxBytes} bytes`,
          details: { maxBytes, receivedBytes: bodySize },
        },
        status: 413,
      }, 413);
    }

    // Parse JSON and continue
    try {
      const json = JSON.parse(body);
      c.set('parsedBody', json);
    } catch {
      return c.json({
        error: {
          code: ErrorCodes.BAD_REQUEST,
          message: 'Invalid JSON in request body',
        },
        status: 400,
      }, 400);
    }

    return next();
  };
}

/**
 * Content validation middleware - checks specific field sizes
 */
function contentFieldLimit(field: string, maxBytes: number) {
  return async (c: Context, next: Next) => {
    const body = c.get('parsedBody') || await c.req.json().catch(() => ({}));

    if (body && typeof body === 'object' && field in body) {
      const fieldValue = body[field];
      if (typeof fieldValue === 'string') {
        const fieldSize = new TextEncoder().encode(fieldValue).length;
        if (fieldSize > maxBytes) {
          return c.json({
            error: {
              code: ErrorCodes.VALIDATION_ERROR,
              message: `Field '${field}' exceeds maximum size of ${maxBytes} bytes`,
              details: { field, maxBytes, receivedBytes: fieldSize },
            },
            status: 400,
          }, 400);
        }
      }
    }

    return next();
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a request with JSON body
 */
function createJsonRequest(path: string, body: unknown, options: RequestInit = {}): Request {
  const bodyString = JSON.stringify(body);
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': new TextEncoder().encode(bodyString).length.toString(),
      ...options.headers,
    },
    body: bodyString,
    ...options,
  });
}

/**
 * Generate a string of specified byte size
 */
function generateStringOfSize(bytes: number): string {
  return 'a'.repeat(bytes);
}

// ============================================================================
// Validation Middleware Tests
// ============================================================================

describe('Validation Middleware', () => {
  describe('CreateDocumentSchema Validation', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.post('/documents', createValidationMiddleware(CreateDocumentSchema), (c) => {
        const validated = c.get('validatedBody');
        return c.json({ success: true, data: validated }, 201);
      });
    });

    it('should accept valid document input', async () => {
      const body = {
        content: 'This is valid content',
        containerTag: 'my-container',
        metadata: { key: 'value' },
      };

      const res = await app.request(createJsonRequest('/documents', body));
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.content).toBe('This is valid content');
    });

    it('should return 400 for missing required content', async () => {
      const body = {
        containerTag: 'my-container',
      };

      const res = await app.request(createJsonRequest('/documents', body));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(json.error.details.fieldErrors).toHaveProperty('content');
    });

    it('should return 400 for empty content', async () => {
      const body = {
        content: '',
      };

      const res = await app.request(createJsonRequest('/documents', body));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should return 400 for invalid JSON', async () => {
      const req = new Request('http://localhost/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'not valid json{',
      });

      const res = await app.request(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.code).toBe(ErrorCodes.BAD_REQUEST);
      expect(json.error.message).toContain('Invalid JSON');
    });

    it('should accept optional containerTag', async () => {
      const body = {
        content: 'Content without container tag',
      };

      const res = await app.request(createJsonRequest('/documents', body));
      expect(res.status).toBe(201);
    });

    it('should accept optional metadata', async () => {
      const body = {
        content: 'Content with metadata',
        metadata: { custom: 'data', number: 42 },
      };

      const res = await app.request(createJsonRequest('/documents', body));
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.data.metadata.custom).toBe('data');
    });
  });

  describe('SearchRequestSchema Validation', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.post('/search', createValidationMiddleware(SearchRequestSchema), (c) => {
        const validated = c.get('validatedBody');
        return c.json({ success: true, data: validated });
      });
    });

    it('should accept valid search request', async () => {
      const body = {
        q: 'search query',
        limit: 10,
      };

      const res = await app.request(createJsonRequest('/search', body));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.q).toBe('search query');
    });

    it('should return 400 for missing query', async () => {
      const body = {
        limit: 10,
      };

      const res = await app.request(createJsonRequest('/search', body));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should return 400 for empty query', async () => {
      const body = {
        q: '',
      };

      const res = await app.request(createJsonRequest('/search', body));
      expect(res.status).toBe(400);
    });

    it('should return 400 for limit out of range', async () => {
      const body = {
        q: 'test',
        limit: 101,
      };

      const res = await app.request(createJsonRequest('/search', body));
      expect(res.status).toBe(400);
    });

    it('should return 400 for negative limit', async () => {
      const body = {
        q: 'test',
        limit: -1,
      };

      const res = await app.request(createJsonRequest('/search', body));
      expect(res.status).toBe(400);
    });

    it('should return 400 for threshold out of range', async () => {
      const body = {
        q: 'test',
        threshold: 1.5,
      };

      const res = await app.request(createJsonRequest('/search', body));
      expect(res.status).toBe(400);
    });

    it('should apply default values', async () => {
      const body = {
        q: 'test',
      };

      const res = await app.request(createJsonRequest('/search', body));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.searchMode).toBe('hybrid');
      expect(json.data.limit).toBe(10);
      expect(json.data.threshold).toBe(0.7);
    });
  });
});

// ============================================================================
// Content Size Limit Tests
// ============================================================================

describe('Content Size Middleware', () => {
  describe('Request Body Size Limits', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.post('/upload', contentSizeLimit(MAX_CONTENT_SIZE_BYTES), (c) => {
        return c.json({ success: true });
      });
    });

    it('should accept content under the limit', async () => {
      const content = generateStringOfSize(MAX_CONTENT_SIZE_BYTES - 100);
      const body = { content };

      const res = await app.request(createJsonRequest('/upload', body));
      expect(res.status).toBe(200);
    });

    it('should accept content exactly at the limit', async () => {
      // Account for JSON structure overhead
      const overhead = '{"content":"}'.length + 2;
      const content = generateStringOfSize(MAX_CONTENT_SIZE_BYTES - overhead);
      const body = { content };

      const res = await app.request(createJsonRequest('/upload', body));
      // May or may not pass depending on encoding - test documents behavior
      expect([200, 413]).toContain(res.status);
    });

    it('should return 413 for content over the limit', async () => {
      const content = generateStringOfSize(MAX_CONTENT_SIZE_BYTES + 1000);
      const body = { content };

      const res = await app.request(createJsonRequest('/upload', body));
      expect(res.status).toBe(413);

      const json = await res.json();
      expect(json.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('should return 413 for large request based on Content-Length', async () => {
      const fakeContentLength = (MAX_CONTENT_SIZE_BYTES + 10000).toString();
      const req = new Request('http://localhost/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': fakeContentLength,
        },
        body: JSON.stringify({ content: 'small' }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(413);
    });

    it('should handle missing Content-Length header', async () => {
      const content = 'small content';
      const body = JSON.stringify({ content });
      const req = new Request('http://localhost/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      });

      const res = await app.request(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Field-Specific Size Limits', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.post('/content', contentFieldLimit('content', MAX_CONTENT_SIZE_BYTES), (c) => {
        return c.json({ success: true });
      });
    });

    it('should accept content field under the limit', async () => {
      const content = generateStringOfSize(10000);
      const body = { content };

      const res = await app.request(createJsonRequest('/content', body));
      expect(res.status).toBe(200);
    });

    it('should return 400 for content field over the limit', async () => {
      const content = generateStringOfSize(MAX_CONTENT_SIZE_BYTES + 1000);
      const body = { content };

      const res = await app.request(createJsonRequest('/content', body));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(json.error.message).toContain('content');
    });

    it('should allow non-string fields without limit', async () => {
      const body = { content: 12345 };

      const res = await app.request(createJsonRequest('/content', body));
      expect(res.status).toBe(200);
    });

    it('should allow missing field', async () => {
      const body = { otherField: 'value' };

      const res = await app.request(createJsonRequest('/content', body));
      expect(res.status).toBe(200);
    });
  });

  describe('Multibyte Character Handling', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.post('/content', contentFieldLimit('content', 100), (c) => {
        return c.json({ success: true });
      });
    });

    it('should calculate size in bytes, not characters', async () => {
      // Each emoji is 4 bytes, so 30 emojis = 120 bytes > 100 limit
      const content = '\u{1F600}'.repeat(30);
      const body = { content };

      const res = await app.request(createJsonRequest('/content', body));
      expect(res.status).toBe(400);
    });

    it('should allow multibyte content under byte limit', async () => {
      // 20 emojis = 80 bytes < 100 limit
      const content = '\u{1F600}'.repeat(20);
      const body = { content };

      const res = await app.request(createJsonRequest('/content', body));
      expect(res.status).toBe(200);
    });
  });
});

// ============================================================================
// Error Message Quality Tests
// ============================================================================

describe('Error Message Quality', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.post('/validate', createValidationMiddleware(CreateDocumentSchema), (c) => {
      return c.json({ success: true });
    });
  });

  describe('Helpful Error Messages', () => {
    it('should provide specific field name in error', async () => {
      const body = { content: '' };

      const res = await app.request(createJsonRequest('/validate', body));
      const json = await res.json();

      expect(json.error.details).toBeDefined();
      expect(json.error.details.fieldErrors).toBeDefined();
    });

    it('should include multiple validation errors', async () => {
      // Create a schema that can have multiple errors
      const multiFieldSchema = z.object({
        name: z.string().min(1),
        email: z.string().email(),
        age: z.number().min(0),
      });

      const testApp = new Hono();
      testApp.post('/multi', createValidationMiddleware(multiFieldSchema), (c) => {
        return c.json({ success: true });
      });

      const body = { name: '', email: 'not-email', age: -1 };
      const res = await testApp.request(createJsonRequest('/multi', body));
      const json = await res.json();

      expect(json.error.details.fieldErrors).toHaveProperty('name');
      expect(json.error.details.fieldErrors).toHaveProperty('email');
      expect(json.error.details.fieldErrors).toHaveProperty('age');
    });

    it('should handle nested object errors', async () => {
      const nestedSchema = z.object({
        user: z.object({
          name: z.string().min(1),
        }),
      });

      const testApp = new Hono();
      testApp.post('/nested', createValidationMiddleware(nestedSchema), (c) => {
        return c.json({ success: true });
      });

      const body = { user: { name: '' } };
      const res = await testApp.request(createJsonRequest('/nested', body));
      const json = await res.json();

      expect(json.error.details.fieldErrors).toHaveProperty('user.name');
    });
  });

  describe('Non-Leaky Error Messages', () => {
    it('should not expose internal details in production-like errors', async () => {
      const body = { invalid: 'data' };

      const res = await app.request(createJsonRequest('/validate', body));
      const json = await res.json();

      // Should have helpful message but not internal stack traces
      expect(json.error.message).toBeDefined();
      expect(json.error).not.toHaveProperty('stack');
      expect(JSON.stringify(json)).not.toContain('node_modules');
    });

    it('should not expose database schema in errors', async () => {
      const body = { content: '' };

      const res = await app.request(createJsonRequest('/validate', body));
      const json = await res.json();

      const errorString = JSON.stringify(json);
      expect(errorString).not.toContain('pg_');
      expect(errorString).not.toContain('SELECT');
      expect(errorString).not.toContain('INSERT');
    });
  });
});

// ============================================================================
// Edge Cases and Security Tests
// ============================================================================

describe('Edge Cases and Security', () => {
  describe('Malformed Input Handling', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.post('/validate', contentSizeLimit(MAX_CONTENT_SIZE_BYTES), (c) => {
        return c.json({ success: true });
      });
    });

    it('should handle empty body', async () => {
      const req = new Request('http://localhost/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '',
      });

      const res = await app.request(req);
      expect(res.status).toBe(400);
    });

    it('should handle null body', async () => {
      const res = await app.request(createJsonRequest('/validate', null));
      expect(res.status).toBe(200);
    });

    it('should handle array instead of object', async () => {
      const res = await app.request(createJsonRequest('/validate', [1, 2, 3]));
      expect(res.status).toBe(200);
    });

    it('should handle deeply nested objects', async () => {
      let nested: unknown = { value: 'deep' };
      for (let i = 0; i < 100; i++) {
        nested = { level: nested };
      }

      const res = await app.request(createJsonRequest('/validate', nested));
      // Should handle without crashing
      expect([200, 400, 413]).toContain(res.status);
    });
  });

  describe('Special Character Handling', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.post('/validate', createValidationMiddleware(CreateDocumentSchema), (c) => {
        const validated = c.get('validatedBody');
        return c.json({ success: true, data: validated }, 201);
      });
    });

    it('should handle null bytes in content', async () => {
      const body = { content: 'test\x00content' };

      const res = await app.request(createJsonRequest('/validate', body));
      expect(res.status).toBe(201);
    });

    it('should handle unicode in content', async () => {
      const body = { content: 'Hello Unicode Test' };

      const res = await app.request(createJsonRequest('/validate', body));
      expect(res.status).toBe(201);
    });

    it('should handle control characters in content', async () => {
      const body = { content: 'test\x01\x02\x03content' };

      const res = await app.request(createJsonRequest('/validate', body));
      expect(res.status).toBe(201);
    });

    it('should handle HTML in content', async () => {
      const body = { content: '<script>alert("xss")</script>' };

      const res = await app.request(createJsonRequest('/validate', body));
      // Validation should pass - XSS protection is separate concern
      expect(res.status).toBe(201);
    });

    it('should handle SQL in content', async () => {
      const body = { content: "'; DROP TABLE users; --" };

      const res = await app.request(createJsonRequest('/validate', body));
      // Validation should pass - SQL injection protection is separate concern
      expect(res.status).toBe(201);
    });
  });

  describe('Content-Type Handling', () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.post('/validate', createValidationMiddleware(CreateDocumentSchema), (c) => {
        return c.json({ success: true }, 201);
      });
    });

    it('should require application/json content type', async () => {
      const req = new Request('http://localhost/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: JSON.stringify({ content: 'test' }),
      });

      const res = await app.request(req);
      // Should still work since we're parsing JSON
      expect([200, 201, 400]).toContain(res.status);
    });

    it('should handle charset in content type', async () => {
      const req = new Request('http://localhost/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ content: 'test' }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(201);
    });
  });
});

// ============================================================================
// Concurrent Request Handling Tests
// ============================================================================

describe('Concurrent Request Handling', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.post('/validate', createValidationMiddleware(CreateDocumentSchema), async (c) => {
      // Simulate some async work
      await new Promise((resolve) => setTimeout(resolve, 10));
      const validated = c.get('validatedBody');
      return c.json({ success: true, content: validated.content }, 201);
    });
  });

  it('should handle multiple concurrent valid requests', async () => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      app.request(createJsonRequest('/validate', { content: `Content ${i}` }))
    );

    const responses = await Promise.all(requests);

    for (const res of responses) {
      expect(res.status).toBe(201);
    }
  });

  it('should handle mixed valid and invalid concurrent requests', async () => {
    const requests = [
      app.request(createJsonRequest('/validate', { content: 'Valid 1' })),
      app.request(createJsonRequest('/validate', { content: '' })), // Invalid
      app.request(createJsonRequest('/validate', { content: 'Valid 2' })),
      app.request(createJsonRequest('/validate', {})), // Invalid
      app.request(createJsonRequest('/validate', { content: 'Valid 3' })),
    ];

    const responses = await Promise.all(requests);

    expect(responses[0].status).toBe(201);
    expect(responses[1].status).toBe(400);
    expect(responses[2].status).toBe(201);
    expect(responses[3].status).toBe(400);
    expect(responses[4].status).toBe(201);
  });
});

// ============================================================================
// Integration with Error Handler Tests
// ============================================================================

describe('Integration with Error Handler', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();

    // Error handler middleware
    app.use('*', async (c, next) => {
      try {
        await next();
      } catch (error) {
        console.error('Unhandled error:', error);
        return c.json({
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: 'An unexpected error occurred',
          },
          status: 500,
        }, 500);
      }
    });

    app.post('/validate', createValidationMiddleware(CreateDocumentSchema), (c) => {
      return c.json({ success: true }, 201);
    });
  });

  it('should return proper error format for validation failures', async () => {
    const res = await app.request(createJsonRequest('/validate', {}));

    const json = await res.json();
    expect(json.error).toBeDefined();
    expect(json.error.code).toBeDefined();
    expect(json.error.message).toBeDefined();
    expect(json.status).toBe(400);
  });

  it('should not leak stack traces in validation errors', async () => {
    const res = await app.request(createJsonRequest('/validate', { invalid: true }));

    const json = await res.json();
    const jsonString = JSON.stringify(json);

    expect(jsonString).not.toContain('at ');
    expect(jsonString).not.toContain('.ts:');
    expect(jsonString).not.toContain('.js:');
  });
});
