/**
 * MCP Tool Definitions for Supermemory
 */

import { z } from 'zod';

const MAX_CONTENT_CHARS = 50000;
const MAX_QUERY_CHARS = 10000;
const MAX_CONTAINER_TAG_CHARS = 100;
const MAX_TITLE_CHARS = 500;
const MAX_FACT_CHARS = 5000;
const MAX_METADATA_BYTES = 10240;

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
    .optional(),
  title: z
    .string()
    .max(MAX_TITLE_CHARS, `Title must be at most ${MAX_TITLE_CHARS} characters`)
    .optional(),
});

export const SearchInputSchema = z.object({
  query: z
    .string()
    .min(1, 'Query is required')
    .max(MAX_QUERY_CHARS, `Query must be at most ${MAX_QUERY_CHARS} characters`),
  containerTag: z
    .string()
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`)
    .optional(),
  mode: z.enum(['vector', 'memory', 'hybrid']).optional().default('hybrid'),
  limit: z.number().min(1).max(100).optional().default(10),
  threshold: z.number().min(0).max(1).optional().default(0.5),
  rerank: z.boolean().optional().default(false),
  includeMetadata: z.boolean().optional().default(true),
});

export const ProfileInputSchema = z.object({
  containerTag: z
    .string()
    .min(1, 'Container tag is required')
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`),
  action: z.enum(['get', 'update', 'ingest']).optional().default('get'),
  content: z
    .string()
    .max(MAX_CONTENT_CHARS, `Content must be at most ${MAX_CONTENT_CHARS} characters`)
    .optional(),
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
    .optional(),
});

export const ListDocumentsInputSchema = z.object({
  containerTag: z
    .string()
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`)
    .optional(),
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  contentType: z.enum(['note', 'url', 'pdf', 'image', 'tweet', 'document']).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const DeleteContentInputSchema = z.object({
  id: z.string().max(255, 'ID must be at most 255 characters').optional(),
  containerTag: z
    .string()
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`)
    .optional(),
  confirm: z.boolean(),
});

export const RememberInputSchema = z.object({
  fact: z
    .string()
    .min(1, 'Fact is required')
    .max(MAX_FACT_CHARS, `Fact must be at most ${MAX_FACT_CHARS} characters`),
  containerTag: z
    .string()
    .max(MAX_CONTAINER_TAG_CHARS, `Container tag must be at most ${MAX_CONTAINER_TAG_CHARS} characters`)
    .optional()
    .default('default'),
  type: z.enum(['static', 'dynamic']).optional().default('static'),
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
    .optional(),
  expirationHours: z.number().min(1).max(8760).optional(),
});

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
    description: 'Add content and extract/index memories.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        containerTag: { type: 'string' },
        metadata: { type: 'object', additionalProperties: true },
        sourceUrl: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['content'],
    },
  },
  {
    name: 'supermemory_search',
    description: 'Semantic/memory/hybrid search across stored memories.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        containerTag: { type: 'string' },
        mode: { type: 'string', enum: ['vector', 'memory', 'hybrid'] },
        limit: { type: 'number' },
        threshold: { type: 'number' },
        rerank: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'supermemory_profile',
    description: 'Get/ingest/update profile facts for a container.',
    inputSchema: {
      type: 'object',
      properties: {
        containerTag: { type: 'string' },
        action: { type: 'string', enum: ['get', 'update', 'ingest'] },
        content: { type: 'string' },
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
        },
      },
      required: ['containerTag'],
    },
  },
  {
    name: 'supermemory_list',
    description: 'List stored documents.',
    inputSchema: {
      type: 'object',
      properties: {
        containerTag: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' },
        contentType: { type: 'string', enum: ['note', 'url', 'pdf', 'image', 'tweet', 'document'] },
        sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'title'] },
        sortOrder: { type: 'string', enum: ['asc', 'desc'] },
      },
    },
  },
  {
    name: 'supermemory_delete',
    description: 'Delete content by ID or containerTag.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        containerTag: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'supermemory_remember',
    description: 'Store a specific fact for future recall.',
    inputSchema: {
      type: 'object',
      properties: {
        fact: { type: 'string' },
        containerTag: { type: 'string' },
        type: { type: 'string', enum: ['static', 'dynamic'] },
        category: {
          type: 'string',
          enum: ['identity', 'preference', 'skill', 'background', 'relationship', 'project', 'goal', 'context', 'other'],
        },
        expirationHours: { type: 'number' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'supermemory_recall',
    description: 'Recall stored facts matching a query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        containerTag: { type: 'string' },
        includeStatic: { type: 'boolean' },
        includeDynamic: { type: 'boolean' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
];

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
