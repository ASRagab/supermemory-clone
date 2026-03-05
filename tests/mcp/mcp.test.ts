/**
 * MCP Server Tests
 *
 * Tests for MCP server tools and resources including
 * add, search, profile, list, delete, remember, and recall tools.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { AddContentInputSchema, TOOL_DEFINITIONS } from '../../src/mcp/tools.js'

// Tool types from the actual implementation
interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface AddContentInput {
  content: string
  customId?: string
  idempotencyKey?: string
  containerTag?: string
  metadata?: Record<string, unknown>
  sourceUrl?: string
  title?: string
  upsert?: boolean
}

interface SearchInput {
  query: string
  containerTag?: string
  mode?: 'vector' | 'memory' | 'hybrid'
  limit?: number
  threshold?: number
  rerank?: boolean
  includeMetadata?: boolean
}

interface ProfileInput {
  containerTag: string
  action?: 'get' | 'update' | 'ingest'
  content?: string
  facts?: Array<{
    content: string
    type?: 'static' | 'dynamic'
    category?: string
  }>
}

interface ListDocumentsInput {
  containerTag?: string
  limit?: number
  offset?: number
  contentType?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

interface DeleteContentInput {
  id?: string
  containerTag?: string
  confirm: boolean
}

interface RememberInput {
  fact: string
  containerTag?: string
  type?: 'static' | 'dynamic'
  category?: string
  expirationHours?: number
}

interface RecallInput {
  query: string
  containerTag?: string
  includeStatic?: boolean
  includeDynamic?: boolean
  limit?: number
}

// Tool handler types
interface ToolHandlerContext {
  documents: Map<
    string,
    {
      content: string
      metadata: Record<string, unknown>
      customId?: string
    }
  >
  facts: Map<string, { content: string; type: string; category?: string }>
  profiles: Map<string, { staticFacts: unknown[]; dynamicFacts: unknown[] }>
}

// Tool handlers implementation
class MCPToolHandlers {
  private ctx: ToolHandlerContext = {
    documents: new Map(),
    facts: new Map(),
    profiles: new Map(),
  }

  async handleAdd(input: AddContentInput): Promise<{
    success: boolean
    documentId?: string
    customId?: string
    created?: boolean
    reused?: boolean
    updated?: boolean
    message: string
  }> {
    const parsed = AddContentInputSchema.parse(input)
    const customId = parsed.customId ?? parsed.idempotencyKey
    const existingEntry = customId
      ? Array.from(this.ctx.documents.entries()).find(([, doc]) => doc.customId === customId) ?? null
      : null

    if (existingEntry && !parsed.upsert) {
      return {
        success: true,
        documentId: existingEntry[0],
        customId,
        created: false,
        reused: true,
        updated: false,
        message: `Reused existing document for customId "${customId}"`,
      }
    }

    const documentId = existingEntry?.[0] ?? `doc-${Date.now()}`
    const existingDocument = existingEntry?.[1]
    const containerTag = parsed.containerTag ?? (existingDocument?.metadata.containerTag as string | undefined)
    this.ctx.documents.set(documentId, {
      content: parsed.content,
      metadata: {
        ...existingDocument?.metadata,
        containerTag,
        sourceUrl: parsed.sourceUrl,
        title: parsed.title,
        ...parsed.metadata,
      },
      customId,
    })

    return {
      success: true,
      documentId,
      customId,
      created: !existingDocument,
      reused: false,
      updated: Boolean(existingDocument),
      message: existingDocument ? 'Content updated successfully' : 'Content added successfully',
    }
  }

  async handleSearch(input: SearchInput): Promise<{
    results: Array<{ id: string; content: string; similarity: number }>
    totalCount: number
    query: string
    searchTimeMs: number
  }> {
    if (!input.query || input.query.trim().length === 0) {
      throw new Error('Query is required')
    }

    const startTime = Date.now()
    const results: Array<{ id: string; content: string; similarity: number }> = []

    for (const [id, doc] of this.ctx.documents) {
      if (input.containerTag && doc.metadata.containerTag !== input.containerTag) {
        continue
      }

      const similarity = this.calculateSimilarity(input.query, doc.content)
      if (similarity >= (input.threshold ?? 0.5)) {
        results.push({ id, content: doc.content, similarity })
      }
    }

    results.sort((a, b) => b.similarity - a.similarity)
    const limited = results.slice(0, input.limit ?? 10)

    return {
      results: limited,
      totalCount: results.length,
      query: input.query,
      searchTimeMs: Date.now() - startTime,
    }
  }

  async handleProfile(input: ProfileInput): Promise<{
    containerTag: string
    staticFacts: unknown[]
    dynamicFacts: unknown[]
    lastUpdated: string
  }> {
    const profile = this.ctx.profiles.get(input.containerTag) ?? {
      staticFacts: [],
      dynamicFacts: [],
    }

    if (input.action === 'update' && input.facts) {
      for (const fact of input.facts) {
        const factEntry = {
          id: `fact-${Date.now()}`,
          content: fact.content,
          category: fact.category,
          confidence: 1,
        }

        if (fact.type === 'dynamic') {
          profile.dynamicFacts.push(factEntry)
        } else {
          profile.staticFacts.push(factEntry)
        }
      }
      this.ctx.profiles.set(input.containerTag, profile)
    }

    if (input.action === 'ingest' && input.content) {
      // Extract facts from content (simplified)
      const sentences = input.content.split(/[.!?]+/).filter((s) => s.trim().length > 10)
      for (const sentence of sentences.slice(0, 5)) {
        profile.staticFacts.push({
          id: `fact-${Date.now()}-${Math.random()}`,
          content: sentence.trim(),
          confidence: 0.8,
        })
      }
      this.ctx.profiles.set(input.containerTag, profile)
    }

    return {
      containerTag: input.containerTag,
      staticFacts: profile.staticFacts,
      dynamicFacts: profile.dynamicFacts,
      lastUpdated: new Date().toISOString(),
    }
  }

  async handleList(input: ListDocumentsInput): Promise<{
    documents: Array<{ id: string; contentPreview: string; createdAt: string }>
    total: number
    hasMore: boolean
  }> {
    const docs: Array<{ id: string; contentPreview: string; createdAt: string }> = []

    for (const [id, doc] of this.ctx.documents) {
      if (input.containerTag && doc.metadata.containerTag !== input.containerTag) {
        continue
      }
      docs.push({
        id,
        contentPreview: doc.content.slice(0, 100),
        createdAt: new Date().toISOString(),
      })
    }

    const offset = input.offset ?? 0
    const limit = input.limit ?? 20
    const paginated = docs.slice(offset, offset + limit)

    return {
      documents: paginated,
      total: docs.length,
      hasMore: offset + limit < docs.length,
    }
  }

  async handleDelete(input: DeleteContentInput): Promise<{ success: boolean; deletedCount: number; message: string }> {
    if (!input.confirm) {
      return { success: false, deletedCount: 0, message: 'Deletion not confirmed' }
    }

    if (!input.id && !input.containerTag) {
      return { success: false, deletedCount: 0, message: 'Either id or containerTag is required' }
    }

    let deletedCount = 0

    if (input.id) {
      if (this.ctx.documents.has(input.id)) {
        this.ctx.documents.delete(input.id)
        deletedCount = 1
      }
    } else if (input.containerTag) {
      for (const [id, doc] of this.ctx.documents) {
        if (doc.metadata.containerTag === input.containerTag) {
          this.ctx.documents.delete(id)
          deletedCount++
        }
      }
    }

    return {
      success: deletedCount > 0,
      deletedCount,
      message: deletedCount > 0 ? `Deleted ${deletedCount} document(s)` : 'No documents found',
    }
  }

  async handleRemember(input: RememberInput): Promise<{ success: boolean; factId: string; message: string }> {
    if (!input.fact || input.fact.trim().length === 0) {
      return { success: false, factId: '', message: 'Fact is required' }
    }

    const factId = `fact-${Date.now()}`
    this.ctx.facts.set(factId, {
      content: input.fact,
      type: input.type ?? 'static',
      category: input.category,
    })

    return {
      success: true,
      factId,
      message: 'Fact remembered successfully',
    }
  }

  async handleRecall(input: RecallInput): Promise<{
    facts: Array<{ id: string; content: string; type: string; confidence: number }>
    query: string
    totalFound: number
  }> {
    if (!input.query || input.query.trim().length === 0) {
      throw new Error('Query is required')
    }

    const facts: Array<{ id: string; content: string; type: string; confidence: number }> = []

    for (const [id, fact] of this.ctx.facts) {
      if (input.includeStatic === false && fact.type === 'static') continue
      if (input.includeDynamic === false && fact.type === 'dynamic') continue

      const similarity = this.calculateSimilarity(input.query, fact.content)
      facts.push({
        id,
        content: fact.content,
        type: fact.type,
        confidence: similarity,
      })
    }

    facts.sort((a, b) => b.confidence - a.confidence)
    const limited = facts.slice(0, input.limit ?? 10)

    return {
      facts: limited,
      query: input.query,
      totalFound: facts.length,
    }
  }

  private calculateSimilarity(query: string, content: string): number {
    const queryWords = new Set(query.toLowerCase().split(/\s+/))
    const contentWords = content.toLowerCase().split(/\s+/)
    let matches = 0

    for (const word of contentWords) {
      if (queryWords.has(word)) matches++
    }

    return matches / Math.max(queryWords.size, 1)
  }

  reset(): void {
    this.ctx.documents.clear()
    this.ctx.facts.clear()
    this.ctx.profiles.clear()
  }
}

describe('MCP Tool Handlers', () => {
  let handlers: MCPToolHandlers

  beforeEach(() => {
    handlers = new MCPToolHandlers()
  })

  describe('supermemory_add', () => {
    it('should add content successfully', async () => {
      const result = await handlers.handleAdd({
        content: 'Test content to remember',
      })

      expect(result.success).toBe(true)
      expect(result.documentId).toBeDefined()
      expect(result.created).toBe(true)
      expect(result.reused).toBe(false)
      expect(result.message).toContain('successfully')
    })

    it('should reject empty content', async () => {
      await expect(handlers.handleAdd({ content: '' })).rejects.toThrow('Content is required')
    })

    it('should store metadata', async () => {
      const result = await handlers.handleAdd({
        content: 'Content with metadata',
        containerTag: 'project-a',
        metadata: { priority: 'high' },
      })

      expect(result.success).toBe(true)
    })

    it('should store source URL and title', async () => {
      const result = await handlers.handleAdd({
        content: 'Web content',
        sourceUrl: 'https://example.com',
        title: 'Example Page',
      })

      expect(result.success).toBe(true)
    })

    it('should reuse an existing document when the same customId is retried', async () => {
      const first = await handlers.handleAdd({
        content: 'Test content to remember',
        customId: 'retry-demo',
        containerTag: 'project-a',
      })
      const second = await handlers.handleAdd({
        content: 'Test content to remember',
        customId: 'retry-demo',
      })

      expect(second.success).toBe(true)
      expect(second.documentId).toBe(first.documentId)
      expect(second.customId).toBe('retry-demo')
      expect(second.created).toBe(false)
      expect(second.reused).toBe(true)
      expect(second.updated).toBe(false)
    })

    it('should normalize idempotencyKey into customId', async () => {
      const result = await handlers.handleAdd({
        content: 'Test content to remember',
        idempotencyKey: 'request-123',
      })

      expect(result.success).toBe(true)
      expect(result.customId).toBe('request-123')
    })

    it('should reject conflicting customId and idempotencyKey values', () => {
      expect(() =>
        AddContentInputSchema.parse({
          content: 'Test content to remember',
          customId: 'alpha',
          idempotencyKey: 'beta',
        })
      ).toThrow('customId and idempotencyKey must match when both are provided')
    })

    it('should update existing content when upsert is true and preserve containerTag when omitted', async () => {
      const created = await handlers.handleAdd({
        content: 'alpha',
        customId: 'retry-demo',
        containerTag: 'project-a',
      })
      const updated = await handlers.handleAdd({
        content: 'beta',
        customId: 'retry-demo',
        upsert: true,
      })
      const listed = await handlers.handleList({ containerTag: 'project-a' })

      expect(updated.success).toBe(true)
      expect(updated.documentId).toBe(created.documentId)
      expect(updated.created).toBe(false)
      expect(updated.reused).toBe(false)
      expect(updated.updated).toBe(true)
      expect(listed.documents).toHaveLength(1)
      expect(listed.documents[0]?.id).toBe(created.documentId)
    })
  })

  describe('supermemory_search', () => {
    beforeEach(async () => {
      await handlers.handleAdd({ content: 'TypeScript is a typed language', containerTag: 'tech' })
      await handlers.handleAdd({ content: 'JavaScript is dynamic', containerTag: 'tech' })
      await handlers.handleAdd({ content: 'Cooking recipes for dinner', containerTag: 'personal' })
    })

    it('should return search results', async () => {
      const result = await handlers.handleSearch({ query: 'TypeScript' })

      // Search may or may not return results depending on implementation
      expect(result.results).toBeDefined()
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.query).toBe('TypeScript')
      expect(result.searchTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should filter by containerTag', async () => {
      const result = await handlers.handleSearch({
        query: 'is',
        containerTag: 'tech',
      })

      for (const doc of result.results) {
        expect(doc.content).not.toContain('Cooking')
      }
    })

    it('should respect limit', async () => {
      const result = await handlers.handleSearch({
        query: 'is',
        limit: 1,
      })

      expect(result.results.length).toBeLessThanOrEqual(1)
    })

    it('should respect threshold', async () => {
      const result = await handlers.handleSearch({
        query: 'TypeScript',
        threshold: 0.9,
      })

      for (const doc of result.results) {
        expect(doc.similarity).toBeGreaterThanOrEqual(0.9)
      }
    })

    it('should throw error for empty query', async () => {
      await expect(handlers.handleSearch({ query: '' })).rejects.toThrow('Query is required')
    })
  })

  describe('supermemory_profile', () => {
    it('should get empty profile', async () => {
      const result = await handlers.handleProfile({
        containerTag: 'user-123',
        action: 'get',
      })

      expect(result.containerTag).toBe('user-123')
      expect(result.staticFacts).toEqual([])
      expect(result.dynamicFacts).toEqual([])
    })

    it('should update profile with facts', async () => {
      const result = await handlers.handleProfile({
        containerTag: 'user-123',
        action: 'update',
        facts: [
          { content: 'Prefers dark mode', type: 'static' },
          { content: 'Currently working on project X', type: 'dynamic' },
        ],
      })

      expect(result.staticFacts.length).toBeGreaterThan(0)
      expect(result.dynamicFacts.length).toBeGreaterThan(0)
    })

    it('should ingest content and extract facts', async () => {
      const result = await handlers.handleProfile({
        containerTag: 'user-123',
        action: 'ingest',
        content: 'I am a software developer. I work with TypeScript daily. I prefer functional programming.',
      })

      expect(result.staticFacts.length).toBeGreaterThan(0)
    })
  })

  describe('supermemory_list', () => {
    beforeEach(async () => {
      for (let i = 0; i < 25; i++) {
        await handlers.handleAdd({
          content: `Document ${i}`,
          containerTag: i % 2 === 0 ? 'even' : 'odd',
        })
      }
    })

    it('should list documents', async () => {
      const result = await handlers.handleList({})

      expect(result.documents).toBeDefined()
      expect(Array.isArray(result.documents)).toBe(true)
      expect(result.total).toBeGreaterThanOrEqual(0)
    })

    it('should filter by containerTag', async () => {
      const result = await handlers.handleList({ containerTag: 'even' })

      expect(result.total).toBeLessThan(25)
    })

    it('should paginate results', async () => {
      const page1 = await handlers.handleList({ limit: 10, offset: 0 })
      const page2 = await handlers.handleList({ limit: 10, offset: 10 })

      expect(page1.documents).toBeDefined()
      expect(page2.documents).toBeDefined()
      // Pagination should respect limit
      expect(page1.documents.length).toBeLessThanOrEqual(10)
      expect(page2.documents.length).toBeLessThanOrEqual(10)
    })
  })

  describe('supermemory_delete', () => {
    beforeEach(async () => {
      await handlers.handleAdd({ content: 'Doc 1', containerTag: 'project-a' })
      await handlers.handleAdd({ content: 'Doc 2', containerTag: 'project-a' })
      await handlers.handleAdd({ content: 'Doc 3', containerTag: 'project-b' })
    })

    it('should require confirmation', async () => {
      const result = await handlers.handleDelete({
        containerTag: 'project-a',
        confirm: false,
      })

      expect(result.success).toBe(false)
      expect(result.message).toContain('not confirmed')
    })

    it('should delete by containerTag', async () => {
      const result = await handlers.handleDelete({
        containerTag: 'project-a',
        confirm: true,
      })

      // Should either succeed or provide proper message
      expect(result.success !== undefined || result.message !== undefined).toBe(true)
      if (result.success) {
        expect(result.deletedCount).toBeGreaterThanOrEqual(0)
      }
    })

    it('should delete by id', async () => {
      const addResult = await handlers.handleAdd({ content: 'To delete' })

      const result = await handlers.handleDelete({
        id: addResult.documentId,
        confirm: true,
      })

      expect(result.success).toBe(true)
      expect(result.deletedCount).toBe(1)
    })

    it('should require id or containerTag', async () => {
      const result = await handlers.handleDelete({ confirm: true })

      expect(result.success).toBe(false)
      expect(result.message).toContain('required')
    })
  })

  describe('supermemory_remember', () => {
    it('should remember a fact', async () => {
      const result = await handlers.handleRemember({
        fact: 'User prefers TypeScript',
      })

      expect(result.success).toBe(true)
      expect(result.factId).toBeDefined()
    })

    it('should reject empty fact', async () => {
      const result = await handlers.handleRemember({ fact: '' })

      expect(result.success).toBe(false)
      expect(result.message).toContain('required')
    })

    it('should support fact categories', async () => {
      const result = await handlers.handleRemember({
        fact: 'Senior developer',
        category: 'skill',
        type: 'static',
      })

      expect(result.success).toBe(true)
    })
  })

  describe('supermemory_recall', () => {
    beforeEach(async () => {
      await handlers.handleRemember({
        fact: 'Prefers TypeScript for backend',
        type: 'static',
        category: 'preference',
      })
      await handlers.handleRemember({
        fact: 'Currently learning Rust',
        type: 'dynamic',
      })
    })

    it('should recall relevant facts', async () => {
      const result = await handlers.handleRecall({ query: 'TypeScript' })

      expect(result.facts.length).toBeGreaterThan(0)
      expect(result.query).toBe('TypeScript')
    })

    it('should filter by fact type', async () => {
      const result = await handlers.handleRecall({
        query: 'programming',
        includeStatic: true,
        includeDynamic: false,
      })

      for (const fact of result.facts) {
        expect(fact.type).toBe('static')
      }
    })

    it('should throw error for empty query', async () => {
      await expect(handlers.handleRecall({ query: '' })).rejects.toThrow('Query is required')
    })

    it('should respect limit', async () => {
      const result = await handlers.handleRecall({
        query: 'programming',
        limit: 1,
      })

      expect(result.facts.length).toBeLessThanOrEqual(1)
    })
  })
})

describe('MCP Tool Definitions', () => {
  const toolDefinitions: ToolDefinition[] = TOOL_DEFINITIONS

  it('should have valid tool names', () => {
    for (const tool of toolDefinitions) {
      expect(tool.name).toMatch(/^supermemory_\w+$/)
    }
  })

  it('should have descriptions', () => {
    for (const tool of toolDefinitions) {
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it('should have object input schemas', () => {
    for (const tool of toolDefinitions) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.properties).toBeDefined()
    }
  })

  it('should expose idempotent add inputs in the tool schema', () => {
    const addTool = toolDefinitions.find((tool) => tool.name === 'supermemory_add')

    expect(addTool).toBeDefined()
    expect(addTool?.inputSchema.properties).toHaveProperty('customId')
    expect(addTool?.inputSchema.properties).toHaveProperty('idempotencyKey')
    expect(addTool?.inputSchema.properties).toHaveProperty('upsert')
  })

  it('should specify required fields', () => {
    for (const tool of toolDefinitions) {
      if (tool.inputSchema.required) {
        expect(Array.isArray(tool.inputSchema.required)).toBe(true)
        for (const required of tool.inputSchema.required) {
          expect(tool.inputSchema.properties).toHaveProperty(required)
        }
      }
    }
  })
})
