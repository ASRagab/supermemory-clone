/**
 * CSRF Protection Middleware - Unit Tests
 *
 * Comprehensive tests for CSRF token generation, validation, and protection.
 * Part of CSRF Protection Test Suite (80+ tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono, Context, Next } from 'hono';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// ============================================================================
// CSRF Middleware Implementation (for testing)
// ============================================================================

interface CsrfConfig {
  secret: string;
  tokenLength?: number;
  cookieName?: string;
  headerName?: string;
  safeMethods?: string[];
  checkOrigin?: boolean;
  checkReferer?: boolean;
  exemptPaths?: string[];
}

interface CsrfToken {
  value: string;
  signature: string;
  timestamp: number;
}

/**
 * Generate cryptographically secure CSRF token
 */
function generateCsrfToken(secret: string, tokenLength: number = 32): CsrfToken {
  const value = randomBytes(tokenLength).toString('hex');
  const timestamp = Date.now();
  const data = `${value}.${timestamp}`;
  const signature = createHmac('sha256', secret).update(data).digest('hex');

  return { value, signature, timestamp };
}

/**
 * Sign a CSRF token value
 */
function signToken(value: string, timestamp: number, secret: string): string {
  const data = `${value}.${timestamp}`;
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Verify CSRF token signature using constant-time comparison
 */
function verifyToken(
  value: string,
  signature: string,
  timestamp: number,
  secret: string,
  maxAge: number = 3600000 // 1 hour
): boolean {
  // Check timestamp expiry
  if (Date.now() - timestamp > maxAge) {
    return false;
  }

  // Verify signature with constant-time comparison
  const expectedSignature = signToken(value, timestamp, secret);
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

/**
 * Parse CSRF token from cookie or header
 */
function parseToken(tokenString: string): { value: string; signature: string; timestamp: number } | null {
  const parts = tokenString.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [value, timestamp, signature] = parts;

  // Reject tokens with empty parts
  if (!value || !timestamp || !signature) {
    return null;
  }

  const timestampNum = parseInt(timestamp, 10);

  if (isNaN(timestampNum)) {
    return null;
  }

  return { value, signature, timestamp: timestampNum };
}

/**
 * Validate origin header against request origin
 */
function validateOrigin(origin: string | undefined, host: string): boolean {
  if (!origin) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    const expectedHost = host.split(':')[0]; // Remove port for comparison
    const originHost = originUrl.hostname;

    return originHost === expectedHost || originHost === `www.${expectedHost}`;
  } catch {
    return false;
  }
}

/**
 * Validate referer header against request host
 */
function validateReferer(referer: string | undefined, host: string): boolean {
  if (!referer) {
    return false;
  }

  try {
    const refererUrl = new URL(referer);
    const expectedHost = host.split(':')[0];
    const refererHost = refererUrl.hostname;

    return refererHost === expectedHost || refererHost === `www.${expectedHost}`;
  } catch {
    return false;
  }
}

/**
 * CSRF Protection Middleware
 */
function csrfMiddleware(config: CsrfConfig) {
  const {
    secret,
    tokenLength = 32,
    cookieName = 'csrf-token',
    headerName = 'x-csrf-token',
    safeMethods = ['GET', 'HEAD', 'OPTIONS'],
    checkOrigin = true,
    checkReferer = true,
    exemptPaths = [],
  } = config;

  return async (c: Context, next: Next) => {
    const method = c.req.method;
    const path = c.req.path;

    // Skip CSRF check for exempt paths
    if (exemptPaths.some((p) => path.startsWith(p))) {
      return next();
    }

    // Safe methods don't need CSRF protection
    if (safeMethods.includes(method)) {
      return next();
    }

    // Get token from cookie and header
    const cookieToken = c.req.header('Cookie')?.match(new RegExp(`${cookieName}=([^;]+)`))?.[1];
    const headerToken = c.req.header(headerName);

    if (!cookieToken || !headerToken) {
      return c.json(
        { error: { code: 'CSRF_TOKEN_MISSING', message: 'CSRF token missing' } },
        403
      );
    }

    // Parse tokens
    const parsedCookie = parseToken(cookieToken);
    const parsedHeader = parseToken(headerToken);

    if (!parsedCookie || !parsedHeader) {
      return c.json(
        { error: { code: 'CSRF_TOKEN_INVALID', message: 'CSRF token malformed' } },
        403
      );
    }

    // Verify signatures
    const cookieValid = verifyToken(
      parsedCookie.value,
      parsedCookie.signature,
      parsedCookie.timestamp,
      secret
    );
    const headerValid = verifyToken(
      parsedHeader.value,
      parsedHeader.signature,
      parsedHeader.timestamp,
      secret
    );

    if (!cookieValid || !headerValid) {
      return c.json(
        { error: { code: 'CSRF_TOKEN_INVALID', message: 'CSRF token invalid or expired' } },
        403
      );
    }

    // Double-submit cookie pattern: tokens must match
    if (parsedCookie.value !== parsedHeader.value) {
      return c.json(
        { error: { code: 'CSRF_TOKEN_MISMATCH', message: 'CSRF token mismatch' } },
        403
      );
    }

    // Validate origin if enabled
    if (checkOrigin) {
      const origin = c.req.header('Origin');
      const host = c.req.header('Host') || '';

      if (origin && !validateOrigin(origin, host)) {
        return c.json(
          { error: { code: 'ORIGIN_MISMATCH', message: 'Origin validation failed' } },
          403
        );
      }
    }

    // Validate referer if enabled
    if (checkReferer) {
      const referer = c.req.header('Referer');
      const host = c.req.header('Host') || '';

      if (referer && !validateReferer(referer, host)) {
        return c.json(
          { error: { code: 'REFERER_MISMATCH', message: 'Referer validation failed' } },
          403
        );
      }
    }

    return next();
  };
}

// ============================================================================
// Token Generation Tests
// ============================================================================

describe('CSRF Token Generation', () => {
  const secret = 'test-secret-key-32-bytes-long!!';

  describe('Token Format', () => {
    it('should generate token with value, signature, and timestamp', () => {
      const token = generateCsrfToken(secret);

      expect(token).toHaveProperty('value');
      expect(token).toHaveProperty('signature');
      expect(token).toHaveProperty('timestamp');
    });

    it('should generate hex-encoded token value', () => {
      const token = generateCsrfToken(secret);

      expect(token.value).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate token with correct length', () => {
      const token = generateCsrfToken(secret, 32);

      // 32 bytes = 64 hex characters
      expect(token.value).toHaveLength(64);
    });

    it('should generate token with custom length', () => {
      const token = generateCsrfToken(secret, 16);

      expect(token.value).toHaveLength(32); // 16 bytes = 32 hex
    });

    it('should generate SHA-256 HMAC signature', () => {
      const token = generateCsrfToken(secret);

      // SHA-256 = 64 hex characters
      expect(token.signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should include current timestamp', () => {
      const before = Date.now();
      const token = generateCsrfToken(secret);
      const after = Date.now();

      expect(token.timestamp).toBeGreaterThanOrEqual(before);
      expect(token.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('Token Uniqueness', () => {
    it('should generate unique tokens on each call', () => {
      const token1 = generateCsrfToken(secret);
      const token2 = generateCsrfToken(secret);

      expect(token1.value).not.toBe(token2.value);
      expect(token1.signature).not.toBe(token2.signature);
    });

    it('should generate 100 unique tokens', () => {
      const tokens = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const token = generateCsrfToken(secret);
        tokens.add(token.value);
      }

      expect(tokens.size).toBe(100);
    });
  });

  describe('Token Entropy', () => {
    it('should generate cryptographically random tokens', () => {
      const tokens = Array.from({ length: 10 }, () => generateCsrfToken(secret));

      // Check that tokens are different
      const values = tokens.map((t) => t.value);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(10);
    });

    it('should have sufficient entropy (no patterns)', () => {
      const token = generateCsrfToken(secret);

      // Should not be all zeros or all ones
      expect(token.value).not.toMatch(/^0+$/);
      expect(token.value).not.toMatch(/^f+$/);

      // Should have variety of characters
      const chars = new Set(token.value.split(''));
      expect(chars.size).toBeGreaterThan(4);
    });
  });

  describe('Token Signing', () => {
    it('should sign token consistently', () => {
      const value = 'test-value';
      const timestamp = Date.now();

      const sig1 = signToken(value, timestamp, secret);
      const sig2 = signToken(value, timestamp, secret);

      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different values', () => {
      const timestamp = Date.now();

      const sig1 = signToken('value1', timestamp, secret);
      const sig2 = signToken('value2', timestamp, secret);

      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different timestamps', () => {
      const value = 'test-value';

      const sig1 = signToken(value, Date.now(), secret);
      const sig2 = signToken(value, Date.now() + 1000, secret);

      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures with different secrets', () => {
      const value = 'test-value';
      const timestamp = Date.now();

      const sig1 = signToken(value, timestamp, 'secret1');
      const sig2 = signToken(value, timestamp, 'secret2');

      expect(sig1).not.toBe(sig2);
    });
  });
});

// ============================================================================
// Token Validation Tests
// ============================================================================

describe('CSRF Token Validation', () => {
  const secret = 'test-secret-key-32-bytes-long!!';

  describe('Valid Token', () => {
    it('should verify valid token', () => {
      const token = generateCsrfToken(secret);
      const isValid = verifyToken(token.value, token.signature, token.timestamp, secret);

      expect(isValid).toBe(true);
    });

    it('should verify token within max age', () => {
      const token = generateCsrfToken(secret);
      const isValid = verifyToken(token.value, token.signature, token.timestamp, secret, 10000);

      expect(isValid).toBe(true);
    });
  });

  describe('Invalid Token', () => {
    it('should reject token with wrong signature', () => {
      const token = generateCsrfToken(secret);
      const wrongSignature = 'a'.repeat(64);

      const isValid = verifyToken(token.value, wrongSignature, token.timestamp, secret);

      expect(isValid).toBe(false);
    });

    it('should reject token with tampered value', () => {
      const token = generateCsrfToken(secret);
      const tamperedValue = token.value.slice(0, -2) + 'ff';

      const isValid = verifyToken(tamperedValue, token.signature, token.timestamp, secret);

      expect(isValid).toBe(false);
    });

    it('should reject token with wrong secret', () => {
      const token = generateCsrfToken(secret);
      const wrongSecret = 'wrong-secret-key';

      const isValid = verifyToken(token.value, token.signature, token.timestamp, wrongSecret);

      expect(isValid).toBe(false);
    });

    it('should reject token with mismatched signature length', () => {
      const token = generateCsrfToken(secret);
      const shortSignature = token.signature.slice(0, 32);

      const isValid = verifyToken(token.value, shortSignature, token.timestamp, secret);

      expect(isValid).toBe(false);
    });
  });

  describe('Expired Token', () => {
    it('should reject expired token', () => {
      const token = generateCsrfToken(secret);
      const oldTimestamp = Date.now() - 7200000; // 2 hours ago

      const isValid = verifyToken(token.value, token.signature, oldTimestamp, secret, 3600000);

      expect(isValid).toBe(false);
    });

    it('should accept token just before expiry', () => {
      const timestamp = Date.now() - 3599000; // 59 minutes 59 seconds ago
      const value = 'test-value';
      const signature = signToken(value, timestamp, secret);

      const isValid = verifyToken(value, signature, timestamp, secret, 3600000);

      expect(isValid).toBe(true);
    });

    it('should reject token just after expiry', () => {
      const timestamp = Date.now() - 3601000; // 1 hour 1 second ago
      const value = 'test-value';
      const signature = signToken(value, timestamp, secret);

      const isValid = verifyToken(value, signature, timestamp, secret, 3600000);

      expect(isValid).toBe(false);
    });
  });

  describe('Constant-Time Comparison', () => {
    it('should use timing-safe comparison', () => {
      const token = generateCsrfToken(secret);

      // Measure time for correct signature
      const start1 = process.hrtime.bigint();
      verifyToken(token.value, token.signature, token.timestamp, secret);
      const end1 = process.hrtime.bigint();
      const time1 = Number(end1 - start1);

      // Measure time for incorrect signature (same length)
      const wrongSig = 'a'.repeat(64);
      const start2 = process.hrtime.bigint();
      verifyToken(token.value, wrongSig, token.timestamp, secret);
      const end2 = process.hrtime.bigint();
      const time2 = Number(end2 - start2);

      // Times should be similar (within 10x factor due to noise)
      const ratio = time1 / time2;
      expect(ratio).toBeGreaterThan(0.1);
      expect(ratio).toBeLessThan(10);
    });
  });
});

// ============================================================================
// Token Parsing Tests
// ============================================================================

describe('CSRF Token Parsing', () => {
  it('should parse valid token string', () => {
    const tokenString = 'abc123.1234567890.def456';
    const parsed = parseToken(tokenString);

    expect(parsed).not.toBeNull();
    expect(parsed?.value).toBe('abc123');
    expect(parsed?.timestamp).toBe(1234567890);
    expect(parsed?.signature).toBe('def456');
  });

  it('should reject token with wrong number of parts', () => {
    expect(parseToken('abc')).toBeNull();
    expect(parseToken('abc.123')).toBeNull();
    expect(parseToken('abc.123.def.ghi')).toBeNull();
  });

  it('should reject token with invalid timestamp', () => {
    expect(parseToken('abc.notanumber.def')).toBeNull();
    expect(parseToken('abc.12.34.def')).toBeNull();
  });

  it('should reject tokens with empty parts', () => {
    expect(parseToken('..def')).toBeNull(); // Empty value and timestamp
    expect(parseToken('abc.123.')).toBeNull(); // Empty signature
    expect(parseToken('.123.def')).toBeNull(); // Empty value
  });
});

// ============================================================================
// Origin Validation Tests
// ============================================================================

describe('Origin Validation', () => {
  it('should accept matching origin', () => {
    expect(validateOrigin('https://example.com', 'example.com')).toBe(true);
    expect(validateOrigin('http://localhost:3000', 'localhost')).toBe(true);
  });

  it('should accept www subdomain', () => {
    expect(validateOrigin('https://www.example.com', 'example.com')).toBe(true);
  });

  it('should reject different origin', () => {
    expect(validateOrigin('https://evil.com', 'example.com')).toBe(false);
  });

  it('should reject missing origin', () => {
    expect(validateOrigin(undefined, 'example.com')).toBe(false);
  });

  it('should reject malformed origin', () => {
    expect(validateOrigin('not-a-url', 'example.com')).toBe(false);
    expect(validateOrigin('javascript:alert(1)', 'example.com')).toBe(false);
  });

  it('should handle origin with port', () => {
    expect(validateOrigin('https://example.com:8080', 'example.com:8080')).toBe(true);
  });
});

// ============================================================================
// Referer Validation Tests
// ============================================================================

describe('Referer Validation', () => {
  it('should accept matching referer', () => {
    expect(validateReferer('https://example.com/page', 'example.com')).toBe(true);
    expect(validateReferer('http://localhost:3000/test', 'localhost')).toBe(true);
  });

  it('should accept www subdomain', () => {
    expect(validateReferer('https://www.example.com/page', 'example.com')).toBe(true);
  });

  it('should reject different referer', () => {
    expect(validateReferer('https://evil.com/page', 'example.com')).toBe(false);
  });

  it('should reject missing referer', () => {
    expect(validateReferer(undefined, 'example.com')).toBe(false);
  });

  it('should reject malformed referer', () => {
    expect(validateReferer('not-a-url', 'example.com')).toBe(false);
  });

  it('should handle referer with path and query', () => {
    expect(validateReferer('https://example.com/path?query=value', 'example.com')).toBe(true);
  });
});

// ============================================================================
// Middleware Integration Tests
// ============================================================================

describe('CSRF Middleware', () => {
  const secret = 'test-secret-key-32-bytes-long!!';
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  describe('Safe Methods', () => {
    it('should allow GET requests without CSRF token', async () => {
      app.use('*', csrfMiddleware({ secret }));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test');

      expect(res.status).toBe(200);
    });

    it('should allow HEAD requests without CSRF token', async () => {
      app.use('*', csrfMiddleware({ secret }));
      app.get('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test', { method: 'HEAD' });

      expect(res.status).toBe(200);
    });

    it('should allow OPTIONS requests without CSRF token', async () => {
      app.use('*', csrfMiddleware({ secret }));
      app.all('/test', (c) => c.json({ success: true }));

      const res = await app.request('/test', { method: 'OPTIONS' });

      expect(res.status).toBe(200);
    });
  });

  describe('Unsafe Methods', () => {
    beforeEach(() => {
      app.use('*', csrfMiddleware({ secret }));
      app.post('/test', (c) => c.json({ success: true }));
    });

    it('should reject POST without CSRF token', async () => {
      const res = await app.request('/test', { method: 'POST' });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('CSRF_TOKEN_MISSING');
    });

    it('should accept POST with valid CSRF token', async () => {
      const token = generateCsrfToken(secret);
      const tokenString = `${token.value}.${token.timestamp}.${token.signature}`;

      const res = await app.request('/test', {
        method: 'POST',
        headers: {
          Cookie: `csrf-token=${tokenString}`,
          'x-csrf-token': tokenString,
          Host: 'example.com',
        },
      });

      expect(res.status).toBe(200);
    });

    it('should reject POST with mismatched tokens', async () => {
      const token1 = generateCsrfToken(secret);
      const token2 = generateCsrfToken(secret);

      const tokenString1 = `${token1.value}.${token1.timestamp}.${token1.signature}`;
      const tokenString2 = `${token2.value}.${token2.timestamp}.${token2.signature}`;

      const res = await app.request('/test', {
        method: 'POST',
        headers: {
          Cookie: `csrf-token=${tokenString1}`,
          'x-csrf-token': tokenString2,
        },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('CSRF_TOKEN_MISMATCH');
    });
  });

  describe('Exempt Paths', () => {
    it('should skip CSRF check for exempt paths', async () => {
      app.use('*', csrfMiddleware({ secret, exemptPaths: ['/api/webhook'] }));
      app.post('/api/webhook', (c) => c.json({ success: true }));

      const res = await app.request('/api/webhook', { method: 'POST' });

      expect(res.status).toBe(200);
    });

    it('should require CSRF for non-exempt paths', async () => {
      app.use('*', csrfMiddleware({ secret, exemptPaths: ['/api/webhook'] }));
      app.post('/api/user', (c) => c.json({ success: true }));

      const res = await app.request('/api/user', { method: 'POST' });

      expect(res.status).toBe(403);
    });
  });

  describe('Custom Configuration', () => {
    it('should use custom cookie name', async () => {
      app.use('*', csrfMiddleware({ secret, cookieName: 'custom-csrf' }));
      app.post('/test', (c) => c.json({ success: true }));

      const token = generateCsrfToken(secret);
      const tokenString = `${token.value}.${token.timestamp}.${token.signature}`;

      const res = await app.request('/test', {
        method: 'POST',
        headers: {
          Cookie: `custom-csrf=${tokenString}`,
          'x-csrf-token': tokenString,
          Host: 'example.com',
        },
      });

      expect(res.status).toBe(200);
    });

    it('should use custom header name', async () => {
      app.use('*', csrfMiddleware({ secret, headerName: 'x-custom-csrf' }));
      app.post('/test', (c) => c.json({ success: true }));

      const token = generateCsrfToken(secret);
      const tokenString = `${token.value}.${token.timestamp}.${token.signature}`;

      const res = await app.request('/test', {
        method: 'POST',
        headers: {
          Cookie: `csrf-token=${tokenString}`,
          'x-custom-csrf': tokenString,
          Host: 'example.com',
        },
      });

      expect(res.status).toBe(200);
    });
  });
});
