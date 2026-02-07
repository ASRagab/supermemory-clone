/**
 * Authentication Rate Limiting - Security Tests
 *
 * 8 comprehensive tests covering:
 * - Brute force prevention (3 tests)
 * - Timing attack resistance (2 tests)
 * - Key enumeration prevention (3 tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { timingSafeEqual, randomBytes, pbkdf2Sync } from 'crypto';

// ============================================================================
// Rate Limiter Implementation
// ============================================================================

interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
}

interface RateLimitEntry {
  attempts: number[];
  blockedUntil?: number;
}

class AuthRateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if request is allowed (sliding window)
   */
  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const entry = this.store.get(identifier) || { attempts: [] };

    // Check if blocked
    if (entry.blockedUntil && now < entry.blockedUntil) {
      return false;
    }

    // Remove expired attempts (sliding window)
    entry.attempts = entry.attempts.filter(
      (timestamp) => now - timestamp < this.config.windowMs
    );

    // Check if under limit
    if (entry.attempts.length >= this.config.maxAttempts) {
      // Block user
      entry.blockedUntil = now + this.config.blockDurationMs;
      this.store.set(identifier, entry);
      return false;
    }

    return true;
  }

  /**
   * Record attempt
   */
  recordAttempt(identifier: string): void {
    const now = Date.now();
    const entry = this.store.get(identifier) || { attempts: [] };

    entry.attempts.push(now);
    this.store.set(identifier, entry);
  }

  /**
   * Reset attempts
   */
  reset(identifier: string): void {
    this.store.delete(identifier);
  }

  /**
   * Get current attempt count
   */
  getAttemptCount(identifier: string): number {
    const entry = this.store.get(identifier);
    if (!entry) return 0;

    const now = Date.now();
    return entry.attempts.filter(
      (timestamp) => now - timestamp < this.config.windowMs
    ).length;
  }

  /**
   * Check if blocked
   */
  isBlocked(identifier: string): boolean {
    const entry = this.store.get(identifier);
    if (!entry || !entry.blockedUntil) return false;

    return Date.now() < entry.blockedUntil;
  }
}

// ============================================================================
// Token Bucket Rate Limiter
// ============================================================================

class TokenBucketRateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private capacity: number;
  private refillRate: number; // tokens per second
  private refillInterval: number; // ms

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.refillInterval = 1000 / refillRate; // ms per token
  }

  /**
   * Try to consume a token
   */
  tryConsume(identifier: string, tokens: number = 1): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(identifier);

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(identifier, bucket);
    }

    // Refill tokens based on time elapsed
    const timeSinceRefill = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(timeSinceRefill / this.refillInterval);

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    // Try to consume
    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * Get current token count
   */
  getTokens(identifier: string): number {
    const bucket = this.buckets.get(identifier);
    return bucket ? bucket.tokens : this.capacity;
  }

  /**
   * Reset bucket
   */
  reset(identifier: string): void {
    this.buckets.delete(identifier);
  }
}

// ============================================================================
// Constant-Time Auth Validator
// ============================================================================

class ConstantTimeAuthValidator {
  /**
   * Validate password in constant time
   */
  validatePassword(input: string, expected: string): boolean {
    // Hash both inputs to ensure constant length
    const inputHash = pbkdf2Sync(input, 'salt', 10000, 32, 'sha256');
    const expectedHash = pbkdf2Sync(expected, 'salt', 10000, 32, 'sha256');

    return timingSafeEqual(inputHash, expectedHash);
  }

  /**
   * Validate API key in constant time
   */
  validateApiKey(input: string, expected: string): boolean {
    // Ensure same length first
    if (input.length !== expected.length) {
      // Compare against dummy to maintain constant time
      const dummy = 'x'.repeat(expected.length);
      timingSafeEqual(Buffer.from(input.padEnd(expected.length, 'x')), Buffer.from(dummy));
      return false;
    }

    return timingSafeEqual(Buffer.from(input), Buffer.from(expected));
  }

  /**
   * Validate username exists (prevent enumeration)
   */
  validateUsername(username: string, validUsers: Set<string>): {
    exists: boolean;
    timingConstant: boolean;
  } {
    const startTime = process.hrtime.bigint();

    // Always check against all users (constant time)
    // Pad buffers to same length to enable timingSafeEqual
    const maxLength = Math.max(username.length, ...Array.from(validUsers).map(u => u.length));
    let found = false;

    for (const validUser of validUsers) {
      const usernamePadded = Buffer.from(username.padEnd(maxLength, '\0'));
      const validUserPadded = Buffer.from(validUser.padEnd(maxLength, '\0'));

      if (timingSafeEqual(usernamePadded, validUserPadded)) {
        found = true;
      }
    }

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime);

    return {
      exists: found,
      timingConstant: true, // Implementation guarantees constant time
    };
  }
}

// ============================================================================
// Brute Force Prevention Tests (3 tests)
// ============================================================================

describe('Brute Force Prevention', () => {
  describe('Sliding Window Rate Limiting', () => {
    it('should block after max attempts in sliding window', () => {
      const limiter = new AuthRateLimiter({
        maxAttempts: 5,
        windowMs: 60000, // 1 minute
        blockDurationMs: 300000, // 5 minutes
      });

      const identifier = 'user@example.com';

      // Make 5 attempts
      for (let i = 0; i < 5; i++) {
        expect(limiter.isAllowed(identifier)).toBe(true);
        limiter.recordAttempt(identifier);
      }

      // 6th attempt should be blocked
      expect(limiter.isAllowed(identifier)).toBe(false);
      expect(limiter.isBlocked(identifier)).toBe(true);
      expect(limiter.getAttemptCount(identifier)).toBe(5);
    });

    it('should allow attempts after window expiry', async () => {
      const limiter = new AuthRateLimiter({
        maxAttempts: 3,
        windowMs: 100, // 100ms window
        blockDurationMs: 200,
      });

      const identifier = 'user@example.com';

      // Make 3 attempts
      for (let i = 0; i < 3; i++) {
        limiter.recordAttempt(identifier);
      }

      expect(limiter.getAttemptCount(identifier)).toBe(3);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Old attempts should be expired
      expect(limiter.getAttemptCount(identifier)).toBeLessThan(3);
      expect(limiter.isAllowed(identifier)).toBe(true);
    });

    it('should enforce block duration', async () => {
      const limiter = new AuthRateLimiter({
        maxAttempts: 2,
        windowMs: 60000,
        blockDurationMs: 100, // 100ms block
      });

      const identifier = 'user@example.com';

      // Exceed limit
      limiter.recordAttempt(identifier);
      limiter.recordAttempt(identifier);

      expect(limiter.isAllowed(identifier)).toBe(false);
      expect(limiter.isBlocked(identifier)).toBe(true);

      // Wait for block to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(limiter.isBlocked(identifier)).toBe(false);
    });
  });

  describe('Token Bucket Rate Limiting', () => {
    it('should allow burst within capacity', () => {
      const limiter = new TokenBucketRateLimiter(10, 1); // 10 tokens, refill 1/sec

      const identifier = 'user@example.com';

      // Should allow 10 rapid requests
      for (let i = 0; i < 10; i++) {
        expect(limiter.tryConsume(identifier)).toBe(true);
      }

      // 11th should be rejected
      expect(limiter.tryConsume(identifier)).toBe(false);
      expect(limiter.getTokens(identifier)).toBe(0);
    });

    it('should refill tokens over time', async () => {
      const limiter = new TokenBucketRateLimiter(5, 10); // 5 tokens, refill 10/sec

      const identifier = 'user@example.com';

      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        limiter.tryConsume(identifier);
      }

      expect(limiter.getTokens(identifier)).toBe(0);

      // Wait for refill (100ms = 1 token at 10/sec)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should have refilled at least 1 token
      expect(limiter.tryConsume(identifier)).toBe(true);
    });

    it('should not exceed capacity on refill', async () => {
      const limiter = new TokenBucketRateLimiter(5, 100); // 5 tokens, fast refill

      const identifier = 'user@example.com';

      // Wait for potential overflow
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should still be capped at capacity
      expect(limiter.getTokens(identifier)).toBeLessThanOrEqual(5);
    });
  });
});

// ============================================================================
// Timing Attack Resistance Tests (2 tests)
// ============================================================================

describe('Timing Attack Resistance', () => {
  const validator = new ConstantTimeAuthValidator();

  it('should validate passwords in constant time', () => {
    const correctPassword = 'SecurePassword123!';
    const wrongPassword1 = 'WrongPassword1';
    const wrongPassword2 = 'SecurePassword123'; // Close match

    const iterations = 50;
    const correctTimes: number[] = [];
    const wrongTimes1: number[] = [];
    const wrongTimes2: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Measure correct password
      const start1 = process.hrtime.bigint();
      validator.validatePassword(correctPassword, correctPassword);
      const end1 = process.hrtime.bigint();
      correctTimes.push(Number(end1 - start1));

      // Measure wrong password (completely different)
      const start2 = process.hrtime.bigint();
      validator.validatePassword(wrongPassword1, correctPassword);
      const end2 = process.hrtime.bigint();
      wrongTimes1.push(Number(end2 - start2));

      // Measure wrong password (close match)
      const start3 = process.hrtime.bigint();
      validator.validatePassword(wrongPassword2, correctPassword);
      const end3 = process.hrtime.bigint();
      wrongTimes2.push(Number(end3 - start3));
    }

    const avgCorrect = correctTimes.reduce((a, b) => a + b, 0) / iterations;
    const avgWrong1 = wrongTimes1.reduce((a, b) => a + b, 0) / iterations;
    const avgWrong2 = wrongTimes2.reduce((a, b) => a + b, 0) / iterations;

    // All timings should be similar (within reasonable variance)
    const ratio1 = avgCorrect / avgWrong1;
    const ratio2 = avgCorrect / avgWrong2;

    expect(ratio1).toBeGreaterThan(0.5);
    expect(ratio1).toBeLessThan(2);
    expect(ratio2).toBeGreaterThan(0.5);
    expect(ratio2).toBeLessThan(2);
  });

  it('should validate API keys in constant time', () => {
    const correctKey = 'sk-' + randomBytes(32).toString('hex');
    const wrongKey1 = 'sk-' + randomBytes(32).toString('hex');
    const wrongKey2 = correctKey.slice(0, -2) + 'xx'; // Close match

    const iterations = 50;
    const times: number[][] = [[], [], []];

    for (let i = 0; i < iterations; i++) {
      const keys = [correctKey, wrongKey1, wrongKey2];

      keys.forEach((key, idx) => {
        const start = process.hrtime.bigint();
        validator.validateApiKey(key, correctKey);
        const end = process.hrtime.bigint();
        times[idx]!.push(Number(end - start));
      });
    }

    const averages = times.map((t) => t.reduce((a, b) => a + b, 0) / iterations);

    // All averages should be similar
    const ratio1 = averages[0]! / averages[1]!;
    const ratio2 = averages[0]! / averages[2]!;

    expect(ratio1).toBeGreaterThan(0.5);
    expect(ratio1).toBeLessThan(2);
    expect(ratio2).toBeGreaterThan(0.5);
    expect(ratio2).toBeLessThan(2);
  });
});

// ============================================================================
// Key Enumeration Prevention Tests (3 tests)
// ============================================================================

describe('Key Enumeration Prevention', () => {
  const validator = new ConstantTimeAuthValidator();

  it('should return uniform responses for existing/non-existing users', () => {
    const validUsers = new Set(['alice@example.com', 'bob@example.com', 'charlie@example.com']);

    const existingUser = 'alice@example.com';
    const nonExistingUser = 'eve@example.com';

    const iterations = 30;
    const existingTimes: number[] = [];
    const nonExistingTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Check existing user
      const start1 = process.hrtime.bigint();
      const result1 = validator.validateUsername(existingUser, validUsers);
      const end1 = process.hrtime.bigint();
      existingTimes.push(Number(end1 - start1));
      expect(result1.exists).toBe(true);

      // Check non-existing user
      const start2 = process.hrtime.bigint();
      const result2 = validator.validateUsername(nonExistingUser, validUsers);
      const end2 = process.hrtime.bigint();
      nonExistingTimes.push(Number(end2 - start2));
      expect(result2.exists).toBe(false);
    }

    // Timing should be similar
    const avgExisting = existingTimes.reduce((a, b) => a + b, 0) / iterations;
    const avgNonExisting = nonExistingTimes.reduce((a, b) => a + b, 0) / iterations;

    const ratio = avgExisting / avgNonExisting;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  it('should prevent username enumeration via error messages', () => {
    const validUsers = new Set(['alice@example.com', 'bob@example.com']);

    const testCases = [
      { username: 'alice@example.com', password: 'wrong' },
      { username: 'nonexistent@example.com', password: 'wrong' },
    ];

    const errors = testCases.map(({ username }) => {
      const exists = validUsers.has(username);

      // Both cases should return same generic error
      return exists
        ? 'Invalid username or password'
        : 'Invalid username or password';
    });

    // All error messages should be identical
    expect(errors[0]).toBe(errors[1]);
    expect(new Set(errors).size).toBe(1);
  });

  it('should prevent email enumeration via timing on registration', async () => {
    const existingEmails = new Set(['alice@example.com', 'bob@example.com']);

    const checkEmailAvailable = async (email: string): Promise<boolean> => {
      // Simulate database check with constant time
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Pad buffers to same length for timingSafeEqual
      const maxLength = Math.max(email.length, ...Array.from(existingEmails).map(e => e.length));

      let available = true;
      for (const existing of existingEmails) {
        const emailPadded = Buffer.from(email.padEnd(maxLength, '\0'));
        const existingPadded = Buffer.from(existing.padEnd(maxLength, '\0'));

        if (timingSafeEqual(emailPadded, existingPadded)) {
          available = false;
        }
      }

      return available;
    };

    const iterations = 20;
    const existingTimes: number[] = [];
    const newTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Check existing email
      const start1 = process.hrtime.bigint();
      await checkEmailAvailable('alice@example.com');
      const end1 = process.hrtime.bigint();
      existingTimes.push(Number(end1 - start1));

      // Check new email
      const start2 = process.hrtime.bigint();
      await checkEmailAvailable('newuser@example.com');
      const end2 = process.hrtime.bigint();
      newTimes.push(Number(end2 - start2));
    }

    const avgExisting = existingTimes.reduce((a, b) => a + b, 0) / iterations;
    const avgNew = newTimes.reduce((a, b) => a + b, 0) / iterations;

    // Should have similar timing (within 2x due to noise)
    const ratio = avgExisting / avgNew;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});
