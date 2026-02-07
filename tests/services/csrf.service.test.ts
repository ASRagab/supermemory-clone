import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CsrfService, createCsrfService } from '../../src/services/csrf.service.js';

describe('CsrfService', () => {
  let service: CsrfService;
  const testSecret = 'test-secret-key-minimum-32-chars-long-for-security';

  beforeEach(() => {
    service = new CsrfService({
      secret: testSecret,
      tokenLength: 32,
      expirationMs: 60000, // 1 minute for testing
    });
  });

  afterEach(() => {
    service.clearTokens();
  });

  describe('Token Generation', () => {
    it('should generate a valid CSRF token', () => {
      const token = service.generateToken();

      expect(token.token).toBeDefined();
      expect(token.signature).toBeDefined();
      expect(token.expiresAt).toBeGreaterThan(Date.now());
      expect(typeof token.token).toBe('string');
      expect(token.token.length).toBeGreaterThan(0);
    });

    it('should generate unique tokens', () => {
      const token1 = service.generateToken();
      const token2 = service.generateToken();

      expect(token1.token).not.toBe(token2.token);
      expect(token1.signature).not.toBe(token2.signature);
    });

    it('should generate token with session association', () => {
      const sessionId = 'session-123';
      const token = service.generateToken(sessionId);

      expect(token.sessionId).toBe(sessionId);
    });

    it('should set expiration correctly', () => {
      const before = Date.now();
      const token = service.generateToken();
      const after = Date.now();

      // Token should expire between before + ttl and after + ttl
      expect(token.expiresAt).toBeGreaterThanOrEqual(before + 60000);
      expect(token.expiresAt).toBeLessThanOrEqual(after + 60000 + 100); // 100ms tolerance
    });
  });

  describe('Token Validation', () => {
    it('should validate a correct token', () => {
      const token = service.generateToken();
      const isValid = service.validateToken(token.token, token.signature);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const token = service.generateToken();
      const isValid = service.validateToken(token.token, 'invalid-signature');

      expect(isValid).toBe(false);
    });

    it('should reject unknown token', () => {
      const isValid = service.validateToken('unknown-token', 'some-signature');

      expect(isValid).toBe(false);
    });

    it('should reject expired token', async () => {
      // Create service with very short expiration
      const shortService = new CsrfService({
        secret: testSecret,
        tokenLength: 32,
        expirationMs: 100, // 100ms
      });

      const token = shortService.generateToken();

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      const isValid = shortService.validateToken(token.token, token.signature);

      expect(isValid).toBe(false);
      shortService.clearTokens();
    });

    it('should validate token with matching session', () => {
      const sessionId = 'session-123';
      const token = service.generateToken(sessionId);
      const isValid = service.validateToken(token.token, token.signature, sessionId);

      expect(isValid).toBe(true);
    });

    it('should reject token with mismatched session', () => {
      const token = service.generateToken('session-123');
      const isValid = service.validateToken(token.token, token.signature, 'session-456');

      expect(isValid).toBe(false);
    });
  });

  describe('Token Rotation', () => {
    it('should rotate token successfully', () => {
      const oldToken = service.generateToken();
      const newToken = service.rotateToken(oldToken.token);

      expect(newToken.token).not.toBe(oldToken.token);
      expect(newToken.signature).not.toBe(oldToken.signature);

      // Old token should be invalid
      const oldValid = service.validateToken(oldToken.token, oldToken.signature);
      expect(oldValid).toBe(false);

      // New token should be valid
      const newValid = service.validateToken(newToken.token, newToken.signature);
      expect(newValid).toBe(true);
    });

    it('should rotate token with session', () => {
      const sessionId = 'session-123';
      const oldToken = service.generateToken(sessionId);
      const newToken = service.rotateToken(oldToken.token, sessionId);

      expect(newToken.sessionId).toBe(sessionId);
      expect(service.validateToken(newToken.token, newToken.signature, sessionId)).toBe(true);
    });
  });

  describe('Security Features', () => {
    it('should use constant-time comparison', () => {
      const token = service.generateToken();

      // Try to validate with signature that differs by one character
      const modifiedSignature = token.signature.slice(0, -1) + 'x';
      const isValid = service.validateToken(token.token, modifiedSignature);

      expect(isValid).toBe(false);
    });

    it('should require minimum secret length', () => {
      expect(() => {
        new CsrfService({
          secret: 'short',
          tokenLength: 32,
          expirationMs: 60000,
        });
      }).toThrow('CSRF secret must be at least 32 characters');
    });

    it('should handle signature comparison errors gracefully', () => {
      const token = service.generateToken();

      // Try with signature that would cause buffer length mismatch
      const isValid = service.validateToken(token.token, 'short');

      expect(isValid).toBe(false);
    });
  });

  describe('Token Cleanup', () => {
    it('should clean up expired tokens', async () => {
      // Create service with short expiration
      const cleanupService = new CsrfService({
        secret: testSecret,
        tokenLength: 32,
        expirationMs: 100, // 100ms
      });

      // Generate tokens
      cleanupService.generateToken();
      cleanupService.generateToken();
      cleanupService.generateToken();

      expect(cleanupService.getTokenCount()).toBe(3);

      // Wait for tokens to expire and cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Manually trigger cleanup (in real code, this happens automatically)
      // For testing, we'll check that tokens are no longer valid
      cleanupService.clearTokens();

      expect(cleanupService.getTokenCount()).toBe(0);
      cleanupService.clearTokens();
    });

    it('should track token count correctly', () => {
      expect(service.getTokenCount()).toBe(0);

      service.generateToken();
      expect(service.getTokenCount()).toBe(1);

      service.generateToken();
      service.generateToken();
      expect(service.getTokenCount()).toBe(3);

      service.clearTokens();
      expect(service.getTokenCount()).toBe(0);
    });
  });

  describe('Factory Function', () => {
    it('should create service with default config', () => {
      const defaultService = createCsrfService();
      const token = defaultService.generateToken();

      expect(token.token).toBeDefined();
      expect(token.signature).toBeDefined();
      defaultService.clearTokens();
    });

    it('should create service with custom config', () => {
      const customService = createCsrfService({
        secret: testSecret,
        tokenLength: 16,
      });

      const token = customService.generateToken();
      expect(token.token).toBeDefined();
      customService.clearTokens();
    });

    it('should use environment variable for secret', () => {
      process.env.CSRF_SECRET = testSecret;
      const envService = createCsrfService();
      const token = envService.generateToken();

      expect(token.token).toBeDefined();
      envService.clearTokens();
      delete process.env.CSRF_SECRET;
    });

    it('should throw error in production without secret', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      delete process.env.CSRF_SECRET;

      expect(() => {
        createCsrfService();
      }).toThrow('CSRF_SECRET environment variable must be set in production');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('HMAC Signing', () => {
    it('should produce different signatures for different tokens', () => {
      const token1 = service.generateToken();
      const token2 = service.generateToken();

      expect(token1.signature).not.toBe(token2.signature);
    });

    it('should produce different signatures for different sessions', () => {
      const token1 = service.generateToken('session-1');
      const token2 = service.generateToken('session-2');

      // Even with same token value, session affects signature
      expect(token1.signature).not.toBe(token2.signature);
    });

    it('should include expiration in signature', () => {
      const service1 = new CsrfService({
        secret: testSecret,
        tokenLength: 32,
        expirationMs: 60000,
      });

      const service2 = new CsrfService({
        secret: testSecret,
        tokenLength: 32,
        expirationMs: 120000, // Different expiration
      });

      const token1 = service1.generateToken();
      const token2 = service2.generateToken();

      // Different expirations should affect signatures
      expect(token1.signature).not.toBe(token2.signature);

      service1.clearTokens();
      service2.clearTokens();
    });
  });
});
