/**
 * MCP Tool Definitions for Supermemory
 *
 * Defines all tools that will be exposed via the MCP server.
 * Each tool has a name, description, input schema, and handler function.
 *
 * Security Constraints:
 * - content: max 50,000 characters (50KB)
 * - query: max 10,000 characters
 * - containerTag: max 100 characters
 * - metadata: max 10KB JSON
 * - All string inputs have appropriate limits to prevent DoS
 */

import { z } from 'zod';

// ============================================================================
// Security Constants
// ============================================================================

/** Maximum content size in characters (50KB) */
const MAX_CONTENT_CHARS = 50000;

/** Maximum query size in characters (10KB) */
const MAX_QUERY_CHARS = 10000;

/** Maximum container tag length */
const MAX_CONTAINER_TAG_CHARS = 100;

/** Maximum title length */
const MAX_TITLE_CHARS = 500;

/** Maximum fact length */
const MAX_FACT_CHARS = 5000;

/** Maximum metadata size in bytes (10KB) */
const MAX_METADATA_BYTES = 10240;

// ============================================================================
// Metadata Validation Schema
// ============================================================================

/**
 * Validates that metadata doesn't exceed size limit.
 */
const boundedMetadataSchema = z
  .record(z.unknown())
  .optional()
  .refine(
    (metadata) => {
      if (!metadata) return true;
      try {
        const jsonSize = new TextEncoder().encode(JSON.stringify(metadata)).length;
        return jsonSize <= MAX_METADATA_BYTES;
      } catch {
        return false;
      }
    },
    { message: `Metadata must be at most ${MAX_METADATA_BYTES} bytes (10KB)` }
  );

// ============================================================================
// Input Schemas
// ============================================================================

export const AddContentInputSchema = z.object({
  content: z
    .string()
    .min(1, 'Content is required')
    .max(MAX_CONTENT_CHARS, `Content must be at most ${MAX_CONTENT_CHARS} characters`),
  containerTag: z
    .string()
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`)
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Container tag can only contain alphanumeric characters, underscores, and hyphens'
    )
    .optional()
    .describe('Container/namespace for organizing memories'),
  metadata: boundedMetadataSchema.describe('Additional metadata to attach (max 10KB)'),
  sourceUrl: z
    .string()
    .url()
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return ['http:', 'https:'].includes(parsed.protocol);
        } catch {
          return false;
        }
      },
      { message: 'URL must use http or https protocol' }
    )
    .optional()
    .describe('Source URL if content was extracted from a webpage'),
  title: z
    .string()
    .max(MAX_TITLE_CHARS, `Title must be at most ${MAX_TITLE_CHARS} characters`)
    .optional()
    .describe('Title for the content'),
});

export type AddContentInput = z.infer<typeof AddContentInputSchema>;

export const SearchInputSchema = z.object({
  query: z
    .string()
    .min(1, 'Query is required')
    .max(MAX_QUERY_CHARS, `Query must be at most ${MAX_QUERY_CHARS} characters`),
  containerTag: z
    .string()
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`)
    .optional()
    .describe('Filter results to specific container'),
  mode: z.enum(['vector', 'memory', 'hybrid']).optional().default('hybrid').describe('Search mode'),
  limit: z.number().min(1).max(100).optional().default(10).describe('Maximum results to return'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.5)
    .describe('Minimum similarity threshold'),
  rerank: z.boolean().optional().default(false).describe('Whether to rerank results'),
  includeMetadata: z.boolean().optional().default(true).describe('Include metadata in results'),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

export const ProfileInputSchema = z.object({
  containerTag: z
    .string()
    .min(1, 'Container tag is required')
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`),
  action: z.enum(['get', 'update', 'ingest']).optional().default('get'),
  content: z
    .string()
    .max(MAX_CONTENT_CHARS, `Content must be at most ${MAX_CONTENT_CHARS} characters`)
    .optional()
    .describe('Content to ingest for profile extraction'),
  facts: z
    .array(
      z.object({
        content: z
          .string()
          .min(1, 'Fact content is required')
          .max(MAX_FACT_CHARS, `Fact must be at most ${MAX_FACT_CHARS} characters`),
        type: z.enum(['static', 'dynamic']).optional(),
        category: z.string().max(100, 'Category must be at most 100 characters').optional(),
      })
    )
    .max(100, 'Cannot add more than 100 facts at once')
    .optional()
    .describe('Facts to add to profile'),
});

export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export const ListDocumentsInputSchema = z.object({
  containerTag: z
    .string()
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`)
    .optional()
    .describe('Filter by container tag'),
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  contentType: z.enum(['note', 'url', 'pdf', 'image', 'tweet', 'document']).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export type ListDocumentsInput = z.infer<typeof ListDocumentsInputSchema>;

export const DeleteContentInputSchema = z.object({
  id: z
    .string()
    .max(255, 'ID must be at most 255 characters')
    .optional()
    .describe('Specific document ID to delete'),
  containerTag: z
    .string()
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`)
    .optional()
    .describe('Delete all documents in container'),
  confirm: z.boolean().describe('Must be true to confirm deletion'),
});

export type DeleteContentInput = z.infer<typeof DeleteContentInputSchema>;

export const RememberInputSchema = z.object({
  fact: z
    .string()
    .min(1, 'Fact is required')
    .max(MAX_FACT_CHARS, `Fact must be at most ${MAX_FACT_CHARS} characters`),
  containerTag: z
    .string()
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`)
    .optional()
    .default('default')
    .describe('Container for the fact'),
  type: z.enum(['static', 'dynamic']).optional().default('static').describe('Fact type'),
  category: z
    .enum([
      'identity',
      'preference',
      'skill',
      'background',
      'relationship',
      'project',
      'goal',
      'context',
      'other',
    ])
    .optional()
    .describe('Fact category'),
  expirationHours: z
    .number()
    .min(1)
    .max(8760, 'Expiration must be at most 8760 hours (1 year)')
    .optional()
    .describe('Hours until expiration (dynamic facts only)'),
});

export type RememberInput = z.infer<typeof RememberInputSchema>;

export const RecallInputSchema = z.object({
  query: z
    .string()
    .min(1, 'Query is required')
    .max(MAX_QUERY_CHARS, `Query must be at most ${MAX_QUERY_CHARS} characters`),
  containerTag: z
    .string()
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`)
    .optional()
    .default('default'),
  includeStatic: z.boolean().optional().default(true),
  includeDynamic: z.boolean().optional().default(true),
  limit: z.number().min(1).max(50).optional().default(10),
});

export type RecallInput = z.infer<typeof RecallInputSchema>;

// ============================================================================
// API Key Management Schemas
// ============================================================================

export const CreateApiKeyInputSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name must be at most 255 characters'),
  scopes: z
    .array(z.enum(['read', 'write', 'admin']))
    .min(1, 'At least one scope is required')
    .optional()
    .default(['read']),
  expiresInDays: z
    .number()
    .min(1, 'Expiration must be at least 1 day')
    .max(365, 'Expiration must be at most 365 days')
    .optional()
    .describe('Number of days until the key expires'),
  metadata: boundedMetadataSchema.describe('Additional metadata to attach'),
});

export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

export const RevokeApiKeyInputSchema = z.object({
  id: z.string().uuid('ID must be a valid UUID'),
});

export type RevokeApiKeyInput = z.infer<typeof RevokeApiKeyInputSchema>;

export const ListApiKeysInputSchema = z.object({
  includeRevoked: z.boolean().optional().default(false).describe('Include revoked keys'),
  includeExpired: z.boolean().optional().default(false).describe('Include expired keys'),
});

export type ListApiKeysInput = z.infer<typeof ListApiKeysInputSchema>;

export const RotateApiKeyInputSchema = z.object({
  id: z.string().uuid('ID must be a valid UUID'),
  newName: z
    .string()
    .max(255, 'Name must be at most 255 characters')
    .optional()
    .describe('Optional new name for the rotated key'),
});

export type RotateApiKeyInput = z.infer<typeof RotateApiKeyInputSchema>;

// ============================================================================
// Tool Definitions (for MCP registration)
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'supermemory_add',
    description:
      'Add content to supermemory. Automatically extracts memories and indexes for semantic search. Use this to store notes, documents, or any text content you want to remember.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content to add to memory',
        },
        containerTag: {
          type: 'string',
          description:
            'Container/namespace for organizing memories (e.g., "work", "personal", "project-x")',
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata to attach to the content',
          additionalProperties: true,
        },
        sourceUrl: {
          type: 'string',
          description: 'Source URL if content was extracted from a webpage',
        },
        title: {
          type: 'string',
          description: 'Title for the content',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'supermemory_search',
    description:
      'Search through your memories using semantic search. Returns relevant content based on meaning, not just keywords. Use this to find information you previously stored.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query - can be a question or topic',
        },
        containerTag: {
          type: 'string',
          description: 'Filter results to a specific container',
        },
        mode: {
          type: 'string',
          enum: ['vector', 'memory', 'hybrid'],
          description: 'Search mode: vector (semantic), memory (keyword), or hybrid (both)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (1-100)',
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity score (0-1)',
        },
        rerank: {
          type: 'boolean',
          description: 'Whether to rerank results for better relevance',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'supermemory_profile',
    description:
      'Get or update user profile. Profiles contain extracted facts about the user that provide context for search and personalization.',
    inputSchema: {
      type: 'object',
      properties: {
        containerTag: {
          type: 'string',
          description: 'The container/user tag for the profile',
        },
        action: {
          type: 'string',
          enum: ['get', 'update', 'ingest'],
          description:
            'Action to perform: get (retrieve), update (add facts), ingest (extract from content)',
        },
        content: {
          type: 'string',
          description: 'Content to ingest for profile extraction (required for "ingest" action)',
        },
        facts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              type: { type: 'string', enum: ['static', 'dynamic'] },
              category: { type: 'string' },
            },
            required: ['content'],
          },
          description: 'Facts to add (required for "update" action)',
        },
      },
      required: ['containerTag'],
    },
  },
  {
    name: 'supermemory_list',
    description: 'List documents stored in supermemory. Use this to browse your saved content.',
    inputSchema: {
      type: 'object',
      properties: {
        containerTag: {
          type: 'string',
          description: 'Filter by container tag',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of documents to return (1-100)',
        },
        offset: {
          type: 'number',
          description: 'Number of documents to skip for pagination',
        },
        contentType: {
          type: 'string',
          enum: ['note', 'url', 'pdf', 'image', 'tweet', 'document'],
          description: 'Filter by content type',
        },
        sortBy: {
          type: 'string',
          enum: ['createdAt', 'updatedAt', 'title'],
          description: 'Field to sort by',
        },
        sortOrder: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order',
        },
      },
    },
  },
  {
    name: 'supermemory_delete',
    description:
      'Delete content from supermemory. Can delete by ID or by container tag. Requires confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Specific document ID to delete',
        },
        containerTag: {
          type: 'string',
          description: 'Delete all documents in this container',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'supermemory_remember',
    description:
      'Store a specific fact for later recall. Use this for important information you want to remember, like preferences, decisions, or key facts.',
    inputSchema: {
      type: 'object',
      properties: {
        fact: {
          type: 'string',
          description: 'The fact to remember',
        },
        containerTag: {
          type: 'string',
          description: 'Container for the fact (default: "default")',
        },
        type: {
          type: 'string',
          enum: ['static', 'dynamic'],
          description: 'Fact type: static (permanent) or dynamic (temporary)',
        },
        category: {
          type: 'string',
          enum: [
            'identity',
            'preference',
            'skill',
            'background',
            'relationship',
            'project',
            'goal',
            'context',
            'other',
          ],
          description: 'Category of the fact',
        },
        expirationHours: {
          type: 'number',
          description: 'Hours until expiration (only for dynamic facts)',
        },
      },
      required: ['fact'],
    },
  },
  {
    name: 'supermemory_recall',
    description:
      'Recall facts matching a query. Use this to retrieve previously stored facts and preferences.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query to match facts against',
        },
        containerTag: {
          type: 'string',
          description: 'Container to search in (default: "default")',
        },
        includeStatic: {
          type: 'boolean',
          description: 'Include static (permanent) facts',
        },
        includeDynamic: {
          type: 'boolean',
          description: 'Include dynamic (temporary) facts',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of facts to return',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'supermemory_create_api_key',
    description:
      'Create a new API key for authentication. Admin scope required. Returns the plaintext key (show once to user).',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Human-readable name for the key',
        },
        scopes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['read', 'write', 'admin'],
          },
          description: 'Scopes/permissions for the key',
        },
        expiresInDays: {
          type: 'number',
          description: 'Number of days until the key expires (1-365)',
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata to attach',
          additionalProperties: true,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'supermemory_revoke_api_key',
    description:
      'Revoke an existing API key. Admin scope required. Revoked keys cannot be used for authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The API key ID to revoke',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'supermemory_list_api_keys',
    description:
      'List all API keys. Admin scope required. Does not return key hashes or plaintext keys.',
    inputSchema: {
      type: 'object',
      properties: {
        includeRevoked: {
          type: 'boolean',
          description: 'Include revoked keys in the list',
        },
        includeExpired: {
          type: 'boolean',
          description: 'Include expired keys in the list',
        },
      },
    },
  },
  {
    name: 'supermemory_rotate_api_key',
    description:
      'Rotate an API key by creating a new one and revoking the old one. Admin scope required. Returns the new plaintext key.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The API key ID to rotate',
        },
        newName: {
          type: 'string',
          description: 'Optional new name for the rotated key',
        },
      },
      required: ['id'],
    },
  },
];

// ============================================================================
// Result Types
// ============================================================================

export interface AddContentResult {
  success: boolean;
  documentId?: string;
  memoriesExtracted?: number;
  message: string;
}

export interface SearchResultItem {
  id: string;
  content: string;
  similarity: number;
  containerTag?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface SearchResult {
  results: SearchResultItem[];
  totalCount: number;
  query: string;
  searchTimeMs: number;
}

export interface ProfileResult {
  containerTag: string;
  staticFacts: Array<{
    id: string;
    content: string;
    category?: string;
    confidence: number;
  }>;
  dynamicFacts: Array<{
    id: string;
    content: string;
    category?: string;
    expiresAt?: string;
  }>;
  lastUpdated: string;
}

export interface ListResult {
  documents: Array<{
    id: string;
    title?: string;
    contentPreview: string;
    contentType: string;
    containerTag?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface DeleteResult {
  success: boolean;
  deletedCount: number;
  message: string;
}

export interface RememberResult {
  success: boolean;
  factId: string;
  message: string;
}

export interface RecallResult {
  facts: Array<{
    id: string;
    content: string;
    type: 'static' | 'dynamic';
    category?: string;
    confidence: number;
    createdAt: string;
  }>;
  query: string;
  totalFound: number;
}

// ============================================================================
// API Key Management Result Types
// ============================================================================

export interface CreateApiKeyResult {
  success: boolean;
  apiKey: {
    id: string;
    name: string;
    scopes: string[];
    expiresAt?: string;
    createdAt: string;
  };
  plaintextKey: string; // Show once to user
  message: string;
}

export interface RevokeApiKeyResult {
  success: boolean;
  message: string;
}

export interface ListApiKeysResult {
  keys: Array<{
    id: string;
    name: string;
    scopes: string[];
    expiresAt?: string;
    lastUsedAt?: string;
    revoked?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}

export interface RotateApiKeyResult {
  success: boolean;
  oldKeyId: string;
  newKey: {
    id: string;
    name: string;
    scopes: string[];
    expiresAt?: string;
    createdAt: string;
  };
  plaintextKey: string; // Show once to user
  message: string;
}
