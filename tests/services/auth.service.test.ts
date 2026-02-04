/**
 * Auth Service Tests
 *
 * Tests for API key generation, validation, and management.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { getPostgresDatabase } from '../../src/db/postgres.js';
import { apiKeys } from '../../src/db/schema/api-keys.schema.js';

// Get database instance for tests
const getDatabaseUrl = () => process.env.TEST_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://supermemory:supermemory_secret@localhost:5432/supermemory';
const db = getPostgresDatabase(getDatabaseUrl());
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  createApiKey,
  validateApiKey,
  revokeApiKey,
  rotateApiKey,
  listApiKeys,
  getApiKeyById,
  hasScope,
  updateApiKeyScopes,
} from '../../src/services/auth.service.js';
import { eq, inArray } from 'drizzle-orm';

// Track all API keys created in this test file for cleanup
const createdKeyIds: string[] = [];

// Wrapper to track created keys
async function createTrackedApiKey(options: Parameters<typeof createApiKey>[0]) {
  const result = await createApiKey(options);
  createdKeyIds.push(result.apiKey.id);
  return result;
}

describe('Auth Service', () => {
  // Clean up all keys before the test suite runs (handles leftover keys from crashed tests)
  beforeAll(async () => {
    await db.delete(apiKeys);
  });

  // Clean up only keys created by this test file (not global delete)
  afterEach(async () => {
    if (createdKeyIds.length > 0) {
      await db.delete(apiKeys).where(inArray(apiKeys.id, createdKeyIds));
      createdKeyIds.length = 0;
    }
  });

  describe('generateApiKey', () => {
    it('should generate a key with correct prefix', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^sk-mem_[A-Za-z0-9_-]+$/);
    });

    it('should generate unique keys', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });

    it('should generate keys with sufficient entropy', () => {
      const key = generateApiKey();
      // sk-mem_ (7 chars) + base64url(32 bytes) ≈ 50+ chars
      expect(key.length).toBeGreaterThan(40);
    });
  });

  describe('hashApiKey and verifyApiKey', () => {
    it('should hash and verify a key', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);

      expect(hash).not.toBe(key);
      expect(hash.length).toBeGreaterThan(50); // Bcrypt hashes are 60 chars

      const isValid = await verifyApiKey(key, hash);
      expect(isValid).toBe(true);
    });

    it('should reject invalid keys', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);

      const isValid = await verifyApiKey('wrong-key', hash);
      expect(isValid).toBe(false);
    });

    it('should use bcrypt cost factor 10+', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);

      // Bcrypt hashes start with $2b$XX$ where XX is the cost factor
      const costMatch = hash.match(/^\$2[aby]\$(\d+)\$/);
      expect(costMatch).toBeTruthy();
      const cost = parseInt(costMatch![1]!, 10);
      expect(cost).toBeGreaterThanOrEqual(10);
    });
  });

  describe('createApiKey', () => {
    it('should create a new API key with default scopes', async () => {
      const { apiKey, plaintextKey } = await createTrackedApiKey({
        name: 'Test Key',
      });

      expect(apiKey.id).toBeTruthy();
      expect(apiKey.name).toBe('Test Key');
      expect(apiKey.scopes).toEqual(['read']);
      expect(plaintextKey).toMatch(/^sk-mem_/);

      // Verify key is in database
      const [dbKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKey.id));
      expect(dbKey).toBeTruthy();
      expect(dbKey!.name).toBe('Test Key');
    });

    it('should create a key with custom scopes', async () => {
      const { apiKey } = await createTrackedApiKey({
        name: 'Admin Key',
        scopes: ['read', 'write', 'admin'],
      });

      expect(apiKey.scopes).toEqual(['read', 'write', 'admin']);
    });

    it('should create a key with expiration', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const { apiKey } = await createTrackedApiKey({
        name: 'Temporary Key',
        expiresAt,
      });

      expect(apiKey.expiresAt).toBeTruthy();
      expect(Math.abs(apiKey.expiresAt!.getTime() - expiresAt.getTime())).toBeLessThan(1000);
    });

    it('should create a key with metadata', async () => {
      const { apiKey } = await createTrackedApiKey({
        name: 'Metadata Key',
        metadata: { project: 'test', environment: 'dev' },
      });

      expect(apiKey.metadata).toEqual({ project: 'test', environment: 'dev' });
    });

    it('should never store plaintext keys', async () => {
      const { apiKey, plaintextKey } = await createTrackedApiKey({
        name: 'Security Test',
      });

      // Check database record
      const [dbKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKey.id));
      expect(dbKey!.keyHash).not.toBe(plaintextKey);
      expect(dbKey!.keyHash).not.toContain(plaintextKey);
    });
  });

  describe('validateApiKey', () => {
    it('should validate a valid API key', async () => {
      const { plaintextKey } = await createTrackedApiKey({
        name: 'Valid Key',
        scopes: ['read', 'write'],
      });

      const validated = await validateApiKey(plaintextKey);
      expect(validated).toBeTruthy();
      expect(validated!.name).toBe('Valid Key');
      expect(validated!.scopes).toEqual(['read', 'write']);
    });

    it('should reject invalid API keys', async () => {
      const validated = await validateApiKey('sk-mem_invalid_key_123');
      expect(validated).toBeNull();
    });

    it('should reject keys without correct prefix', async () => {
      const validated = await validateApiKey('invalid-prefix-key');
      expect(validated).toBeNull();
    });

    it('should reject expired keys', async () => {
      const expiresAt = new Date(Date.now() - 1000); // Expired 1 second ago

      const { plaintextKey } = await createTrackedApiKey({
        name: 'Expired Key',
        expiresAt,
      });

      const validated = await validateApiKey(plaintextKey);
      expect(validated).toBeNull();
    });

    it('should reject revoked keys', async () => {
      const { apiKey, plaintextKey } = await createTrackedApiKey({
        name: 'To Be Revoked',
      });

      await revokeApiKey(apiKey.id);

      const validated = await validateApiKey(plaintextKey);
      expect(validated).toBeNull();
    });

    it('should update lastUsedAt timestamp', async () => {
      const { apiKey, plaintextKey } = await createTrackedApiKey({
        name: 'Usage Tracking',
      });

      // Initial lastUsedAt should be null
      const [beforeUse] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKey.id));
      expect(beforeUse!.lastUsedAt).toBeNull();

      await validateApiKey(plaintextKey);

      // After validation, lastUsedAt should be set
      const [afterUse] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKey.id));
      expect(afterUse!.lastUsedAt).toBeTruthy();
      expect(afterUse!.lastUsedAt!.getTime()).toBeGreaterThan(Date.now() - 2000);
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke an API key', async () => {
      const { apiKey } = await createTrackedApiKey({
        name: 'To Revoke',
      });

      const success = await revokeApiKey(apiKey.id);
      expect(success).toBe(true);

      const [revokedKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKey.id));
      expect(revokedKey!.revoked).toBeTruthy();
    });

    it('should return false for non-existent keys', async () => {
      const success = await revokeApiKey('00000000-0000-0000-0000-000000000000');
      expect(success).toBe(false);
    });

    it('should not revoke already revoked keys', async () => {
      const { apiKey } = await createTrackedApiKey({
        name: 'Already Revoked',
      });

      await revokeApiKey(apiKey.id);
      const success = await revokeApiKey(apiKey.id);

      expect(success).toBe(false);
    });
  });

  describe('rotateApiKey', () => {
    it('should rotate an API key', async () => {
      const { apiKey: oldKey } = await createTrackedApiKey({
        name: 'To Rotate',
        scopes: ['read', 'write'],
      });

      const result = await rotateApiKey(oldKey.id);
      expect(result).toBeTruthy();

      const { apiKey: newKey, plaintextKey } = result!;
      expect(newKey.id).not.toBe(oldKey.id);
      expect(newKey.scopes).toEqual(['read', 'write']);
      expect(plaintextKey).toMatch(/^sk-mem_/);

      // Old key should be revoked
      const [oldKeyDb] = await db.select().from(apiKeys).where(eq(apiKeys.id, oldKey.id));
      expect(oldKeyDb!.revoked).toBeTruthy();
    });

    it('should rotate with custom name', async () => {
      const { apiKey: oldKey } = await createTrackedApiKey({
        name: 'Original',
      });

      const result = await rotateApiKey(oldKey.id, 'Rotated Key');
      expect(result!.apiKey.name).toBe('Rotated Key');
    });

    it('should return null for non-existent keys', async () => {
      const result = await rotateApiKey('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('listApiKeys', () => {
    // NOTE: These tests filter by expected key names to avoid interference from parallel tests
    it('should list all active keys', async () => {
      await createTrackedApiKey({ name: 'Key 1' });
      await createTrackedApiKey({ name: 'Key 2' });
      await createTrackedApiKey({ name: 'Key 3' });

      const keys = await listApiKeys();
      const keyNames = keys.map((k) => k.name);
      // Verify our keys are present (don't assert exact count due to parallel tests)
      expect(keyNames).toContain('Key 1');
      expect(keyNames).toContain('Key 2');
      expect(keyNames).toContain('Key 3');
    });

    it('should not return key hashes', async () => {
      await createTrackedApiKey({ name: 'Secret Key' });

      const keys = await listApiKeys();
      const secretKey = keys.find((k) => k.name === 'Secret Key');
      expect(secretKey).toBeDefined();
      expect(secretKey).not.toHaveProperty('keyHash');
    });

    it('should exclude revoked keys by default', async () => {
      const { apiKey } = await createTrackedApiKey({ name: 'To Revoke' });
      await createTrackedApiKey({ name: 'Active Key' });

      await revokeApiKey(apiKey.id);

      const keys = await listApiKeys();
      const keyNames = keys.map((k) => k.name);
      // Revoked key should not appear
      expect(keyNames).not.toContain('To Revoke');
      // Active key should appear
      expect(keyNames).toContain('Active Key');
    });

    it('should include revoked keys when requested', async () => {
      const { apiKey } = await createTrackedApiKey({ name: 'Revoked' });
      await createTrackedApiKey({ name: 'Active' });

      await revokeApiKey(apiKey.id);

      const keys = await listApiKeys({ includeRevoked: true });
      const keyNames = keys.map((k) => k.name);
      // Both should appear
      expect(keyNames).toContain('Revoked');
      expect(keyNames).toContain('Active');
    });

    it('should exclude expired keys by default', async () => {
      await createTrackedApiKey({
        name: 'Expired',
        expiresAt: new Date(Date.now() - 1000),
      });
      await createTrackedApiKey({ name: 'Active' });

      const keys = await listApiKeys();
      const keyNames = keys.map((k) => k.name);
      // Expired key should not appear
      expect(keyNames).not.toContain('Expired');
      // Active key should appear
      expect(keyNames).toContain('Active');
    });

    it('should include expired keys when requested', async () => {
      await createTrackedApiKey({
        name: 'Expired',
        expiresAt: new Date(Date.now() - 1000),
      });
      await createTrackedApiKey({ name: 'Active' });

      const keys = await listApiKeys({ includeExpired: true });
      const keyNames = keys.map((k) => k.name);
      // Both should appear
      expect(keyNames).toContain('Expired');
      expect(keyNames).toContain('Active');
    });
  });

  describe('getApiKeyById', () => {
    it('should get an API key by ID', async () => {
      const { apiKey } = await createTrackedApiKey({
        name: 'Test Key',
        scopes: ['read'],
      });

      const fetched = await getApiKeyById(apiKey.id);
      expect(fetched).toBeTruthy();
      expect(fetched!.id).toBe(apiKey.id);
      expect(fetched!.name).toBe('Test Key');
    });

    it('should not return key hash', async () => {
      const { apiKey } = await createTrackedApiKey({ name: 'Secret' });

      const fetched = await getApiKeyById(apiKey.id);
      expect(fetched).not.toHaveProperty('keyHash');
    });

    it('should return null for non-existent keys', async () => {
      const fetched = await getApiKeyById('00000000-0000-0000-0000-000000000000');
      expect(fetched).toBeNull();
    });
  });

  describe('hasScope', () => {
    it('should check if key has a scope', async () => {
      const { apiKey } = await createTrackedApiKey({
        name: 'Scoped Key',
        scopes: ['read', 'write'],
      });

      expect(hasScope(apiKey, 'read')).toBe(true);
      expect(hasScope(apiKey, 'write')).toBe(true);
      expect(hasScope(apiKey, 'admin')).toBe(false);
    });

    it('should grant all scopes to admin keys', async () => {
      const { apiKey } = await createTrackedApiKey({
        name: 'Admin Key',
        scopes: ['admin'],
      });

      expect(hasScope(apiKey, 'read')).toBe(true);
      expect(hasScope(apiKey, 'write')).toBe(true);
      expect(hasScope(apiKey, 'admin')).toBe(true);
      expect(hasScope(apiKey, 'any-scope')).toBe(true);
    });
  });

  describe('updateApiKeyScopes', () => {
    it('should update API key scopes', async () => {
      const { apiKey } = await createTrackedApiKey({
        name: 'Updateable Key',
        scopes: ['read'],
      });

      const success = await updateApiKeyScopes(apiKey.id, ['read', 'write', 'admin']);
      expect(success).toBe(true);

      const [updated] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKey.id));
      expect(updated!.scopes).toEqual(['read', 'write', 'admin']);
    });

    it('should return false for non-existent keys', async () => {
      const success = await updateApiKeyScopes('00000000-0000-0000-0000-000000000000', ['read']);
      expect(success).toBe(false);
    });
  });
});
