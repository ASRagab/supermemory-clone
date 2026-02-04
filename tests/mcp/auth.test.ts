/**
 * MCP Authentication Middleware Tests
 *
 * Tests for API key authentication in MCP server.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPostgresDatabase } from '../../src/db/postgres.js';
import { apiKeys } from '../../src/db/schema/api-keys.schema.js';
import { eq } from 'drizzle-orm';
import { createApiKey } from '../../src/services/auth.service.js';

// Get database instance for tests
const getDatabaseUrl = () => process.env.TEST_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://supermemory:supermemory_secret@localhost:5432/supermemory';
const db = getPostgresDatabase(getDatabaseUrl());
import {
  extractApiKey,
  authenticateRequest,
  authorizeRequest,
  getToolScopes,
  TOOL_SCOPES,
} from '../../src/mcp/auth.js';

describe('MCP Authentication Middleware', () => {
  let testKey: string;
  let testKeyId: string;
  // Track all keys created in this test file for cleanup
  const createdKeyIds: string[] = [];

  // Create test key for extraction tests
  // NOTE: We only delete keys created by THIS test file to avoid breaking parallel tests
  beforeEach(async () => {
    // Create a test API key (will be used by tests that need it)
    const { apiKey, plaintextKey } = await createApiKey({
      name: 'MCP Test Key',
      scopes: ['read', 'write'],
    });
    testKey = plaintextKey;
    testKeyId = apiKey.id;
    createdKeyIds.push(apiKey.id);
  });

  // Clean up only the keys we created
  afterEach(async () => {
    for (const keyId of createdKeyIds) {
      await db.delete(apiKeys).where(eq(apiKeys.id, keyId));
    }
    createdKeyIds.length = 0; // Clear the array
  });

  describe('extractApiKey', () => {
    it('should extract key from X-API-Key header', () => {
      const headers = {
        'x-api-key': 'sk-mem_test123',
      };

      const key = extractApiKey(headers);
      expect(key).toBe('sk-mem_test123');
    });

    it('should extract key from X-API-Key header (capitalized)', () => {
      const headers = {
        'X-API-Key': 'sk-mem_test456',
      };

      const key = extractApiKey(headers);
      expect(key).toBe('sk-mem_test456');
    });

    it('should extract key from Authorization Bearer header', () => {
      const headers = {
        authorization: 'Bearer sk-mem_test789',
      };

      const key = extractApiKey(headers);
      expect(key).toBe('sk-mem_test789');
    });

    it('should extract key from Authorization header (capitalized)', () => {
      const headers = {
        Authorization: 'Bearer sk-mem_testABC',
      };

      const key = extractApiKey(headers);
      expect(key).toBe('sk-mem_testABC');
    });

    it('should handle case-insensitive Bearer prefix', () => {
      const headers = {
        authorization: 'bearer sk-mem_testDEF',
      };

      const key = extractApiKey(headers);
      expect(key).toBe('sk-mem_testDEF');
    });

    it('should prefer X-API-Key over Authorization', () => {
      const headers = {
        'x-api-key': 'sk-mem_preferred',
        authorization: 'Bearer sk-mem_fallback',
      };

      const key = extractApiKey(headers);
      expect(key).toBe('sk-mem_preferred');
    });

    it('should return null for missing headers', () => {
      const key = extractApiKey({});
      expect(key).toBeNull();
    });

    it('should return null for invalid Authorization format', () => {
      const headers = {
        authorization: 'InvalidFormat sk-mem_test',
      };

      const key = extractApiKey(headers);
      expect(key).toBeNull();
    });

    it('should trim whitespace from keys', () => {
      const headers = {
        'x-api-key': '  sk-mem_test123  ',
      };

      const key = extractApiKey(headers);
      expect(key).toBe('sk-mem_test123');
    });
  });

  describe('authenticateRequest', () => {
    // Create key specifically for auth tests (overwrites outer key)
    beforeEach(async () => {
      const { apiKey, plaintextKey } = await createApiKey({
        name: 'Auth Test Key',
        scopes: ['read'],
      });
      testKey = plaintextKey;
      createdKeyIds.push(apiKey.id);
    });

    it('should authenticate valid API key', async () => {
      const headers = {
        'x-api-key': testKey,
      };

      const result = await authenticateRequest(headers);
      expect(result.authenticated).toBe(true);
      expect(result.apiKey).toBeTruthy();
      expect(result.apiKey!.name).toBe('Auth Test Key');
      expect(result.error).toBeUndefined();
    });

    it('should reject requests without API key', async () => {
      const result = await authenticateRequest({});
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('API key required');
      expect(result.errorCode).toBe('MISSING_KEY');
    });

    it('should reject invalid API keys', async () => {
      const headers = {
        'x-api-key': 'sk-mem_invalid_key_12345',
      };

      const result = await authenticateRequest(headers);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('Invalid API key');
      expect(result.errorCode).toBe('INVALID_KEY');
    });

    it('should reject expired keys', async () => {
      const { apiKey, plaintextKey } = await createApiKey({
        name: 'Expired Key',
        expiresAt: new Date(Date.now() - 1000),
      });
      createdKeyIds.push(apiKey.id);

      const headers = {
        'x-api-key': plaintextKey,
      };

      const result = await authenticateRequest(headers);
      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe('INVALID_KEY');
    });

    it('should reject revoked keys', async () => {
      const { apiKey, plaintextKey } = await createApiKey({
        name: 'To Be Revoked',
      });
      createdKeyIds.push(apiKey.id);

      // Revoke the key
      await db
        .update(apiKeys)
        .set({ revoked: new Date() })
        .where(eq(apiKeys.id, apiKey.id));

      const headers = {
        'x-api-key': plaintextKey,
      };

      const result = await authenticateRequest(headers);
      expect(result.authenticated).toBe(false);
    });
  });

  describe('authorizeRequest', () => {
    it('should authorize request with sufficient scopes', async () => {
      const authResult = {
        authenticated: true,
        apiKey: {
          id: testKeyId,
          name: 'Test Key',
          scopes: ['read', 'write'],
        } as any,
      };

      const result = authorizeRequest(authResult, ['read']);
      expect(result.authorized).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject request with insufficient scopes', async () => {
      const authResult = {
        authenticated: true,
        apiKey: {
          id: testKeyId,
          name: 'Read Only Key',
          scopes: ['read'],
        } as any,
      };

      const result = authorizeRequest(authResult, ['write']);
      expect(result.authorized).toBe(false);
      expect(result.error).toContain('Missing required scope: write');
    });

    it('should require all scopes', async () => {
      const authResult = {
        authenticated: true,
        apiKey: {
          id: testKeyId,
          name: 'Partial Scopes',
          scopes: ['read'],
        } as any,
      };

      const result = authorizeRequest(authResult, ['read', 'write']);
      expect(result.authorized).toBe(false);
      expect(result.error).toContain('write');
    });

    it('should grant all permissions to admin keys', async () => {
      const authResult = {
        authenticated: true,
        apiKey: {
          id: testKeyId,
          name: 'Admin Key',
          scopes: ['admin'],
        } as any,
      };

      const result = authorizeRequest(authResult, ['read', 'write', 'delete']);
      expect(result.authorized).toBe(true);
    });

    it('should reject unauthenticated requests', async () => {
      const authResult = {
        authenticated: false,
        error: 'Invalid key',
      };

      const result = authorizeRequest(authResult, ['read']);
      expect(result.authorized).toBe(false);
      expect(result.error).toBe('Authentication required');
    });
  });

  describe('getToolScopes', () => {
    it('should return read scope for search tools', () => {
      expect(getToolScopes('supermemory_search')).toEqual(['read']);
      expect(getToolScopes('supermemory_list')).toEqual(['read']);
      expect(getToolScopes('supermemory_recall')).toEqual(['read']);
    });

    it('should return write scope for write tools', () => {
      expect(getToolScopes('supermemory_add')).toEqual(['write']);
      expect(getToolScopes('supermemory_remember')).toEqual(['write']);
    });

    it('should return admin scope for destructive tools', () => {
      expect(getToolScopes('supermemory_delete')).toEqual(['admin']);
    });

    it('should return admin scope for key management tools', () => {
      expect(getToolScopes('supermemory_create_api_key')).toEqual(['admin']);
      expect(getToolScopes('supermemory_revoke_api_key')).toEqual(['admin']);
      expect(getToolScopes('supermemory_list_api_keys')).toEqual(['admin']);
      expect(getToolScopes('supermemory_rotate_api_key')).toEqual(['admin']);
    });

    it('should return default read scope for unknown tools', () => {
      expect(getToolScopes('unknown_tool')).toEqual(['read']);
    });
  });

  describe('TOOL_SCOPES configuration', () => {
    it('should have scopes defined for all core tools', () => {
      const coreTools = [
        'supermemory_add',
        'supermemory_search',
        'supermemory_profile',
        'supermemory_list',
        'supermemory_delete',
        'supermemory_remember',
        'supermemory_recall',
      ];

      for (const tool of coreTools) {
        expect(TOOL_SCOPES[tool]).toBeTruthy();
        expect(Array.isArray(TOOL_SCOPES[tool])).toBe(true);
      }
    });

    it('should have scopes defined for key management tools', () => {
      const keyManagementTools = [
        'supermemory_create_api_key',
        'supermemory_revoke_api_key',
        'supermemory_list_api_keys',
        'supermemory_rotate_api_key',
      ];

      for (const tool of keyManagementTools) {
        expect(TOOL_SCOPES[tool]).toEqual(['admin']);
      }
    });
  });
});
