#!/usr/bin/env node
/**
 * Supermemory MCP Server
 *
 * Model Context Protocol server that exposes supermemory functionality
 * as tools and resources for AI coding assistants like Claude Code.
 *
 * Usage:
 *   node dist/mcp/index.js
 *   npx tsx src/mcp/index.ts
 *
 * Add to Claude Code:
 *   claude mcp add supermemory -- node /path/to/supermemory-clone/dist/mcp/index.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'

import {
  TOOL_DEFINITIONS,
  AddContentInputSchema,
  SearchInputSchema,
  ProfileInputSchema,
  ListDocumentsInputSchema,
  DeleteContentInputSchema,
  RememberInputSchema,
  RecallInputSchema,
  type AddContentResult,
  type SearchResult,
  type ProfileResult,
  type ListResult,
  type DeleteResult,
  type RememberResult,
  type RecallResult,
} from './tools.js'

import {
  RESOURCE_TEMPLATES,
  parseResourceUri,
  generateResourceList,
  type ProfileResource,
  type DocumentResource,
  type SearchResource,
  type FactsResource,
  type StatsResource,
} from './resources.js'

import { getMCPRateLimiter, createRateLimitErrorResponse } from './rateLimit.js'

import { MemoryService, createMemoryService } from '../services/memory.service.js'
import { SearchService, createSearchService } from '../services/search.service.js'
import { ProfileService } from '../services/profile.service.js'
import { EmbeddingService, cosineSimilarity } from '../services/embedding.service.js'
import { generateId } from '../utils/id.js'
import { ValidationError } from '../utils/errors.js'
import { getLogger } from '../utils/logger.js'
import { getDatabaseUrl } from '../db/client.js'
import { getPostgresDatabase, type PostgresDatabaseInstance } from '../db/postgres.js'
import { documents } from '../db/schema/documents.schema.js'
import { archiveFileWithSuffix, pathExists, readJsonFile } from './legacyState.js'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { initializeAndValidate } from '../startup.js'
import * as path from 'path'

const logger = getLogger('mcp-server')

// ============================================================================
// Server State & Legacy Migration
// ============================================================================

interface LegacyDocumentRecord {
  id: string
  content: string
  title?: string
  contentType?: string
  containerTag?: string
  sourceUrl?: string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  embedding?: number[]
}

interface LegacyPersistedState {
  documents: LegacyDocumentRecord[]
  containerTags: string[]
  version: number
  lastSaved: string
}

interface ServerState {
  db: PostgresDatabaseInstance
  memoryService: MemoryService
  searchService: SearchService
  profileService: ProfileService
  embeddingService: EmbeddingService
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getLegacyPersistencePath(): string {
  const dataPath =
    process.env.SUPERMEMORY_DATA_PATH || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.supermemory')

  return path.join(dataPath, 'mcp-state.json')
}

function mapLegacyContentTypeToDb(contentType?: string): string {
  switch (contentType) {
    case 'pdf':
      return 'application/pdf'
    case 'image':
      return 'image/png'
    case 'url':
      return 'text/html'
    case 'tweet':
    case 'document':
    case 'note':
    default:
      return 'text/plain'
  }
}

function mapMcpContentTypeToDb(contentType?: string): string[] {
  switch (contentType) {
    case 'pdf':
      return ['application/pdf']
    case 'image':
      return ['image/png', 'image/jpeg']
    case 'url':
      return ['text/html']
    case 'tweet':
    case 'document':
    case 'note':
    default:
      return ['text/plain']
  }
}

function mapDbContentTypeToMcp(contentType?: string): 'note' | 'url' | 'pdf' | 'image' | 'tweet' | 'document' {
  switch (contentType) {
    case 'application/pdf':
      return 'pdf'
    case 'image/png':
    case 'image/jpeg':
      return 'image'
    case 'text/html':
      return 'url'
    default:
      return 'note'
  }
}

function extractTitle(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined
  const title = metadata.title
  return typeof title === 'string' ? title : undefined
}

function extractSourceUrl(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined
  const sourceUrl = metadata.sourceUrl
  return typeof sourceUrl === 'string' ? sourceUrl : undefined
}

function parseLegacyDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function buildDocumentMetadata(base: unknown, extras: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(base)) {
    return { ...base, ...extras }
  }

  return { ...extras }
}

async function migrateLegacyMcpState(state: ServerState): Promise<void> {
  const legacyPath = getLegacyPersistencePath()

  if (!(await pathExists(legacyPath))) {
    return
  }

  let legacyState: LegacyPersistedState | null = null

  try {
    legacyState = await readJsonFile<LegacyPersistedState>(legacyPath)
  } catch (error) {
    logger.error(
      'Failed to read legacy MCP state for migration',
      { legacyPath },
      error instanceof Error ? error : undefined
    )
    return
  }

  if (!legacyState || !Array.isArray(legacyState.documents)) {
    logger.warn('Legacy MCP state missing documents, skipping migration', { legacyPath })
    return
  }

  let hadFailures = false

  for (const doc of legacyState.documents) {
    if (!doc.content) {
      continue
    }

    const documentId = doc.id || generateId()
    const containerTag = doc.containerTag ?? 'default'
    const metadata = buildDocumentMetadata(doc.metadata, {
      ...(doc.title ? { title: doc.title } : {}),
      ...(doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : {}),
      ...(doc.contentType ? { legacyContentType: doc.contentType } : {}),
    })
    const createdAt = parseLegacyDate(doc.createdAt) ?? new Date()
    const updatedAt = parseLegacyDate(doc.updatedAt) ?? createdAt

    try {
      const inserted = await state.db
        .insert(documents)
        .values({
          id: documentId,
          content: doc.content,
          contentType: mapLegacyContentTypeToDb(doc.contentType),
          status: 'processed',
          containerTag,
          metadata,
          createdAt,
          updatedAt,
        })
        .onConflictDoNothing({ target: documents.id })
        .returning({ id: documents.id })

      if (inserted.length === 0) {
        continue
      }

      const processed = await state.memoryService.processAndStoreMemories(doc.content, {
        containerTag,
        sourceId: documentId,
      })

      for (const memory of processed.memories) {
        await state.searchService.indexMemory(memory)
      }
    } catch (error) {
      hadFailures = true
      logger.error('Failed to migrate legacy MCP document', { documentId }, error instanceof Error ? error : undefined)
    }
  }

  if (hadFailures) {
    logger.warn('Legacy MCP migration encountered failures, leaving file for retry', {
      legacyPath,
    })
    return
  }

  try {
    const migratedPath = await archiveFileWithSuffix(legacyPath)
    logger.info('Legacy MCP state migrated and archived', { legacyPath, migratedPath })
  } catch (error) {
    logger.error(
      'Failed to archive legacy MCP state after migration',
      { legacyPath },
      error instanceof Error ? error : undefined
    )
  }
}

function createServerState(): ServerState {
  return {
    db: getPostgresDatabase(getDatabaseUrl()),
    memoryService: createMemoryService(),
    searchService: createSearchService(),
    profileService: new ProfileService(),
    embeddingService: new EmbeddingService(),
  }
}

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleAddContent(state: ServerState, args: unknown): Promise<AddContentResult> {
  const input = AddContentInputSchema.parse(args)

  const documentId = generateId()
  const containerTag = input.containerTag ?? 'default'
  const metadata = buildDocumentMetadata(input.metadata, {
    ...(input.title ? { title: input.title } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
  })

  await state.db.insert(documents).values({
    id: documentId,
    content: input.content,
    contentType: 'text/plain',
    status: 'processed',
    containerTag,
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  let memoriesExtracted = 0
  const errors: string[] = []
  let processedMemories: Awaited<ReturnType<MemoryService['processAndStoreMemories']>>['memories'] = []

  // Extract memories with error handling
  try {
    const processed = await state.memoryService.processAndStoreMemories(input.content, {
      containerTag,
      sourceId: documentId,
    })
    processedMemories = processed.memories
  } catch (extractionError) {
    const message = extractionError instanceof Error ? extractionError.message : 'Unknown extraction error'
    errors.push(`Memory extraction failed: ${message}`)
  }

  // Index memories for search with individual error handling
  for (const memory of processedMemories) {
    try {
      await state.searchService.indexMemory(memory)
      memoriesExtracted++
    } catch (indexError) {
      const message = indexError instanceof Error ? indexError.message : 'Unknown indexing error'
      errors.push(`Failed to index memory ${memory.id}: ${message}`)
    }
  }

  // Extract profile facts if containerTag provided
  if (input.containerTag) {
    try {
      await state.profileService.ingestContent(input.containerTag, input.content, documentId)
    } catch (profileError) {
      const message = profileError instanceof Error ? profileError.message : 'Unknown profile error'
      errors.push(`Profile ingestion failed: ${message}`)
    }
  }

  const hasErrors = errors.length > 0
  const statusMessage = hasErrors
    ? `Added content with ${memoriesExtracted} memories (${errors.length} errors)`
    : `Added content with ${memoriesExtracted} extracted memories`

  return {
    success: true,
    documentId,
    memoriesExtracted,
    message: statusMessage,
  }
}

async function handleSearch(state: ServerState, args: unknown): Promise<SearchResult> {
  const input = SearchInputSchema.parse(args)

  const response = await state.searchService.hybridSearch(input.query, input.containerTag, {
    limit: input.limit,
    threshold: input.threshold,
    searchMode: input.mode,
    rerank: input.rerank,
  })

  return {
    results: response.results.map((r) => ({
      id: r.id,
      content: r.memory?.content ?? r.chunk?.content ?? '',
      similarity: r.similarity,
      containerTag: r.memory?.containerTag,
      metadata: input.includeMetadata ? r.metadata : undefined,
      createdAt: r.updatedAt?.toISOString(),
    })),
    totalCount: response.totalCount,
    query: response.query,
    searchTimeMs: response.searchTimeMs,
  }
}

async function handleProfile(state: ServerState, args: unknown): Promise<ProfileResult> {
  const input = ProfileInputSchema.parse(args)

  switch (input.action) {
    case 'get': {
      const profile = await state.profileService.getProfile(input.containerTag)
      return {
        containerTag: profile.containerTag,
        staticFacts: profile.staticFacts.map((f) => ({
          id: f.id,
          content: f.content,
          category: f.category,
          confidence: f.confidence,
        })),
        dynamicFacts: profile.dynamicFacts.map((f) => ({
          id: f.id,
          content: f.content,
          category: f.category,
          expiresAt: f.expiresAt?.toISOString(),
        })),
        lastUpdated: profile.updatedAt.toISOString(),
      }
    }

    case 'ingest': {
      if (!input.content) {
        throw new ValidationError('Content required for ingest action', {
          content: ['Content field is required for ingest action'],
        })
      }
      await state.profileService.ingestContent(input.containerTag, input.content)
      const profile = await state.profileService.getProfile(input.containerTag)
      return {
        containerTag: profile.containerTag,
        staticFacts: profile.staticFacts.map((f) => ({
          id: f.id,
          content: f.content,
          category: f.category,
          confidence: f.confidence,
        })),
        dynamicFacts: profile.dynamicFacts.map((f) => ({
          id: f.id,
          content: f.content,
          category: f.category,
          expiresAt: f.expiresAt?.toISOString(),
        })),
        lastUpdated: profile.updatedAt.toISOString(),
      }
    }

    case 'update': {
      if (!input.facts || input.facts.length === 0) {
        throw new ValidationError('Facts required for update action', {
          facts: ['At least one fact is required for update action'],
        })
      }
      // Valid fact categories
      const validCategories = [
        'identity',
        'preference',
        'skill',
        'background',
        'relationship',
        'project',
        'goal',
        'context',
        'other',
      ] as const
      type FactCategory = (typeof validCategories)[number]

      // Convert input facts to ProfileFact format with validation
      const facts = input.facts.map((f) => {
        const category: FactCategory | undefined =
          f.category && validCategories.includes(f.category as FactCategory) ? (f.category as FactCategory) : undefined

        return {
          id: generateId(),
          content: f.content,
          type: (f.type ?? 'static') as 'static' | 'dynamic',
          category,
          confidence: 0.9,
          extractedAt: new Date(),
          lastAccessedAt: new Date(),
          reinforcementCount: 0,
        }
      })
      const profile = await state.profileService.updateProfile(input.containerTag, facts)
      return {
        containerTag: profile.containerTag,
        staticFacts: profile.staticFacts.map((f) => ({
          id: f.id,
          content: f.content,
          category: f.category,
          confidence: f.confidence,
        })),
        dynamicFacts: profile.dynamicFacts.map((f) => ({
          id: f.id,
          content: f.content,
          category: f.category,
          expiresAt: f.expiresAt?.toISOString(),
        })),
        lastUpdated: profile.updatedAt.toISOString(),
      }
    }

    default:
      throw new ValidationError(`Unknown action: ${input.action}`, {
        action: [`Invalid action '${input.action}'. Valid actions: get, ingest, update`],
      })
  }
}

async function handleListDocuments(state: ServerState, args: unknown): Promise<ListResult> {
  const input = ListDocumentsInputSchema.parse(args)

  const filters = [] as Array<ReturnType<typeof and>>

  if (input.containerTag) {
    filters.push(eq(documents.containerTag, input.containerTag))
  }

  if (input.contentType) {
    filters.push(inArray(documents.contentType, mapMcpContentTypeToDb(input.contentType)))
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined
  const [countRow] = await state.db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(whereClause)
  const total = Number(countRow?.count ?? 0)

  const orderExpression =
    input.sortBy === 'title'
      ? sql`${documents.metadata} ->> 'title'`
      : input.sortBy === 'updatedAt'
        ? documents.updatedAt
        : documents.createdAt
  const orderBy = input.sortOrder === 'asc' ? asc(orderExpression) : desc(orderExpression)

  const limit = input.limit ?? 20
  const offset = input.offset ?? 0

  const rows = await state.db
    .select({
      id: documents.id,
      content: documents.content,
      contentType: documents.contentType,
      containerTag: documents.containerTag,
      metadata: documents.metadata,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)

  return {
    documents: rows.map((doc) => {
      const metadata = isRecord(doc.metadata) ? doc.metadata : {}
      const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt)
      const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt : new Date(doc.updatedAt)

      return {
        id: doc.id,
        title: extractTitle(metadata),
        contentPreview: doc.content.substring(0, 200) + (doc.content.length > 200 ? '...' : ''),
        contentType: mapDbContentTypeToMcp(doc.contentType),
        containerTag: doc.containerTag,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      }
    }),
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  }
}

async function handleDelete(state: ServerState, args: unknown): Promise<DeleteResult> {
  const input = DeleteContentInputSchema.parse(args)

  if (!input.confirm) {
    return {
      success: false,
      deletedCount: 0,
      message: 'Deletion not confirmed. Set confirm: true to proceed.',
    }
  }

  if (!input.id && !input.containerTag) {
    return {
      success: false,
      deletedCount: 0,
      message: 'Either id or containerTag must be provided',
    }
  }

  let deletedCount = 0

  if (input.id) {
    const deleted = await state.db.delete(documents).where(eq(documents.id, input.id)).returning({ id: documents.id })
    deletedCount = deleted.length
  } else if (input.containerTag) {
    const deleted = await state.db
      .delete(documents)
      .where(eq(documents.containerTag, input.containerTag))
      .returning({ id: documents.id })
    deletedCount = deleted.length
  }

  return {
    success: deletedCount > 0,
    deletedCount,
    message: deletedCount > 0 ? `Deleted ${deletedCount} document(s)` : 'No documents found to delete',
  }
}

async function handleRemember(state: ServerState, args: unknown): Promise<RememberResult> {
  const input = RememberInputSchema.parse(args)
  const containerTag = input.containerTag ?? 'default'

  const factId = generateId()
  const now = new Date()

  const fact = {
    id: factId,
    content: input.fact,
    type: input.type ?? 'static',
    category: input.category,
    confidence: 0.95,
    extractedAt: now,
    lastAccessedAt: now,
    reinforcementCount: 0,
    expiresAt:
      input.type === 'dynamic' && input.expirationHours
        ? new Date(now.getTime() + input.expirationHours * 60 * 60 * 1000)
        : undefined,
  }

  await state.profileService.updateProfile(containerTag, [fact as import('../services/profile.types.js').ProfileFact])

  return {
    success: true,
    factId,
    message: `Remembered: "${input.fact.substring(0, 50)}${input.fact.length > 50 ? '...' : ''}"`,
  }
}

async function handleRecall(state: ServerState, args: unknown): Promise<RecallResult> {
  const input = RecallInputSchema.parse(args)
  const containerTag = input.containerTag ?? 'default'

  const profile = await state.profileService.getProfile(containerTag)
  const queryLower = input.query.toLowerCase()

  // Hybrid search: combine semantic similarity with keyword matching
  interface ScoredFact {
    id: string
    content: string
    type: 'static' | 'dynamic'
    category?: string
    confidence: number
    createdAt: string
    similarity: number
  }

  const scoredFacts: ScoredFact[] = []

  // Generate query embedding for semantic search
  let queryEmbedding: number[] | undefined
  try {
    queryEmbedding = await state.embeddingService.generateEmbedding(input.query)
  } catch (error) {
    // Fall back to keyword-only matching if embedding fails
    logger.warn(
      'Failed to generate query embedding for recall, falling back to keyword search',
      { query: input.query },
      error instanceof Error ? error : undefined
    )
  }

  // Helper to calculate similarity score
  const calculateScore = async (factContent: string): Promise<number> => {
    // Keyword score: 0.5 for substring match
    const keywordScore = factContent.toLowerCase().includes(queryLower) ? 0.5 : 0

    // Semantic score using embeddings
    let semanticScore = 0
    if (queryEmbedding) {
      try {
        const factEmbedding = await state.embeddingService.generateEmbedding(factContent)
        semanticScore = cosineSimilarity(queryEmbedding, factEmbedding)
      } catch {
        // Ignore embedding errors for individual facts
      }
    }

    // Combine scores: weight semantic higher if available
    if (queryEmbedding) {
      return semanticScore * 0.7 + keywordScore * 0.3
    }
    return keywordScore
  }

  // Process static facts
  if (input.includeStatic !== false) {
    for (const fact of profile.staticFacts) {
      const similarity = await calculateScore(fact.content)
      // Include if similarity > 0.2 (semantic) or has keyword match
      if (similarity > 0.2 || fact.content.toLowerCase().includes(queryLower)) {
        scoredFacts.push({
          id: fact.id,
          content: fact.content,
          type: 'static',
          category: fact.category,
          confidence: fact.confidence,
          createdAt: fact.extractedAt.toISOString(),
          similarity,
        })
      }
    }
  }

  // Process dynamic facts
  if (input.includeDynamic !== false) {
    for (const fact of profile.dynamicFacts) {
      const similarity = await calculateScore(fact.content)
      if (similarity > 0.2 || fact.content.toLowerCase().includes(queryLower)) {
        scoredFacts.push({
          id: fact.id,
          content: fact.content,
          type: 'dynamic',
          category: fact.category,
          confidence: fact.confidence,
          createdAt: fact.extractedAt.toISOString(),
          similarity,
        })
      }
    }
  }

  // Sort by similarity score (higher is better), then by confidence
  scoredFacts.sort((a, b) => {
    const simDiff = b.similarity - a.similarity
    if (Math.abs(simDiff) > 0.01) return simDiff
    return b.confidence - a.confidence
  })

  const limited = scoredFacts.slice(0, input.limit ?? 10)

  // Return results without the internal similarity score
  return {
    facts: limited.map(({ similarity: _similarity, ...rest }) => rest),
    query: input.query,
    totalFound: scoredFacts.length,
  }
}

// ============================================================================
// Resource Handlers
// ============================================================================

async function handleReadResource(state: ServerState, uri: string): Promise<string> {
  const parsed = parseResourceUri(uri)

  switch (parsed.type) {
    case 'profile': {
      const containerTag = parsed.params.containerTag
      if (!containerTag) {
        throw new McpError(ErrorCode.InvalidParams, 'Container tag required')
      }
      const profile = await state.profileService.getProfile(containerTag)
      const resource: ProfileResource = {
        uri,
        containerTag: profile.containerTag,
        staticFacts: profile.staticFacts.map((f) => ({
          id: f.id,
          content: f.content,
          category: f.category,
          confidence: f.confidence,
          extractedAt: f.extractedAt.toISOString(),
        })),
        dynamicFacts: profile.dynamicFacts.map((f) => ({
          id: f.id,
          content: f.content,
          category: f.category,
          expiresAt: f.expiresAt?.toISOString(),
          extractedAt: f.extractedAt.toISOString(),
        })),
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
        version: profile.version,
      }
      return JSON.stringify(resource, null, 2)
    }

    case 'document': {
      const id = parsed.params.id
      if (!id) {
        throw new McpError(ErrorCode.InvalidParams, 'Document ID required')
      }
      const [doc] = await state.db
        .select({
          id: documents.id,
          content: documents.content,
          contentType: documents.contentType,
          containerTag: documents.containerTag,
          metadata: documents.metadata,
          createdAt: documents.createdAt,
          updatedAt: documents.updatedAt,
        })
        .from(documents)
        .where(eq(documents.id, id))
        .limit(1)

      if (!doc) {
        throw new McpError(ErrorCode.InvalidRequest, `Document not found: ${id}`)
      }
      const metadata = isRecord(doc.metadata) ? doc.metadata : {}
      const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt)
      const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt : new Date(doc.updatedAt)
      const resource: DocumentResource = {
        uri,
        id: doc.id,
        title: extractTitle(metadata),
        content: doc.content,
        contentType: mapDbContentTypeToMcp(doc.contentType),
        containerTag: doc.containerTag,
        sourceUrl: extractSourceUrl(metadata),
        metadata,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      }
      return JSON.stringify(resource, null, 2)
    }

    case 'search': {
      const query = parsed.params.q ?? parsed.params.query ?? ''
      const containerTag = parsed.params.container ?? parsed.params.containerTag
      const limit = parseInt(parsed.params.limit ?? '10', 10)
      const mode = (parsed.params.mode ?? 'hybrid') as 'vector' | 'memory' | 'hybrid'

      if (!query) {
        throw new McpError(ErrorCode.InvalidParams, 'Query parameter (q) required')
      }

      const response = await state.searchService.hybridSearch(query, containerTag, {
        limit,
        searchMode: mode,
      })

      const resource: SearchResource = {
        uri,
        query,
        results: response.results.map((r) => ({
          id: r.id,
          content: r.memory?.content ?? r.chunk?.content ?? '',
          similarity: r.similarity,
          containerTag: r.memory?.containerTag,
          metadata: r.metadata,
        })),
        totalCount: response.totalCount,
        searchTimeMs: response.searchTimeMs,
      }
      return JSON.stringify(resource, null, 2)
    }

    case 'facts': {
      const containerTag = parsed.params.containerTag
      if (!containerTag) {
        throw new McpError(ErrorCode.InvalidParams, 'Container tag required')
      }
      const profile = await state.profileService.getProfile(containerTag)
      const allFacts = [
        ...profile.staticFacts.map((f) => ({ ...f, type: 'static' as const })),
        ...profile.dynamicFacts.map((f) => ({ ...f, type: 'dynamic' as const })),
      ]
      const resource: FactsResource = {
        uri,
        containerTag,
        facts: allFacts.map((f) => ({
          id: f.id,
          content: f.content,
          type: f.type,
          category: f.category,
          confidence: f.confidence,
          createdAt: f.extractedAt.toISOString(),
          expiresAt: 'expiresAt' in f ? f.expiresAt?.toISOString() : undefined,
        })),
        totalCount: allFacts.length,
      }
      return JSON.stringify(resource, null, 2)
    }

    case 'stats': {
      const stats = await state.searchService.getStats()
      const [countRow] = await state.db.select({ count: sql<number>`count(*)` }).from(documents)
      const totalDocuments = Number(countRow?.count ?? 0)
      const tagRows = await state.db
        .select({ containerTag: documents.containerTag })
        .from(documents)
        .groupBy(documents.containerTag)
      const containerTags = tagRows.map((row) => row.containerTag)

      // Aggregate facts across all container tags
      let totalFacts = 0
      for (const tag of containerTags) {
        try {
          const profile = await state.profileService.getProfile(tag)
          totalFacts += profile.staticFacts.length + profile.dynamicFacts.length
        } catch {
          // Profile may not exist for this tag yet
        }
      }

      const resource: StatsResource = {
        uri,
        totalDocuments,
        totalMemories: stats.memoryCount,
        totalFacts,
        containerTags,
        indexedVectors: stats.vectorCount,
        lastUpdated: new Date().toISOString(),
      }
      return JSON.stringify(resource, null, 2)
    }

    default:
      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource type: ${uri}`)
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract containerTag from tool arguments for rate limiting
 * Falls back to 'default' if not found
 */
function extractContainerTag(args: unknown): string {
  if (args && typeof args === 'object' && args !== null) {
    const argsObj = args as Record<string, unknown>
    if (typeof argsObj.containerTag === 'string' && argsObj.containerTag) {
      return argsObj.containerTag
    }
  }
  return 'default'
}

// ============================================================================
// Server Setup
// ============================================================================

async function main() {
  await initializeAndValidate()

  const state = createServerState()
  await migrateLegacyMcpState(state)

  const server = new Server(
    {
      name: 'supermemory',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  )

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOL_DEFINITIONS,
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    // Extract containerTag from arguments for rate limiting
    // Different tools use containerTag in different argument positions
    const containerTag = extractContainerTag(args)

    // Check rate limit before processing
    const rateLimiter = getMCPRateLimiter()
    const rateLimitResult = await rateLimiter.checkLimit(containerTag, name)

    if (!rateLimitResult.allowed) {
      logger.warn('Rate limit exceeded', {
        tool: name,
        containerTag,
        limitType: rateLimitResult.limitType,
        resetIn: rateLimitResult.resetIn,
      })
      return createRateLimitErrorResponse(rateLimitResult, name)
    }

    try {
      let result: unknown

      switch (name) {
        case 'supermemory_add':
          result = await handleAddContent(state, args)
          break
        case 'supermemory_search':
          result = await handleSearch(state, args)
          break
        case 'supermemory_profile':
          result = await handleProfile(state, args)
          break
        case 'supermemory_list':
          result = await handleListDocuments(state, args)
          break
        case 'supermemory_delete':
          result = await handleDelete(state, args)
          break
        case 'supermemory_remember':
          result = await handleRemember(state, args)
          break
        case 'supermemory_recall':
          result = await handleRecall(state, args)
          break
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new McpError(ErrorCode.InternalError, message)
    }
  })

  // Register resource handlers
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: RESOURCE_TEMPLATES.map((t) => ({
        uriTemplate: t.uriTemplate,
        name: t.name,
        description: t.description,
        mimeType: t.mimeType,
      })),
    }
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const rows = await state.db.select({ id: documents.id, containerTag: documents.containerTag }).from(documents)
    const documentIds = rows.map((row) => row.id)
    const containerTags = Array.from(new Set(rows.map((row) => row.containerTag)))
    const resources = generateResourceList(containerTags, documentIds)

    return {
      resources: resources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    }
  })

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params

    try {
      const content = await handleReadResource(state, uri)
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: content,
          },
        ],
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new McpError(ErrorCode.InternalError, message)
    }
  })

  // Error handling
  server.onerror = (error) => {
    logger.error('MCP server error', {}, error instanceof Error ? error : undefined)
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down (SIGINT)')
    await server.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    logger.info('Shutting down (SIGTERM)')
    await server.close()
    process.exit(0)
  })

  // Start server
  const transport = new StdioServerTransport()
  await server.connect(transport)

  logger.info('Supermemory MCP server started on stdio')
}

// Run main
main().catch((error) => {
  logger.error('Fatal error', {}, error instanceof Error ? error : undefined)
  process.exit(1)
})
