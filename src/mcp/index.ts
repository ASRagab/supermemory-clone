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

import '../config/bootstrap-env.js'
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
import { closePostgresDatabase, getPostgresDatabase, type PostgresDatabaseInstance } from '../db/postgres.js'
import { documents } from '../db/schema/documents.schema.js'
import { memories } from '../db/schema/memories.schema.js'
import { archiveFileWithSuffix, pathExists, readJsonFile } from './legacyState.js'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { initializeAndValidate } from '../startup.js'
import { createMcpEnvelopeError, createToolResponse, mapErrorToMcpError } from './results.js'
import { profileRepository } from '../services/profile.repository.js'
import * as path from 'path'

const logger = getLogger('mcp-server')
const RECALL_SEMANTIC_SHORTLIST_MULTIPLIER = 5
const RECALL_SEMANTIC_MIN_SHORTLIST = 25
const RECALL_SEMANTIC_MAX_SHORTLIST = 50
const RECALL_SEMANTIC_THRESHOLD = 0.2
const recallEmbeddingCache = new Map<string, number[]>()

process.env.SUPERMEMORY_PG_POOL_MIN ??= '0'
process.env.SUPERMEMORY_PG_POOL_MAX ??= '5'
process.env.SUPERMEMORY_PG_POOL_IDLE_TIMEOUT_MS ??= '10000'

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

function getRecallQueryTokens(queryLower: string): string[] {
  return Array.from(new Set(queryLower.split(/\W+/).map((token) => token.trim()).filter((token) => token.length >= 2)))
}

function getKeywordRecallScore(factContent: string, queryLower: string, queryTokens: string[]): number {
  const contentLower = factContent.toLowerCase()
  const substringScore = contentLower.includes(queryLower) ? 0.6 : 0

  if (queryTokens.length === 0) {
    return substringScore
  }

  const tokenMatches = queryTokens.filter((token) => contentLower.includes(token)).length
  const overlapScore = (tokenMatches / queryTokens.length) * 0.4

  return Math.min(1, substringScore + overlapScore)
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

  const customId = input.customId ?? input.idempotencyKey
  const metadata = buildDocumentMetadata(input.metadata, {
    ...(input.title ? { title: input.title } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
  })

  const existingDocument =
    customId
      ? await state.db
          .select({
            id: documents.id,
            containerTag: documents.containerTag,
          })
          .from(documents)
          .where(eq(documents.customId, customId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null

  if (existingDocument && !input.upsert) {
    return {
      success: true,
      documentId: existingDocument.id,
      customId,
      created: false,
      reused: true,
      updated: false,
      memoriesExtracted: 0,
      message: `Reused existing document for customId "${customId}"`,
    }
  }

  const documentId = existingDocument?.id ?? generateId()
  const now = new Date()
  const containerTag = input.containerTag ?? existingDocument?.containerTag ?? 'default'

  if (existingDocument) {
    await state.db
      .update(documents)
      .set({
        content: input.content,
        containerTag,
        metadata,
        status: 'processed',
        updatedAt: now,
      })
      .where(eq(documents.id, existingDocument.id))
  } else {
    await state.db.insert(documents).values({
      id: documentId,
      customId: customId ?? null,
      content: input.content,
      contentType: 'text/plain',
      status: 'processed',
      containerTag,
      metadata,
      createdAt: now,
      updatedAt: now,
    })
  }

  let memoriesExtracted = 0
  const errors: string[] = []
  let processedMemories: Awaited<ReturnType<MemoryService['processAndStoreMemories']>>['memories'] = []

  if (existingDocument) {
    const existingMemories = await state.db
      .select({ id: memories.id })
      .from(memories)
      .where(eq(memories.documentId, existingDocument.id))

    for (const memory of existingMemories) {
      try {
        await state.searchService.removeMemory(memory.id)
      } catch (cleanupError) {
        const message = cleanupError instanceof Error ? cleanupError.message : 'Unknown search cleanup error'
        errors.push(`Failed to clear indexed memory ${memory.id}: ${message}`)
      }
    }

    await state.db.delete(memories).where(eq(memories.documentId, existingDocument.id))

    const profiles = await profileRepository.listAll()
    for (const profile of profiles) {
      const nextStaticFacts = profile.staticFacts.filter((fact) => fact.sourceId !== existingDocument.id)
      const nextDynamicFacts = profile.dynamicFacts.filter((fact) => fact.sourceId !== existingDocument.id)
      if (
        nextStaticFacts.length !== profile.staticFacts.length ||
        nextDynamicFacts.length !== profile.dynamicFacts.length
      ) {
        await profileRepository.updateFacts(profile.containerTag, nextStaticFacts, nextDynamicFacts)
      }
    }
  }

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

  for (const memory of processedMemories) {
    try {
      await state.searchService.indexMemory(memory)
      memoriesExtracted++
    } catch (indexError) {
      const message = indexError instanceof Error ? indexError.message : 'Unknown indexing error'
      errors.push(`Failed to index memory ${memory.id}: ${message}`)
    }
  }

  if (input.containerTag) {
    try {
      await state.profileService.ingestContent(input.containerTag, input.content, documentId)
    } catch (profileError) {
      const message = profileError instanceof Error ? profileError.message : 'Unknown profile error'
      errors.push(`Profile ingestion failed: ${message}`)
    }
  }

  const hasErrors = errors.length > 0
  const statusMessage = existingDocument
    ? hasErrors
      ? `Updated existing document with ${memoriesExtracted} memories (${errors.length} errors)`
      : `Updated existing document with ${memoriesExtracted} extracted memories`
    : hasErrors
      ? `Added content with ${memoriesExtracted} memories (${errors.length} errors)`
      : `Added content with ${memoriesExtracted} extracted memories`

  return {
    success: !hasErrors,
    documentId,
    customId,
    created: !existingDocument,
    reused: false,
    updated: Boolean(existingDocument),
    memoriesExtracted,
    message: statusMessage,
    ...(hasErrors ? { errors } : {}),
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
      documentsDeleted: 0,
      memoriesDeleted: 0,
      vectorsDeleted: 0,
      profileFactsDeleted: 0,
      deletedCount: 0,
      message: 'Deletion not confirmed. Set confirm: true to proceed.',
    }
  }

  if (!input.id && !input.containerTag) {
    return {
      success: false,
      documentsDeleted: 0,
      memoriesDeleted: 0,
      vectorsDeleted: 0,
      profileFactsDeleted: 0,
      deletedCount: 0,
      message: 'Either id or containerTag must be provided',
    }
  }

  const targetDocuments = await state.db
    .select({
      id: documents.id,
    })
    .from(documents)
    .where(input.id ? eq(documents.id, input.id) : eq(documents.containerTag, input.containerTag!))

  if (targetDocuments.length === 0) {
    return {
      success: false,
      documentsDeleted: 0,
      memoriesDeleted: 0,
      vectorsDeleted: 0,
      profileFactsDeleted: 0,
      deletedCount: 0,
      message: 'No documents found to delete',
    }
  }

  const documentIds = targetDocuments.map((document) => document.id)
  const errors: string[] = []
  let vectorsDeleted = 0

  const associatedMemories = await state.db
    .select({ id: memories.id })
    .from(memories)
    .where(inArray(memories.documentId, documentIds))

  for (const memory of associatedMemories) {
    try {
      const cleanup = await state.searchService.removeMemory(memory.id)
      vectorsDeleted += cleanup.vectorsDeleted
    } catch (cleanupError) {
      const message = cleanupError instanceof Error ? cleanupError.message : 'Unknown vector cleanup error'
      errors.push(`Failed to clear indexed memory ${memory.id}: ${message}`)
    }
  }

  const deletedMemories = await state.db
    .delete(memories)
    .where(inArray(memories.documentId, documentIds))
    .returning({ id: memories.id })

  let profileFactsDeleted = 0
  const profiles = await profileRepository.listAll()
  for (const profile of profiles) {
    const nextStaticFacts = profile.staticFacts.filter((fact) => !documentIds.includes(fact.sourceId ?? ''))
    const nextDynamicFacts = profile.dynamicFacts.filter((fact) => !documentIds.includes(fact.sourceId ?? ''))
    const removedFacts =
      profile.staticFacts.length -
      nextStaticFacts.length +
      (profile.dynamicFacts.length - nextDynamicFacts.length)

    if (removedFacts === 0) {
      continue
    }

    try {
      await profileRepository.updateFacts(profile.containerTag, nextStaticFacts, nextDynamicFacts)
      profileFactsDeleted += removedFacts
    } catch (profileError) {
      const message = profileError instanceof Error ? profileError.message : 'Unknown profile cleanup error'
      errors.push(`Failed to remove profile facts for container ${profile.containerTag}: ${message}`)
    }
  }

  const deletedDocuments = await state.db
    .delete(documents)
    .where(inArray(documents.id, documentIds))
    .returning({ id: documents.id })

  const documentsDeleted = deletedDocuments.length
  const memoriesDeleted = deletedMemories.length
  const deletedCount = documentsDeleted
  const hasErrors = errors.length > 0
  const success = documentsDeleted > 0 && !hasErrors

  const message = success
    ? `Deleted ${documentsDeleted} document(s), ${memoriesDeleted} derived memory row(s), and ${profileFactsDeleted} profile fact(s)`
    : `Deleted ${documentsDeleted} document(s) with ${errors.length} cleanup issue(s)`

  return {
    success,
    documentsDeleted,
    memoriesDeleted,
    vectorsDeleted,
    profileFactsDeleted,
    deletedCount,
    message,
    ...(hasErrors ? { errors } : {}),
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
  const profile =
    (await profileRepository.findByContainerTag(containerTag)) ?? {
      containerTag,
      staticFacts: [],
      dynamicFacts: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    }
  const queryLower = input.query.toLowerCase()
  const queryTokens = getRecallQueryTokens(queryLower)
  const limit = input.limit ?? 10

  interface ScoredFact {
    id: string
    content: string
    type: 'static' | 'dynamic'
    category?: string
    confidence: number
    createdAt: string
    similarity: number
  }

  const factCandidates = [
    ...(input.includeStatic !== false
      ? profile.staticFacts.map((fact) => ({ fact, type: 'static' as const }))
      : []),
    ...(input.includeDynamic !== false
      ? profile.dynamicFacts.map((fact) => ({ fact, type: 'dynamic' as const }))
      : []),
  ]

  const keywordCandidates = factCandidates.map(({ fact, type }) => ({
    fact,
    type,
    keywordScore: getKeywordRecallScore(fact.content, queryLower, queryTokens),
  }))

  keywordCandidates.sort((a, b) => {
    const keywordDiff = b.keywordScore - a.keywordScore
    if (Math.abs(keywordDiff) > 0.001) return keywordDiff
    return b.fact.confidence - a.fact.confidence
  })

  const semanticEnabled = !state.embeddingService.isUsingLocalFallback()
  const shortlistSize = Math.min(
    Math.max(limit * RECALL_SEMANTIC_SHORTLIST_MULTIPLIER, RECALL_SEMANTIC_MIN_SHORTLIST),
    RECALL_SEMANTIC_MAX_SHORTLIST,
    keywordCandidates.length
  )

  let semanticScores = new Map<string, number>()
  if (semanticEnabled && shortlistSize > 0) {
    try {
      const queryEmbedding = await state.embeddingService.generateEmbedding(input.query)
      const semanticShortlist = keywordCandidates.slice(0, shortlistSize)
      const missingEmbeddings = semanticShortlist
        .map(({ fact }) => ({
          cacheKey: `${fact.id}:${fact.content}`,
          fact,
        }))
        .filter(({ cacheKey }) => !recallEmbeddingCache.has(cacheKey))

      if (missingEmbeddings.length > 0) {
        const embeddings = await state.embeddingService.batchEmbed(missingEmbeddings.map(({ fact }) => fact.content))
        missingEmbeddings.forEach(({ cacheKey }, index) => {
          const embedding = embeddings[index]
          if (embedding && embedding.length > 0) {
            recallEmbeddingCache.set(cacheKey, embedding)
          }
        })
      }

      semanticScores = new Map(
        semanticShortlist.flatMap(({ fact }) => {
          const embedding = recallEmbeddingCache.get(`${fact.id}:${fact.content}`)
          return embedding ? [[fact.id, cosineSimilarity(queryEmbedding, embedding)] as const] : []
        })
      )
    } catch (error) {
      logger.warn(
        'Failed to generate recall semantic scores, falling back to keyword-only recall',
        { query: input.query, containerTag },
        error instanceof Error ? error : undefined
      )
    }
  }

  const scoredFacts: ScoredFact[] = keywordCandidates
    .map(({ fact, type, keywordScore }) => ({
      id: fact.id,
      content: fact.content,
      type,
      category: fact.category,
      confidence: fact.confidence,
      createdAt: fact.extractedAt.toISOString(),
      similarity:
        semanticScores.size > 0 && semanticScores.has(fact.id)
          ? semanticScores.get(fact.id)! * 0.7 + keywordScore * 0.3
          : keywordScore,
    }))
    .filter((fact) => fact.similarity >= RECALL_SEMANTIC_THRESHOLD || fact.content.toLowerCase().includes(queryLower))

  scoredFacts.sort((a, b) => {
    const simDiff = b.similarity - a.similarity
    if (Math.abs(simDiff) > 0.01) return simDiff
    return b.confidence - a.confidence
  })

  const limited = scoredFacts.slice(0, limit)

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

function buildToolResponse(toolName: string, result: unknown) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const typedResult = result as Record<string, unknown>
    const hasSuccessFlag = typeof typedResult.success === 'boolean'
    const ok = hasSuccessFlag ? Boolean(typedResult.success) : true
    const rawErrors = Array.isArray(typedResult.errors)
      ? typedResult.errors.filter((value): value is string => typeof value === 'string')
      : []
    const partial =
      rawErrors.length > 0 &&
      (typedResult.documentId !== undefined ||
        (typeof typedResult.deletedCount === 'number' && typedResult.deletedCount > 0) ||
        (typeof typedResult.documentsDeleted === 'number' && typedResult.documentsDeleted > 0))

    return createToolResponse({
      tool: toolName,
      ok: ok && rawErrors.length === 0,
      data: result,
      errors:
        rawErrors.length > 0
          ? rawErrors.map((message) => createMcpEnvelopeError('PARTIAL_FAILURE', message))
          : !ok && typeof typedResult.message === 'string'
            ? [createMcpEnvelopeError('TOOL_OPERATION_FAILED', typedResult.message)]
            : [],
      partial,
    })
  }

  return createToolResponse({
    tool: toolName,
    ok: true,
    data: result,
  })
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

      return buildToolResponse(name, result)
    } catch (error) {
      throw mapErrorToMcpError(error)
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
    const rows = await state.db
      .select({ id: documents.id, containerTag: documents.containerTag })
      .from(documents)
      .orderBy(desc(documents.updatedAt))
      .limit(10)
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
      throw mapErrorToMcpError(error)
    }
  })

  // Error handling
  server.onerror = (error) => {
    logger.error('MCP server error', {}, error instanceof Error ? error : undefined)
  }

  let shutdownPromise: Promise<void> | null = null
  const shutdown = async (reason: string, exitCode: number, error?: unknown) => {
    if (shutdownPromise) {
      return shutdownPromise
    }

    shutdownPromise = (async () => {
      if (error) {
        logger.error(
          `Shutting down after ${reason}`,
          {},
          error instanceof Error ? error : new Error(String(error))
        )
      } else {
        logger.info(`Shutting down (${reason})`)
      }

      await Promise.allSettled([server.close(), state.searchService.close(), closePostgresDatabase()])
      process.exit(exitCode)
    })()

    return shutdownPromise
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT', 0)
  })

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM', 0)
  })

  process.on('uncaughtException', (error) => {
    void shutdown('uncaughtException', 1, error)
  })

  process.on('unhandledRejection', (reason) => {
    void shutdown('unhandledRejection', 1, reason)
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
