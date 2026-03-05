/**
 * Tests for Validation Middleware
 *
 * Tests for content size limits, schema validation, path validation,
 * and request sanitization middleware.
 */

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  contentSizeLimit,
  validateSchema,
  validatePathParams,
  validateQueryParams,
  validateRequest,
  MAX_CONTENT_SIZE,
  MAX_QUERY_LENGTH,
} from '../../../src/api/middleware/validation.js'

// ============================================================================
// Test Helpers
// ============================================================================

async function testRequest(
  app: Hono,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = `http://localhost${path}`
  const req = new Request(url, { method, ...options })
  return app.fetch(req)
}

// ============================================================================
// Content Size Limit Tests
// ============================================================================

describe('contentSizeLimit Middleware', () => {
  it('should allow requests under the size limit', async () => {
    const app = new Hono()
    app.post('/test', contentSizeLimit({ maxSize: 1000 }), (c) => c.json({ ok: true }))

    const body = JSON.stringify({ data: 'small' })
    const res = await testRequest(app, 'POST', '/test', {
      body,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length.toString(),
      },
    })

    expect(res.status).toBe(200)
  })

  it('should reject requests exceeding the size limit', async () => {
    const app = new Hono()
    app.post('/test', contentSizeLimit({ maxSize: 100 }), (c) => c.json({ ok: true }))

    const body = JSON.stringify({ data: 'x'.repeat(200) })
    const res = await testRequest(app, 'POST', '/test', {
      body,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length.toString(),
      },
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('VALIDATION_ERROR')
    expect(json.error.message).toContain('exceeds maximum')
  })

  it('should use default size limit when not specified', async () => {
    const app = new Hono()
    app.post('/test', contentSizeLimit(), (c) => c.json({ ok: true }))

    // Create a body larger than MAX_CONTENT_SIZE
    const body = 'x'.repeat(MAX_CONTENT_SIZE + 1000)
    const res = await testRequest(app, 'POST', '/test', {
      body,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length.toString(),
      },
    })

    expect(res.status).toBe(400)
  })

  it('should allow requests without Content-Length header', async () => {
    const app = new Hono()
    app.post('/test', contentSizeLimit({ maxSize: 1000 }), (c) => c.json({ ok: true }))

    const res = await testRequest(app, 'POST', '/test', {
      body: JSON.stringify({ data: 'test' }),
      headers: {
        'Content-Type': 'application/json',
      },
    })

    expect(res.status).toBe(200)
  })
})

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('validateSchema Middleware', () => {
  const TestSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    age: z.number().optional(),
  })

  it('should pass valid requests', async () => {
    const app = new Hono()
    app.post('/test', validateSchema(TestSchema), (c) => {
      const body = c.get('validatedBody')
      return c.json({ received: body })
    })

    const body = JSON.stringify({ name: 'John', email: 'john@example.com' })
    const res = await testRequest(app, 'POST', '/test', {
      body,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.received.name).toBe('John')
    expect(json.received.email).toBe('john@example.com')
  })

  it('should reject invalid data with field errors', async () => {
    const app = new Hono()
    app.post('/test', validateSchema(TestSchema), (c) => c.json({ ok: true }))

    const body = JSON.stringify({ name: '', email: 'not-an-email' })
    const res = await testRequest(app, 'POST', '/test', {
      body,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('VALIDATION_ERROR')
    expect(json.error.message).toContain('Validation failed')
    expect(json.error.details?.fieldErrors).toBeDefined()
  })

  it('should reject invalid JSON', async () => {
    const app = new Hono()
    app.post('/test', validateSchema(TestSchema), (c) => c.json({ ok: true }))

    const res = await testRequest(app, 'POST', '/test', {
      body: 'not valid json',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.message).toContain('Invalid JSON')
  })

  it('should sanitize string values when enabled', async () => {
    const ContentSchema = z.object({
      content: z.string(),
    })

    const app = new Hono()
    app.post('/test', validateSchema(ContentSchema, { sanitize: true }), (c) => {
      const body = c.get('validatedBody') as { content: string }
      return c.json({ content: body.content })
    })

    const body = JSON.stringify({
      content: '<script>alert("xss")</script><p>Hello</p>',
    })
    const res = await testRequest(app, 'POST', '/test', {
      body,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.content).not.toContain('<script>')
    expect(json.content).toContain('<p>Hello</p>')
  })
})

// ============================================================================
// Path Validation Tests
// ============================================================================

describe('validatePathParams Middleware', () => {
  it('should allow safe path parameters', async () => {
    const app = new Hono()
    app.get('/files/:path', validatePathParams(), (c) => {
      return c.json({ path: c.req.param('path') })
    })

    const res = await testRequest(app, 'GET', '/files/documents-file.txt')

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.path).toBe('documents-file.txt')
  })

  it('should reject path traversal attempts', async () => {
    const app = new Hono()
    app.get('/files/:path', validatePathParams(), (c) => c.json({ ok: true }))

    // Note: Hono URL-decodes path params, so we test with literal ..
    const res = await testRequest(app, 'GET', '/files/..%2F..%2Fetc%2Fpasswd')

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.message).toContain('Security violation')
  })

  it('should validate specific parameters when specified', async () => {
    const app = new Hono()
    app.get('/users/:id/files/:filename', validatePathParams(['filename']), (c) => c.json({ ok: true }))

    const res = await testRequest(app, 'GET', '/users/123/files/document.txt')

    expect(res.status).toBe(200)
  })
})

// ============================================================================
// Query Validation Tests
// ============================================================================

describe('validateQueryParams Middleware', () => {
  it('should allow normal query strings', async () => {
    const app = new Hono()
    app.get('/search', validateQueryParams(), (c) => {
      return c.json({ q: c.req.query('q') })
    })

    const res = await testRequest(app, 'GET', '/search?q=hello+world')

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.q).toBe('hello world')
  })

  it('should reject excessively long query strings', async () => {
    const app = new Hono()
    app.get('/search', validateQueryParams(), (c) => c.json({ ok: true }))

    const longQuery = 'q=' + 'x'.repeat(MAX_QUERY_LENGTH + 100)
    const res = await testRequest(app, 'GET', `/search?${longQuery}`)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.message).toContain('Query string exceeds')
  })
})

// ============================================================================
// Combined Validation Tests
// ============================================================================

describe('validateRequest Middleware', () => {
  const CreateDocSchema = z.object({
    content: z.string().min(1).max(1000),
    title: z.string().optional(),
  })

  it('should validate both size and schema', async () => {
    const app = new Hono()
    app.post(
      '/docs',
      validateRequest({
        schema: CreateDocSchema,
        maxSize: 5000,
        sanitize: true,
      }),
      (c) => {
        const body = c.get('validatedBody')
        return c.json(body)
      }
    )

    const body = JSON.stringify({
      content: '<p>Hello World</p>',
      title: 'Test',
    })

    const res = await testRequest(app, 'POST', '/docs', {
      body,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length.toString(),
      },
    })

    expect(res.status).toBe(200)
  })

  it('should reject if size limit exceeded', async () => {
    const app = new Hono()
    app.post(
      '/docs',
      validateRequest({
        schema: CreateDocSchema,
        maxSize: 100,
      }),
      (c) => c.json({ ok: true })
    )

    const body = JSON.stringify({
      content: 'x'.repeat(500),
    })

    const res = await testRequest(app, 'POST', '/docs', {
      body,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length.toString(),
      },
    })

    expect(res.status).toBe(400)
  })

  it('should reject if schema validation fails', async () => {
    const app = new Hono()
    app.post(
      '/docs',
      validateRequest({
        schema: CreateDocSchema,
        maxSize: 5000,
      }),
      (c) => c.json({ ok: true })
    )

    const body = JSON.stringify({
      content: '', // Too short
    })

    const res = await testRequest(app, 'POST', '/docs', {
      body,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('VALIDATION_ERROR')
  })
})

// ============================================================================
// Security Constants Tests
// ============================================================================

describe('Security Constants', () => {
  it('should have reasonable default limits', () => {
    expect(MAX_CONTENT_SIZE).toBe(50 * 1024) // 50KB
    expect(MAX_QUERY_LENGTH).toBe(10 * 1024) // 10KB
  })
})
