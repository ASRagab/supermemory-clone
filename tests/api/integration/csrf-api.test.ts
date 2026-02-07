import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../../../src/api/index.js';

/**
 * CSRF Protection Integration Tests
 *
 * Tests the full CSRF protection flow in the API:
 * 1. Get CSRF token from /api/v1/csrf-token
 * 2. Use token in state-changing requests
 * 3. Verify protection against various attacks
 */

describe('CSRF API Integration', () => {
  let csrfToken: string;
  let csrfCookie: string;

  beforeAll(async () => {
    // Get a valid CSRF token
    const tokenRes = await app.request('/api/v1/csrf-token');
    expect(tokenRes.status).toBe(200);

    const body = await tokenRes.json();
    csrfToken = body.csrfToken;

    const cookies = tokenRes.headers.get('set-cookie');
    const match = cookies?.match(/_csrf=([^;]+)/);
    csrfCookie = match?.[1] || '';

    expect(csrfToken).toBeDefined();
    expect(csrfCookie).toBeDefined();
  });

  describe('Token Endpoint', () => {
    it('should provide CSRF token endpoint', async () => {
      const res = await app.request('/api/v1/csrf-token');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.csrfToken).toBeDefined();
      expect(body.expiresIn).toBe(3600);
    });

    it('should set CSRF cookie', async () => {
      const res = await app.request('/api/v1/csrf-token');
      const cookies = res.headers.get('set-cookie');

      expect(cookies).toContain('_csrf=');
      expect(cookies).toContain('HttpOnly');
      expect(cookies).toContain('SameSite=Strict');
      expect(cookies).toContain('Path=/');
    });

    it('should not overwrite existing token', async () => {
      const res = await app.request('/api/v1/csrf-token', {
        headers: {
          Cookie: `_csrf=existing-token:signature`,
        },
      });

      const cookies = res.headers.get('set-cookie');
      expect(cookies).toBeNull();
    });
  });

  describe('Safe Methods (No CSRF Required)', () => {
    it('should allow GET requests without CSRF token', async () => {
      const res = await app.request('/api/v1/profiles', {
        headers: {
          Authorization: 'Bearer test-api-key-123',
        },
      });

      expect(res.status).toBe(200);
    });

    it('should allow HEAD requests without CSRF token', async () => {
      const res = await app.request('/api/v1/profiles', {
        method: 'HEAD',
        headers: {
          Authorization: 'Bearer test-api-key-123',
        },
      });

      expect(res.status).toBe(200);
    });

    it('should allow OPTIONS requests without CSRF token', async () => {
      const res = await app.request('/api/v1/profiles', {
        method: 'OPTIONS',
      });

      // OPTIONS usually returns 404 if not explicitly handled, but shouldn't be blocked by CSRF
      expect(res.status).not.toBe(403);
    });
  });

  describe('Unsafe Methods (CSRF Required)', () => {
    it('should reject POST without CSRF token', async () => {
      const res = await app.request('/api/v1/documents', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-api-key-123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Test document',
        }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('CSRF token missing');
    });

    it('should accept POST with valid CSRF token', async () => {
      const res = await app.request('/api/v1/documents', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-api-key-123',
          'Content-Type': 'application/json',
          Cookie: `_csrf=${csrfCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          content: 'Test document with CSRF protection',
        }),
      });

      // Should get past CSRF check (might fail later for other reasons)
      expect(res.status).not.toBe(403);
    });

    it('should reject PUT without CSRF token', async () => {
      const res = await app.request('/api/v1/profiles/test', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test-api-key-123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Profile',
        }),
      });

      expect(res.status).toBe(403);
    });

    it('should accept PUT with valid CSRF token', async () => {
      const res = await app.request('/api/v1/profiles/test', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test-api-key-123',
          'Content-Type': 'application/json',
          Cookie: `_csrf=${csrfCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          name: 'Test Profile',
        }),
      });

      expect(res.status).not.toBe(403);
    });

    it('should reject DELETE without CSRF token', async () => {
      const res = await app.request('/api/v1/documents/test-id', {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer test-api-key-123',
        },
      });

      expect(res.status).toBe(403);
    });

    it('should accept DELETE with valid CSRF token', async () => {
      const res = await app.request('/api/v1/documents/test-id', {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer test-api-key-123',
          Cookie: `_csrf=${csrfCookie}`,
          'X-CSRF-Token': csrfToken,
        },
      });

      expect(res.status).not.toBe(403);
    });
  });

  describe('Attack Prevention', () => {
    it('should reject request with mismatched cookie and header tokens', async () => {
      // Get a different token
      const res2 = await app.request('/api/v1/csrf-token');
      const body2 = await res2.json();
      const differentToken = body2.csrfToken;

      const res = await app.request('/api/v1/documents', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-api-key-123',
          'Content-Type': 'application/json',
          Cookie: `_csrf=${csrfCookie}`, // Original token
          'X-CSRF-Token': differentToken, // Different token
        },
        body: JSON.stringify({
          content: 'Test',
        }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toContain('CSRF token mismatch');
    });

    it('should reject request with invalid token format', async () => {
      const res = await app.request('/api/v1/documents', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-api-key-123',
          'Content-Type': 'application/json',
          Cookie: `_csrf=invalid-format`,
          'X-CSRF-Token': 'invalid',
        },
        body: JSON.stringify({
          content: 'Test',
        }),
      });

      expect(res.status).toBe(403);
    });

    it('should reject request from disallowed origin', async () => {
      const res = await app.request('/api/v1/documents', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-api-key-123',
          'Content-Type': 'application/json',
          Origin: 'http://evil.com',
          Cookie: `_csrf=${csrfCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          content: 'Test',
        }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toContain('Invalid origin');
    });

    it('should accept request from allowed origin', async () => {
      const res = await app.request('/api/v1/documents', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-api-key-123',
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          Cookie: `_csrf=${csrfCookie}`,
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          content: 'Test from allowed origin',
        }),
      });

      expect(res.status).not.toBe(403);
    });
  });

  describe('CORS Integration', () => {
    it('should include X-CSRF-Token in allowed headers', async () => {
      const res = await app.request('/api/v1/documents', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'X-CSRF-Token,Content-Type',
        },
      });

      const allowedHeaders = res.headers.get('access-control-allow-headers');
      expect(allowedHeaders).toContain('X-CSRF-Token');
    });
  });
});
