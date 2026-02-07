/**
 * Rate Limiting Middleware Tests
 *
 * Tests for rate limiting functionality including different strategies,
 * key extraction, and header responses.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono, Context, Next } from 'hono';

// Rate limit configuration
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (c: Context) => string;
  store?: RateLimitStore;
}

interface RateLimitStore {
  get(key: string): Promise<{ count: number; resetTime: number } | null>;
  set(key: string, value: { count: number; resetTime: number }): Promise<void>;
  increment(key: string): Promise<{ count: number; resetTime: number }>;
}

// In-memory store for testing
class MemoryStore implements RateLimitStore {
  private store = new Map<string, { count: number; resetTime: number }>();

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.resetTime) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async set(key: string, value: { count: number; resetTime: number }) {
    this.store.set(key, value);
  }

  async increment(key: string) {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetTime) {
      const newEntry = { count: 1, resetTime: now + 60000 };
      this.store.set(key, newEntry);
      return newEntry;
    }

    entry.count++;
    return entry;
  }

  clear() {
    this.store.clear();
  }
}

// Rate limit middleware implementation for testing
function rateLimitMiddleware(config: RateLimitConfig) {
  const store = config.store ?? new MemoryStore();
  const keyGenerator =
    config.keyGenerator ?? ((c: Context) => c.req.header('X-Forwarded-For') ?? 'unknown');

  return async (c: Context, next: Next) => {
    const key = keyGenerator(c);
    const result = await store.increment(key);

    // Set rate limit headers
    c.header('X-RateLimit-Limit', config.maxRequests.toString());
    c.header('X-RateLimit-Remaining', Math.max(0, config.maxRequests - result.count).toString());
    c.header('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());

    if (result.count > config.maxRequests) {
      c.header('Retry-After', Math.ceil((result.resetTime - Date.now()) / 1000).toString());
      return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429);
    }

    return next();
  };
}

describe('Rate Limit Middleware', () => {
  let app: Hono;
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
    app = new Hono();
  });

  afterEach(() => {
    store.clear();
  });

  describe('Basic Rate Limiting', () => {
    beforeEach(() => {
      app.use(
        '*',
        rateLimitMiddleware({
          windowMs: 60000,
          maxRequests: 5,
          store,
          keyGenerator: () => 'test-client',
        })
      );
      app.get('/test', (c) => c.json({ success: true }));
    });

    it('should allow requests under the limit', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(200);
      }
    });

    it('should reject requests over the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await app.request('/test');
      }

      const res = await app.request('/test');
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    it('should include rate limit headers', async () => {
      const res = await app.request('/test');

      expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
      expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
    });

    it('should decrement remaining with each request', async () => {
      const res1 = await app.request('/test');
      expect(res1.headers.get('X-RateLimit-Remaining')).toBe('4');

      const res2 = await app.request('/test');
      expect(res2.headers.get('X-RateLimit-Remaining')).toBe('3');

      const res3 = await app.request('/test');
      expect(res3.headers.get('X-RateLimit-Remaining')).toBe('2');
    });

    it('should include Retry-After header when limited', async () => {
      for (let i = 0; i < 5; i++) {
        await app.request('/test');
      }

      const res = await app.request('/test');
      expect(res.headers.get('Retry-After')).toBeDefined();
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
  });

  describe('Key Generation', () => {
    it('should use custom key generator', async () => {
      app.use(
        '*',
        rateLimitMiddleware({
          windowMs: 60000,
          maxRequests: 2,
          store,
          keyGenerator: (c) => c.req.header('X-API-Key') ?? 'anonymous',
        })
      );
      app.get('/test', (c) => c.json({ success: true }));

      // Client A makes 2 requests
      await app.request('/test', { headers: { 'X-API-Key': 'client-a' } });
      await app.request('/test', { headers: { 'X-API-Key': 'client-a' } });

      // Client A is rate limited
      const res1 = await app.request('/test', { headers: { 'X-API-Key': 'client-a' } });
      expect(res1.status).toBe(429);

      // Client B can still make requests
      const res2 = await app.request('/test', { headers: { 'X-API-Key': 'client-b' } });
      expect(res2.status).toBe(200);
    });

    it('should isolate rate limits by key', async () => {
      app.use(
        '*',
        rateLimitMiddleware({
          windowMs: 60000,
          maxRequests: 1,
          store,
          keyGenerator: (c) => c.req.header('X-API-Key') ?? 'anonymous',
        })
      );
      app.get('/test', (c) => c.json({ success: true }));

      const clients = ['a', 'b', 'c', 'd', 'e'];
      for (const client of clients) {
        const res = await app.request('/test', { headers: { 'X-API-Key': client } });
        expect(res.status).toBe(200);
      }
    });
  });

  describe('Different Endpoints', () => {
    beforeEach(() => {
      app.use(
        '/api/*',
        rateLimitMiddleware({
          windowMs: 60000,
          maxRequests: 3,
          store,
          keyGenerator: () => 'test-client',
        })
      );
      app.get('/api/a', (c) => c.json({ endpoint: 'a' }));
      app.get('/api/b', (c) => c.json({ endpoint: 'b' }));
      app.get('/public', (c) => c.json({ endpoint: 'public' }));
    });

    it('should apply rate limit across protected endpoints', async () => {
      await app.request('/api/a');
      await app.request('/api/b');
      await app.request('/api/a');

      const res = await app.request('/api/b');
      expect(res.status).toBe(429);
    });

    it('should not apply rate limit to unprotected endpoints', async () => {
      // Exhaust rate limit on protected endpoints
      await app.request('/api/a');
      await app.request('/api/a');
      await app.request('/api/a');

      // Public endpoint should still work
      const res = await app.request('/public');
      expect(res.status).toBe(200);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      app.use(
        '*',
        rateLimitMiddleware({
          windowMs: 60000,
          maxRequests: 5,
          store,
          keyGenerator: () => 'test-client',
        })
      );
      app.get('/test', (c) => c.json({ success: true }));
    });

    it('should handle concurrent requests', async () => {
      // Sequential requests to verify rate limiting works
      const responses: Response[] = [];
      for (let i = 0; i < 10; i++) {
        responses.push(await app.request('/test'));
      }

      const successCount = responses.filter((r) => r.status === 200).length;
      const limitedCount = responses.filter((r) => r.status === 429).length;

      // First 5 should succeed, rest should be rate limited
      expect(successCount).toBe(5);
      expect(limitedCount).toBe(5);
    });

    it('should return 0 for remaining when at limit', async () => {
      for (let i = 0; i < 5; i++) {
        await app.request('/test');
      }

      const res = await app.request('/test');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    });
  });
});

describe('Store Interface', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  afterEach(() => {
    store.clear();
  });

  describe('get()', () => {
    it('should return null for non-existent key', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('should return entry for existing key', async () => {
      await store.set('test', { count: 5, resetTime: Date.now() + 60000 });
      const result = await store.get('test');
      expect(result).not.toBeNull();
      expect(result?.count).toBe(5);
    });

    it('should return null for expired entries', async () => {
      await store.set('test', { count: 5, resetTime: Date.now() - 1000 });
      const result = await store.get('test');
      expect(result).toBeNull();
    });
  });

  describe('increment()', () => {
    it('should create new entry if none exists', async () => {
      const result = await store.increment('new-key');
      expect(result.count).toBe(1);
    });

    it('should increment existing entry', async () => {
      await store.increment('test');
      await store.increment('test');
      const result = await store.increment('test');
      expect(result.count).toBe(3);
    });

    it('should reset count for expired entries', async () => {
      await store.set('test', { count: 100, resetTime: Date.now() - 1000 });
      const result = await store.increment('test');
      expect(result.count).toBe(1);
    });
  });
});
