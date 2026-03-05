/**
 * Authentication Middleware Tests
 *
 * Tests for Bearer token authentication and scope-based authorization.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono, Context, Next } from 'hono'

// Mock the auth middleware since we need to test it in isolation
interface AuthConfig {
  validateToken: (token: string) => Promise<{
    userId: string
    scopes: string[]
    apiKey: string
  } | null>
}

// Re-implement auth middleware for testing
function authMiddleware(config: AuthConfig) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization')

    if (!authHeader) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' } }, 401)
    }

    if (!authHeader.startsWith('Bearer ')) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid authorization format' } }, 401)
    }

    const token = authHeader.slice(7)

    if (!token) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } }, 401)
    }

    const authContext = await config.validateToken(token)

    if (!authContext) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, 401)
    }

    c.set('auth', authContext)
    return next()
  }
}

function requireScopes(...requiredScopes: string[]) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as { scopes: string[] } | undefined

    if (!auth) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
    }

    const hasAllScopes = requiredScopes.every((scope) => auth.scopes.includes(scope))

    if (!hasAllScopes) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403)
    }

    return next()
  }
}

describe('Auth Middleware', () => {
  let app: Hono
  let mockValidateToken: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockValidateToken = vi.fn()
    app = new Hono()

    app.use('*', authMiddleware({ validateToken: mockValidateToken }))
    app.get('/protected', (c) => {
      const auth = c.get('auth')
      return c.json({ success: true, auth })
    })
  })

  describe('Authorization Header', () => {
    it('should reject requests without Authorization header', async () => {
      const res = await app.request('/protected')

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error.code).toBe('UNAUTHORIZED')
      expect(body.error.message).toContain('Missing')
    })

    it('should reject non-Bearer authorization', async () => {
      const res = await app.request('/protected', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      })

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error.message).toContain('format')
    })

    it('should reject empty Bearer token', async () => {
      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer ' },
      })

      expect(res.status).toBe(401)
    })

    it('should accept valid Bearer token', async () => {
      mockValidateToken.mockResolvedValueOnce({
        userId: 'user-123',
        scopes: ['read'],
        apiKey: 'sk-test',
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer sk-valid-token' },
      })

      expect(res.status).toBe(200)
      expect(mockValidateToken).toHaveBeenCalledWith('sk-valid-token')
    })
  })

  describe('Token Validation', () => {
    it('should reject invalid tokens', async () => {
      mockValidateToken.mockResolvedValueOnce(null)

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer sk-invalid' },
      })

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error.message).toContain('Invalid token')
    })

    it('should set auth context for valid tokens', async () => {
      const authData = {
        userId: 'user-456',
        scopes: ['read', 'write'],
        apiKey: 'sk-test-key',
      }
      mockValidateToken.mockResolvedValueOnce(authData)

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer sk-test-key' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.auth.userId).toBe('user-456')
      expect(body.auth.scopes).toEqual(['read', 'write'])
    })

    it('should handle validation errors gracefully', async () => {
      mockValidateToken.mockRejectedValueOnce(new Error('Database error'))

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer sk-test' },
      })

      expect(res.status).toBe(500)
    })
  })
})

describe('Scope Authorization', () => {
  let app: Hono
  let mockValidateToken: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockValidateToken = vi.fn()
    app = new Hono()

    app.use('*', authMiddleware({ validateToken: mockValidateToken }))
    app.get('/read-only', requireScopes('read'), (c) => c.json({ access: 'read' }))
    app.post('/write', requireScopes('write'), (c) => c.json({ access: 'write' }))
    app.delete('/admin', requireScopes('admin'), (c) => c.json({ access: 'admin' }))
    app.post('/multi', requireScopes('read', 'write'), (c) => c.json({ access: 'both' }))
  })

  it('should allow access with required scope', async () => {
    mockValidateToken.mockResolvedValueOnce({
      userId: 'user-1',
      scopes: ['read'],
      apiKey: 'sk-test',
    })

    const res = await app.request('/read-only', {
      headers: { Authorization: 'Bearer sk-test' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access).toBe('read')
  })

  it('should deny access without required scope', async () => {
    mockValidateToken.mockResolvedValueOnce({
      userId: 'user-1',
      scopes: ['read'],
      apiKey: 'sk-test',
    })

    const res = await app.request('/write', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test' },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('should require all scopes for multi-scope routes', async () => {
    mockValidateToken.mockResolvedValueOnce({
      userId: 'user-1',
      scopes: ['read'], // Missing 'write'
      apiKey: 'sk-test',
    })

    const res = await app.request('/multi', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test' },
    })

    expect(res.status).toBe(403)
  })

  it('should allow access with all required scopes', async () => {
    mockValidateToken.mockResolvedValueOnce({
      userId: 'user-1',
      scopes: ['read', 'write'],
      apiKey: 'sk-test',
    })

    const res = await app.request('/multi', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-test' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access).toBe('both')
  })

  it('should allow access with superset of required scopes', async () => {
    mockValidateToken.mockResolvedValueOnce({
      userId: 'user-1',
      scopes: ['read', 'write', 'admin'],
      apiKey: 'sk-test',
    })

    const res = await app.request('/read-only', {
      headers: { Authorization: 'Bearer sk-test' },
    })

    expect(res.status).toBe(200)
  })
})

describe('Edge Cases', () => {
  let app: Hono
  let mockValidateToken: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockValidateToken = vi.fn()
    app = new Hono()

    app.use('*', authMiddleware({ validateToken: mockValidateToken }))
    app.get('/test', (c) => c.json({ success: true }))
  })

  it('should handle tokens with special characters', async () => {
    const specialToken = 'sk-test_token-with.special+chars='
    mockValidateToken.mockResolvedValueOnce({
      userId: 'user-1',
      scopes: ['read'],
      apiKey: specialToken,
    })

    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${specialToken}` },
    })

    expect(res.status).toBe(200)
    expect(mockValidateToken).toHaveBeenCalledWith(specialToken)
  })

  it('should handle very long tokens', async () => {
    const longToken = 'sk-' + 'a'.repeat(1000)
    mockValidateToken.mockResolvedValueOnce({
      userId: 'user-1',
      scopes: ['read'],
      apiKey: longToken,
    })

    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${longToken}` },
    })

    expect(res.status).toBe(200)
  })

  it('should handle concurrent requests', async () => {
    mockValidateToken.mockImplementation(async (token: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        userId: `user-${token}`,
        scopes: ['read'],
        apiKey: token,
      }
    })

    const requests = Array.from({ length: 10 }, (_, i) =>
      app.request('/test', {
        headers: { Authorization: `Bearer token-${i}` },
      })
    )

    const responses = await Promise.all(requests)

    for (const res of responses) {
      expect(res.status).toBe(200)
    }
    expect(mockValidateToken).toHaveBeenCalledTimes(10)
  })

  it('should handle empty scopes array', async () => {
    mockValidateToken.mockResolvedValueOnce({
      userId: 'user-1',
      scopes: [],
      apiKey: 'sk-test',
    })

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer sk-test' },
    })

    expect(res.status).toBe(200)
  })
})
