/**
 * Authentication Service
 *
 * Handles API key generation, validation, and management for MCP server.
 *
 * Security Features:
 * - Cryptographically secure key generation
 * - Bcrypt hashing with cost factor 10
 * - Key prefix for identification (sk-mem_)
 * - Expiration handling
 * - Usage tracking
 * - Audit logging
 */

import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { getPostgresDatabase } from '../db/postgres.js';
import { apiKeys, type NewApiKey, type ApiKey } from '../db/schema/api-keys.schema.js';
import { eq, and, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgSelect } from 'drizzle-orm/pg-core';
import { DatabaseError } from '../utils/errors.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('auth-service');

const DEFAULT_DB_URL = 'postgresql://supermemory:supermemory_secret@localhost:5432/supermemory';
const getDatabaseUrl = () => process.env.DATABASE_URL || DEFAULT_DB_URL;
const db = getPostgresDatabase(getDatabaseUrl());

const BCRYPT_ROUNDS = 10;
const KEY_PREFIX = 'sk-mem_';
/** 32 bytes = 256 bits of entropy */
const KEY_LENGTH = 32;

/**
 * Generate a cryptographically secure API key
 *
 * Format: sk-mem_<base64url-encoded-random-bytes>
 *
 * @returns The generated API key (plaintext - show once to user)
 */
export function generateApiKey(): string {
  const randomPart = randomBytes(KEY_LENGTH).toString('base64url');
  return `${KEY_PREFIX}${randomPart}`;
}

/**
 * Hash an API key using bcrypt
 *
 * @param key - The plaintext API key
 * @returns The bcrypt hash
 */
export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, BCRYPT_ROUNDS);
}

/**
 * Verify an API key against its hash
 *
 * @param key - The plaintext API key
 * @param hash - The stored bcrypt hash
 * @returns True if the key matches the hash
 */
export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(key, hash);
  } catch {
    return false;
  }
}

/**
 * Create a new API key
 *
 * @param options - Key creation options
 * @returns Object containing the key record and the plaintext key (show once)
 */
export async function createApiKey(options: {
  name: string;
  scopes?: string[];
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}): Promise<{ apiKey: ApiKey; plaintextKey: string }> {
  const plaintextKey = generateApiKey();
  const keyHash = await hashApiKey(plaintextKey);

  const [record] = await db
    .insert(apiKeys)
    .values({
      keyHash,
      name: options.name,
      scopes: options.scopes ?? ['read'],
      expiresAt: options.expiresAt,
      metadata: options.metadata ?? {},
    } as NewApiKey)
    .returning();

  if (!record) {
    throw new DatabaseError('Failed to create API key', 'insert', {
      table: 'api_keys',
      name: options.name,
    });
  }

  // NEVER log the plaintext key - only log the ID
  logger.info('API key created', { apiKeyId: record.id, name: options.name });

  // IMPORTANT: plaintext key should only be shown to user once
  return { apiKey: record, plaintextKey };
}

/**
 * Validate an API key and return its details.
 * Checks: key exists and hash matches, not revoked, not expired.
 * Updates lastUsedAt timestamp on success.
 */
export async function validateApiKey(key: string): Promise<ApiKey | null> {
  if (!key || !key.startsWith(KEY_PREFIX)) {
    return null;
  }

  const candidates = await db
    .select()
    .from(apiKeys)
    .where(isNull(apiKeys.revoked));

  for (const candidate of candidates) {
    const isMatch = await verifyApiKey(key, candidate.keyHash);
    if (!isMatch) continue;

    if (candidate.expiresAt && new Date() > candidate.expiresAt) {
      logger.warn('API key expired', { apiKeyId: candidate.id });
      return null;
    }

    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, candidate.id));

    return candidate;
  }

  return null;
}

/**
 * Revoke an API key
 *
 * @param id - The API key ID to revoke
 * @returns True if revoked, false if not found
 */
export async function revokeApiKey(id: string): Promise<boolean> {
  const result = await db
    .update(apiKeys)
    .set({ revoked: new Date() })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revoked)))
    .returning();

  if (result.length > 0) {
    logger.info('API key revoked', { apiKeyId: id });
    return true;
  }

  return false;
}

/**
 * Rotate an API key (create new, revoke old)
 *
 * @param id - The API key ID to rotate
 * @param newName - Optional new name for the rotated key
 * @returns Object containing the new key record and plaintext key
 */
export async function rotateApiKey(
  id: string,
  newName?: string
): Promise<{ apiKey: ApiKey; plaintextKey: string } | null> {
  // Get the old key
  const [oldKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));

  if (!oldKey) {
    return null;
  }

  // Create new key with same scopes
  const { apiKey: newKey, plaintextKey } = await createApiKey({
    name: newName ?? `${oldKey.name} (rotated)`,
    scopes: Array.isArray(oldKey.scopes) ? oldKey.scopes : ['read'],
    expiresAt: oldKey.expiresAt ?? undefined,
    metadata: {
      ...(typeof oldKey.metadata === 'object' && oldKey.metadata !== null ? oldKey.metadata : {}),
      rotatedFrom: oldKey.id,
      rotatedAt: new Date().toISOString(),
    },
  });

  // Revoke old key
  await revokeApiKey(id);

  logger.info('API key rotated', { oldKeyId: id, newKeyId: newKey.id });

  return { apiKey: newKey, plaintextKey };
}

/**
 * List all API keys (admin function)
 *
 * @param options - Filtering options
 * @returns Array of API key records (without hashes)
 */
export async function listApiKeys(options?: {
  includeRevoked?: boolean;
  includeExpired?: boolean;
}): Promise<Omit<ApiKey, 'keyHash'>[]> {
  const conditions: SQL<unknown>[] = [];
  if (!options?.includeRevoked) conditions.push(isNull(apiKeys.revoked));
  if (!options?.includeExpired) {
    conditions.push(sql`(${apiKeys.expiresAt} IS NULL OR ${apiKeys.expiresAt} > NOW())`);
  }

  const keys = await db
    .select()
    .from(apiKeys)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return keys.map(({ keyHash, ...rest }) => rest);
}

/**
 * Get API key details by ID (admin function)
 *
 * @param id - The API key ID
 * @returns API key record without hash, or null if not found
 */
export async function getApiKeyById(id: string): Promise<Omit<ApiKey, 'keyHash'> | null> {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));

  if (!key) {
    return null;
  }

  const { keyHash, ...rest } = key;
  return rest;
}

/**
 * Check if an API key has a specific scope
 *
 * @param apiKey - The API key record
 * @param scope - The scope to check
 * @returns True if the key has the scope
 */
export function hasScope(apiKey: ApiKey, scope: string): boolean {
  if (!Array.isArray(apiKey.scopes)) {
    return false;
  }
  return apiKey.scopes.includes(scope) || apiKey.scopes.includes('admin');
}

/**
 * Update API key scopes (admin function)
 *
 * @param id - The API key ID
 * @param scopes - The new scopes
 * @returns True if updated, false if not found
 */
export async function updateApiKeyScopes(id: string, scopes: string[]): Promise<boolean> {
  const result = await db
    .update(apiKeys)
    .set({ scopes, updatedAt: new Date() })
    .where(eq(apiKeys.id, id))
    .returning();

  if (result.length > 0) {
    logger.info('API key scopes updated', { apiKeyId: id, scopes });
    return true;
  }

  return false;
}

// Re-export types for external use
export type { ApiKey, NewApiKey };
