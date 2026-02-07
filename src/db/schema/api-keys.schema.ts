import { pgTable, uuid, varchar, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * API Keys table for MCP authentication
 *
 * Stores hashed API keys with scopes, expiration, and usage tracking.
 * Keys are hashed with bcrypt (never stored in plaintext).
 *
 * Security Features:
 * - Bcrypt hashing with cost factor 10
 * - Key prefix for identification (sk-mem_...)
 * - Scope-based permissions
 * - Expiration support
 * - Last used tracking for security audits
 * - Audit trail via created/updated timestamps
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Bcrypt hash of the API key (never store plaintext) */
    keyHash: varchar('key_hash', { length: 255 }).notNull(),

    /** Human-readable name for the key */
    name: varchar('name', { length: 255 }).notNull(),

    /** Scopes/permissions granted to this key */
    scopes: jsonb('scopes')
      .notNull()
      .default(sql`'["read"]'::jsonb`),

    /** When the key expires (null = never) */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    /** Last time this key was used */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

    /** Key revocation status */
    revoked: timestamp('revoked', { withTimezone: true }),

    /** Audit metadata (IP address, user agent, etc.) */
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Fast lookup by key hash for authentication
    index('idx_api_keys_hash').on(table.keyHash),

    // List active keys (not expired, not revoked)
    index('idx_api_keys_active')
      .on(table.expiresAt, table.revoked)
      .where(sql`${table.revoked} IS NULL`),

    // Usage tracking and security audits
    index('idx_api_keys_last_used').on(table.lastUsedAt.desc()),

    // Scopes filtering
    index('idx_api_keys_scopes').using('gin', table.scopes),

    // Metadata search
    index('idx_api_keys_metadata').using('gin', sql`${table.metadata} jsonb_path_ops`),

    // Name lookup
    index('idx_api_keys_name').on(table.name),

    // Expiration checks
    index('idx_api_keys_expires')
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} IS NOT NULL`),
  ]
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
