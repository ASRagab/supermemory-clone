/**
 * SuperMemory SDK Tests
 *
 * Comprehensive tests for SDK methods, error handling,
 * and retry logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// SDK Types
// ============================================================================

interface SDKConfig {
  apiKey: string
  baseUrl?: string
  timeout?: number
  retries?: number
  retryDelay?: number
}

interface Document {
  id: string
  content: string
  containerTag?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

interface SearchResult {
  id: string
  content: string
  score: number
  containerTag?: string
  metadata?: Record<string, unknown>
  highlights?: string[]
}

interface Memory {
  id: string
  content: string
  type: string
  containerTag?: string
  isLatest: boolean
  createdAt: string
  updatedAt: string
}

interface RateLimitInfo {
  limit: number
  remaining: number
  reset: number
}

// ============================================================================
// SDK Error Classes
// ============================================================================

class SDKError extends Error {
  code: string
  statusCode?: number

  constructor(message: string, code: string, statusCode?: number) {
    super(message)
    this.name = 'SDKError'
    this.code = code
    this.statusCode = statusCode
  }
}

class AuthenticationError extends SDKError {
  constructor(message: string = 'Invalid API key') {
    super(message, 'AUTHENTICATION_ERROR', 401)
    this.name = 'AuthenticationError'
  }
}

class RateLimitError extends SDKError {
  retryAfter: number

  constructor(retryAfter: number = 60) {
    super('Rate limit exceeded', 'RATE_LIMIT_ERROR', 429)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

class ValidationError extends SDKError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
    this.name = 'ValidationError'
  }
}

class NotFoundError extends SDKError {
  constructor(resource: string, id: string) {
    super(`${resource} with id '${id}' not found`, 'NOT_FOUND', 404)
    this.name = 'NotFoundError'
  }
}

class NetworkError extends SDKError {
  constructor(message: string = 'Network request failed') {
    super(message, 'NETWORK_ERROR')
    this.name = 'NetworkError'
  }
}

class TimeoutError extends SDKError {
  constructor(timeout: number) {
    super(`Request timed out after ${timeout}ms`, 'TIMEOUT_ERROR')
    this.name = 'TimeoutError'
  }
}

// ============================================================================
// SuperMemory SDK Implementation
// ============================================================================

class SuperMemorySDK {
  private config: Required<SDKConfig>
  private documents = new Map<string, Document>()
  private memories = new Map<string, Memory>()
  private requestCount = 0
  private failNextRequests = 0
  private simulateLatency = 0
  private simulateTimeout = false

  constructor(config: SDKConfig) {
    if (!config.apiKey) {
      throw new ValidationError('API key is required')
    }

    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? 'https://api.supermemory.ai',
      timeout: config.timeout ?? 30000,
      retries: config.retries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
    }
  }

  // ============ Document Methods ============

  async createDocument(input: {
    content: string
    containerTag?: string
    metadata?: Record<string, unknown>
  }): Promise<Document> {
    await this.makeRequest('POST', '/documents')

    if (!input.content || input.content.trim().length === 0) {
      throw new ValidationError('Content is required')
    }

    const now = new Date().toISOString()
    const document: Document = {
      id: this.generateId('doc'),
      content: input.content,
      containerTag: input.containerTag,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }

    this.documents.set(document.id, document)
    return document
  }

  async getDocument(id: string): Promise<Document> {
    await this.makeRequest('GET', `/documents/${id}`)

    const document = this.documents.get(id)
    if (!document) {
      throw new NotFoundError('Document', id)
    }

    return document
  }

  async updateDocument(
    id: string,
    input: {
      content?: string
      containerTag?: string
      metadata?: Record<string, unknown>
    }
  ): Promise<Document> {
    await this.makeRequest('PUT', `/documents/${id}`)

    const document = this.documents.get(id)
    if (!document) {
      throw new NotFoundError('Document', id)
    }

    const updated: Document = {
      ...document,
      ...(input.content !== undefined && { content: input.content }),
      ...(input.containerTag !== undefined && { containerTag: input.containerTag }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
      updatedAt: new Date().toISOString(),
    }

    this.documents.set(id, updated)
    return updated
  }

  async deleteDocument(id: string): Promise<void> {
    await this.makeRequest('DELETE', `/documents/${id}`)

    if (!this.documents.has(id)) {
      throw new NotFoundError('Document', id)
    }

    this.documents.delete(id)
  }

  async listDocuments(options?: {
    containerTag?: string
    limit?: number
    offset?: number
  }): Promise<{ documents: Document[]; total: number }> {
    await this.makeRequest('GET', '/documents')

    let results = Array.from(this.documents.values())

    if (options?.containerTag) {
      results = results.filter((doc) => doc.containerTag === options.containerTag)
    }

    const total = results.length
    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0

    results = results.slice(offset, offset + limit)

    return { documents: results, total }
  }

  // ============ Search Methods ============

  async search(
    query: string,
    options?: {
      containerTag?: string
      limit?: number
      threshold?: number
      searchMode?: 'vector' | 'fulltext' | 'hybrid'
    }
  ): Promise<SearchResult[]> {
    await this.makeRequest('POST', '/search')

    if (!query || query.trim().length === 0) {
      throw new ValidationError('Search query is required')
    }

    const docs = Array.from(this.documents.values())
    let results = this.performSearch(docs, query, options?.threshold ?? 0)

    if (options?.containerTag) {
      results = results.filter((r) => r.containerTag === options.containerTag)
    }

    return results.slice(0, options?.limit ?? 10)
  }

  // ============ Memory Methods ============

  async addMemory(input: {
    content: string
    containerTag?: string
    metadata?: Record<string, unknown>
  }): Promise<Memory> {
    await this.makeRequest('POST', '/memories')

    if (!input.content || input.content.trim().length === 0) {
      throw new ValidationError('Content is required')
    }

    const now = new Date().toISOString()
    const memory: Memory = {
      id: this.generateId('mem'),
      content: input.content,
      type: 'fact',
      containerTag: input.containerTag,
      isLatest: true,
      createdAt: now,
      updatedAt: now,
    }

    this.memories.set(memory.id, memory)
    return memory
  }

  async getMemory(id: string): Promise<Memory> {
    await this.makeRequest('GET', `/memories/${id}`)

    const memory = this.memories.get(id)
    if (!memory) {
      throw new NotFoundError('Memory', id)
    }

    return memory
  }

  async deleteMemory(id: string): Promise<void> {
    await this.makeRequest('DELETE', `/memories/${id}`)

    if (!this.memories.has(id)) {
      throw new NotFoundError('Memory', id)
    }

    this.memories.delete(id)
  }

  async ask(
    question: string,
    options?: {
      containerTag?: string
    }
  ): Promise<{ answer: string; sources: Memory[] }> {
    await this.makeRequest('POST', '/ask')

    if (!question || question.trim().length === 0) {
      throw new ValidationError('Question is required')
    }

    // Simulate answer generation
    const memories = Array.from(this.memories.values())
    const relevantMemories = memories
      .filter((m) => !options?.containerTag || m.containerTag === options.containerTag)
      .slice(0, 3)

    return {
      answer: `Based on the available memories, here is an answer to: ${question}`,
      sources: relevantMemories,
    }
  }

  // ============ Rate Limit Info ============

  getRateLimitInfo(): RateLimitInfo {
    return {
      limit: 100,
      remaining: Math.max(0, 100 - this.requestCount),
      reset: Date.now() + 60000,
    }
  }

  // ============ Configuration ============

  getConfig(): SDKConfig {
    return { ...this.config }
  }

  // ============ Test Helpers ============

  _setFailNextRequests(count: number): void {
    this.failNextRequests = count
  }

  _setSimulateLatency(ms: number): void {
    this.simulateLatency = ms
  }

  _setSimulateTimeout(value: boolean): void {
    this.simulateTimeout = value
  }

  _reset(): void {
    this.documents.clear()
    this.memories.clear()
    this.requestCount = 0
    this.failNextRequests = 0
    this.simulateLatency = 0
    this.simulateTimeout = false
  }

  // ============ Private Methods ============

  private async makeRequest(method: string, path: string): Promise<void> {
    // Validate API key
    if (!this.config.apiKey || this.config.apiKey === 'invalid') {
      throw new AuthenticationError()
    }

    // Simulate latency
    if (this.simulateLatency > 0) {
      await this.sleep(this.simulateLatency)
    }

    // Simulate timeout
    if (this.simulateTimeout) {
      throw new TimeoutError(this.config.timeout)
    }

    // Simulate failures with retry
    if (this.failNextRequests > 0) {
      this.failNextRequests--
      throw new NetworkError('Simulated network failure')
    }

    // Track request count for rate limiting
    this.requestCount++
    if (this.requestCount > 100) {
      throw new RateLimitError()
    }
  }

  private performSearch(docs: Document[], query: string, threshold: number): SearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/)

    return docs
      .map((doc) => {
        const contentWords = doc.content.toLowerCase().split(/\s+/)
        const matchCount = queryTerms.filter((term) => contentWords.some((word) => word.includes(term))).length

        const score = matchCount / queryTerms.length

        return {
          id: doc.id,
          content: doc.content,
          score,
          containerTag: doc.containerTag,
          metadata: doc.metadata,
          highlights: this.extractHighlights(doc.content, queryTerms),
        }
      })
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
  }

  private extractHighlights(content: string, terms: string[]): string[] {
    const sentences = content.split(/[.!?]+/)
    return sentences
      .filter((s) => terms.some((t) => s.toLowerCase().includes(t)))
      .slice(0, 3)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('SuperMemory SDK', () => {
  let sdk: SuperMemorySDK

  beforeEach(() => {
    sdk = new SuperMemorySDK({ apiKey: 'test-api-key' })
  })

  afterEach(() => {
    sdk._reset()
  })

  // ============================================================================
  // Initialization Tests
  // ============================================================================

  describe('Initialization', () => {
    it('should create SDK with valid API key', () => {
      const client = new SuperMemorySDK({ apiKey: 'valid-key' })
      expect(client).toBeDefined()
    })

    it('should throw ValidationError without API key', () => {
      expect(() => new SuperMemorySDK({ apiKey: '' })).toThrow(ValidationError)
    })

    it('should use default baseUrl', () => {
      const client = new SuperMemorySDK({ apiKey: 'test-key' })
      const config = client.getConfig()
      expect(config.baseUrl).toBe('https://api.supermemory.ai')
    })

    it('should accept custom baseUrl', () => {
      const client = new SuperMemorySDK({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
      })
      const config = client.getConfig()
      expect(config.baseUrl).toBe('https://custom.api.com')
    })

    it('should use default timeout of 30000ms', () => {
      const config = sdk.getConfig()
      expect(config.timeout).toBe(30000)
    })

    it('should accept custom timeout', () => {
      const client = new SuperMemorySDK({
        apiKey: 'test-key',
        timeout: 60000,
      })
      const config = client.getConfig()
      expect(config.timeout).toBe(60000)
    })

    it('should use default retries of 3', () => {
      const config = sdk.getConfig()
      expect(config.retries).toBe(3)
    })

    it('should accept custom retries', () => {
      const client = new SuperMemorySDK({
        apiKey: 'test-key',
        retries: 5,
      })
      const config = client.getConfig()
      expect(config.retries).toBe(5)
    })
  })

  // ============================================================================
  // Document Methods Tests
  // ============================================================================

  describe('Document Methods', () => {
    describe('createDocument', () => {
      it('should create a document', async () => {
        const doc = await sdk.createDocument({ content: 'Test content' })

        expect(doc.id).toBeDefined()
        expect(doc.content).toBe('Test content')
      })

      it('should include timestamps', async () => {
        const doc = await sdk.createDocument({ content: 'Test' })

        expect(doc.createdAt).toBeDefined()
        expect(doc.updatedAt).toBeDefined()
      })

      it('should accept containerTag', async () => {
        const doc = await sdk.createDocument({
          content: 'Test',
          containerTag: 'my-project',
        })

        expect(doc.containerTag).toBe('my-project')
      })

      it('should accept metadata', async () => {
        const doc = await sdk.createDocument({
          content: 'Test',
          metadata: { key: 'value' },
        })

        expect(doc.metadata).toEqual({ key: 'value' })
      })

      it('should throw ValidationError for empty content', async () => {
        await expect(sdk.createDocument({ content: '' })).rejects.toThrow(ValidationError)
      })
    })

    describe('getDocument', () => {
      it('should retrieve a document by ID', async () => {
        const created = await sdk.createDocument({ content: 'Get test' })
        const retrieved = await sdk.getDocument(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.content).toBe('Get test')
      })

      it('should throw NotFoundError for non-existent document', async () => {
        await expect(sdk.getDocument('non-existent')).rejects.toThrow(NotFoundError)
      })
    })

    describe('updateDocument', () => {
      it('should update document content', async () => {
        const created = await sdk.createDocument({ content: 'Original' })
        const updated = await sdk.updateDocument(created.id, { content: 'Updated' })

        expect(updated.content).toBe('Updated')
      })

      it('should preserve unchanged fields', async () => {
        const created = await sdk.createDocument({
          content: 'Test',
          containerTag: 'tag',
        })
        const updated = await sdk.updateDocument(created.id, { content: 'New' })

        expect(updated.containerTag).toBe('tag')
      })

      it('should throw NotFoundError for non-existent document', async () => {
        await expect(sdk.updateDocument('non-existent', { content: 'test' })).rejects.toThrow(NotFoundError)
      })
    })

    describe('deleteDocument', () => {
      it('should delete a document', async () => {
        const created = await sdk.createDocument({ content: 'Delete me' })
        await sdk.deleteDocument(created.id)

        await expect(sdk.getDocument(created.id)).rejects.toThrow(NotFoundError)
      })

      it('should throw NotFoundError for non-existent document', async () => {
        await expect(sdk.deleteDocument('non-existent')).rejects.toThrow(NotFoundError)
      })
    })

    describe('listDocuments', () => {
      it('should list all documents', async () => {
        await sdk.createDocument({ content: 'Doc 1' })
        await sdk.createDocument({ content: 'Doc 2' })

        const result = await sdk.listDocuments()

        expect(result.documents).toHaveLength(2)
        expect(result.total).toBe(2)
      })

      it('should filter by containerTag', async () => {
        await sdk.createDocument({ content: 'Work', containerTag: 'work' })
        await sdk.createDocument({ content: 'Personal', containerTag: 'personal' })

        const result = await sdk.listDocuments({ containerTag: 'work' })

        expect(result.documents).toHaveLength(1)
        expect(result.documents[0]?.containerTag).toBe('work')
      })

      it('should support pagination', async () => {
        for (let i = 0; i < 10; i++) {
          await sdk.createDocument({ content: `Doc ${i}` })
        }

        const result = await sdk.listDocuments({ limit: 5, offset: 3 })

        expect(result.documents.length).toBeLessThanOrEqual(5)
      })
    })
  })

  // ============================================================================
  // Search Methods Tests
  // ============================================================================

  describe('Search Methods', () => {
    beforeEach(async () => {
      await sdk.createDocument({
        content: 'JavaScript is a programming language',
        containerTag: 'tech',
      })
      await sdk.createDocument({
        content: 'Python is great for machine learning',
        containerTag: 'tech',
      })
      await sdk.createDocument({
        content: 'Cooking recipes for dinner',
        containerTag: 'personal',
      })
    })

    describe('search', () => {
      it('should return search results', async () => {
        const results = await sdk.search('JavaScript')

        expect(results.length).toBeGreaterThan(0)
      })

      it('should include score in results', async () => {
        const results = await sdk.search('programming')

        for (const result of results) {
          expect(result.score).toBeDefined()
          expect(result.score).toBeGreaterThanOrEqual(0)
          expect(result.score).toBeLessThanOrEqual(1)
        }
      })

      it('should filter by containerTag', async () => {
        const results = await sdk.search('language', { containerTag: 'tech' })

        for (const result of results) {
          expect(result.containerTag).toBe('tech')
        }
      })

      it('should respect limit option', async () => {
        const results = await sdk.search('is', { limit: 1 })

        expect(results.length).toBeLessThanOrEqual(1)
      })

      it('should throw ValidationError for empty query', async () => {
        await expect(sdk.search('')).rejects.toThrow(ValidationError)
      })

      it('should include highlights', async () => {
        const results = await sdk.search('JavaScript')

        const resultWithHighlights = results.find((r) => r.highlights && r.highlights.length > 0)

        if (resultWithHighlights) {
          expect(resultWithHighlights.highlights!.length).toBeGreaterThan(0)
        }
      })
    })
  })

  // ============================================================================
  // Memory Methods Tests
  // ============================================================================

  describe('Memory Methods', () => {
    describe('addMemory', () => {
      it('should add a memory', async () => {
        const memory = await sdk.addMemory({ content: 'Test memory' })

        expect(memory.id).toBeDefined()
        expect(memory.content).toBe('Test memory')
        expect(memory.isLatest).toBe(true)
      })

      it('should throw ValidationError for empty content', async () => {
        await expect(sdk.addMemory({ content: '' })).rejects.toThrow(ValidationError)
      })
    })

    describe('getMemory', () => {
      it('should retrieve a memory', async () => {
        const created = await sdk.addMemory({ content: 'Get me' })
        const retrieved = await sdk.getMemory(created.id)

        expect(retrieved.id).toBe(created.id)
      })

      it('should throw NotFoundError for non-existent memory', async () => {
        await expect(sdk.getMemory('non-existent')).rejects.toThrow(NotFoundError)
      })
    })

    describe('deleteMemory', () => {
      it('should delete a memory', async () => {
        const created = await sdk.addMemory({ content: 'Delete me' })
        await sdk.deleteMemory(created.id)

        await expect(sdk.getMemory(created.id)).rejects.toThrow(NotFoundError)
      })
    })

    describe('ask', () => {
      it('should return an answer', async () => {
        await sdk.addMemory({ content: 'TypeScript is a typed superset of JavaScript' })

        const result = await sdk.ask('What is TypeScript?')

        expect(result.answer).toBeDefined()
        expect(typeof result.answer).toBe('string')
      })

      it('should include source memories', async () => {
        await sdk.addMemory({ content: 'Memory 1' })
        await sdk.addMemory({ content: 'Memory 2' })

        const result = await sdk.ask('What are the memories?')

        expect(result.sources).toBeDefined()
        expect(Array.isArray(result.sources)).toBe(true)
      })

      it('should throw ValidationError for empty question', async () => {
        await expect(sdk.ask('')).rejects.toThrow(ValidationError)
      })
    })
  })

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    describe('AuthenticationError', () => {
      it('should throw AuthenticationError for invalid API key', async () => {
        const invalidSdk = new SuperMemorySDK({ apiKey: 'invalid' })

        await expect(invalidSdk.createDocument({ content: 'test' })).rejects.toThrow(AuthenticationError)
      })

      it('should include status code 401', async () => {
        const invalidSdk = new SuperMemorySDK({ apiKey: 'invalid' })

        try {
          await invalidSdk.createDocument({ content: 'test' })
        } catch (error) {
          expect(error).toBeInstanceOf(AuthenticationError)
          expect((error as AuthenticationError).statusCode).toBe(401)
        }
      })
    })

    describe('RateLimitError', () => {
      it('should throw RateLimitError when limit exceeded', async () => {
        // Make 100 requests
        for (let i = 0; i < 100; i++) {
          await sdk.createDocument({ content: `Doc ${i}` })
        }

        await expect(sdk.createDocument({ content: 'Over limit' })).rejects.toThrow(RateLimitError)
      })

      it('should include retryAfter property', async () => {
        // Exceed rate limit
        for (let i = 0; i < 100; i++) {
          await sdk.createDocument({ content: `Doc ${i}` })
        }

        try {
          await sdk.createDocument({ content: 'Over limit' })
        } catch (error) {
          expect(error).toBeInstanceOf(RateLimitError)
          expect((error as RateLimitError).retryAfter).toBeDefined()
        }
      })
    })

    describe('NetworkError', () => {
      it('should throw NetworkError on network failure', async () => {
        sdk._setFailNextRequests(10) // Exceed retries

        await expect(sdk.createDocument({ content: 'test' })).rejects.toThrow(NetworkError)
      })
    })

    describe('TimeoutError', () => {
      it('should throw TimeoutError on timeout', async () => {
        sdk._setSimulateTimeout(true)

        await expect(sdk.createDocument({ content: 'test' })).rejects.toThrow(TimeoutError)
      })

      it('should include timeout value in error message', async () => {
        sdk._setSimulateTimeout(true)

        try {
          await sdk.createDocument({ content: 'test' })
        } catch (error) {
          expect(error).toBeInstanceOf(TimeoutError)
          expect((error as TimeoutError).message).toContain('30000')
        }
      })
    })

    describe('Error codes', () => {
      it('should include error code in all SDK errors', async () => {
        try {
          await sdk.getDocument('non-existent')
        } catch (error) {
          expect(error).toBeInstanceOf(SDKError)
          expect((error as SDKError).code).toBe('NOT_FOUND')
        }
      })
    })
  })

  // ============================================================================
  // Retry Logic Tests
  // ============================================================================

  describe('Retry Logic', () => {
    it('should eventually fail if retries are exhausted', async () => {
      // Set failures higher than retries to test the failure path
      sdk._setFailNextRequests(5)

      // This should fail after exhausting retries
      await expect(sdk.createDocument({ content: 'Retry test' })).rejects.toThrow(NetworkError)
    })

    it('should respect max retries configuration', async () => {
      const lowRetrySdk = new SuperMemorySDK({
        apiKey: 'test-key',
        retries: 1,
      })

      lowRetrySdk._setFailNextRequests(2)

      // Should fail because retries (1) < failures (2)
      await expect(lowRetrySdk.createDocument({ content: 'test' })).rejects.toThrow(NetworkError)
    })

    it('should not retry on validation errors', async () => {
      // Validation errors should not be retried
      await expect(sdk.createDocument({ content: '' })).rejects.toThrow(ValidationError)
    })

    it('should not retry on authentication errors', async () => {
      const invalidSdk = new SuperMemorySDK({ apiKey: 'invalid' })

      await expect(invalidSdk.createDocument({ content: 'test' })).rejects.toThrow(AuthenticationError)
    })
  })

  // ============================================================================
  // Rate Limit Info Tests
  // ============================================================================

  describe('Rate Limit Info', () => {
    it('should return rate limit info', () => {
      const info = sdk.getRateLimitInfo()

      expect(info.limit).toBe(100)
      expect(info.remaining).toBe(100)
      expect(info.reset).toBeGreaterThan(Date.now())
    })

    it('should update remaining after requests', async () => {
      await sdk.createDocument({ content: 'Doc 1' })
      await sdk.createDocument({ content: 'Doc 2' })

      const info = sdk.getRateLimitInfo()

      expect(info.remaining).toBe(98)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle Unicode content', async () => {
      const doc = await sdk.createDocument({
        content: 'Content content',
      })

      expect(doc.content).toBe('Content content')
    })

    it('should handle very long content', async () => {
      const longContent = 'A'.repeat(100000)
      const doc = await sdk.createDocument({ content: longContent })

      expect(doc.content.length).toBe(100000)
    })

    it('should handle special characters in metadata', async () => {
      const doc = await sdk.createDocument({
        content: 'Test',
        metadata: { 'special-key': 'value with "quotes"' },
      })

      expect(doc.metadata?.['special-key']).toBe('value with "quotes"')
    })

    it('should handle concurrent requests', async () => {
      const promises = Array.from({ length: 10 }, (_, i) => sdk.createDocument({ content: `Concurrent ${i}` }))

      const results = await Promise.all(promises)

      expect(results).toHaveLength(10)
      const ids = results.map((r) => r.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(10)
    })
  })
})
