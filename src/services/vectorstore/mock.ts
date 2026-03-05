/**
 * Mock Vector Store
 *
 * A configurable mock implementation for testing.
 * Allows simulating various behaviors including errors,
 * delays, and specific search results.
 */

import {
  VectorEntry,
  VectorSearchResult,
  SearchOptions,
  AddOptions,
  DeleteOptions,
  VectorStoreConfig,
  VectorStoreStats,
  BatchResult,
} from './types.js'
import { BaseVectorStore, validateVector } from './base.js'

/**
 * Mock configuration options
 */
export interface MockVectorStoreOptions {
  /** Simulate initialization delay in ms */
  initDelay?: number

  /** Simulate operation delay in ms */
  operationDelay?: number

  /** Throw error on specific operations */
  failOn?: {
    initialize?: boolean | Error
    add?: boolean | Error
    search?: boolean | Error
    delete?: boolean | Error
    get?: boolean | Error
  }

  /** Pre-populate with entries */
  initialEntries?: VectorEntry[]

  /** Fixed search results to return */
  fixedSearchResults?: VectorSearchResult[]

  /** Record all operations for assertions */
  recordOperations?: boolean
}

/**
 * Recorded operation for testing assertions
 */
export interface RecordedOperation {
  type: 'initialize' | 'add' | 'addBatch' | 'update' | 'delete' | 'get' | 'exists' | 'search' | 'clear' | 'close'
  timestamp: Date
  args?: unknown
  result?: unknown
  error?: Error
}

/**
 * Mock Vector Store for Testing
 */
export class MockVectorStore extends BaseVectorStore {
  private entries: Map<string, VectorEntry> = new Map()
  private initialized = false
  private readonly mockOptions: MockVectorStoreOptions
  private operations: RecordedOperation[] = []

  constructor(config: VectorStoreConfig, mockOptions: MockVectorStoreOptions = {}) {
    super({
      ...config,
      provider: 'memory', // Use memory as base provider type
    })
    this.mockOptions = mockOptions
  }

  /**
   * Get recorded operations (for test assertions)
   */
  getOperations(): RecordedOperation[] {
    return [...this.operations]
  }

  /**
   * Clear recorded operations
   */
  clearOperations(): void {
    this.operations = []
  }

  /**
   * Get last operation of a specific type
   */
  getLastOperation(type: RecordedOperation['type']): RecordedOperation | undefined {
    return [...this.operations].reverse().find((op) => op.type === type)
  }

  /**
   * Record an operation
   */
  private recordOp(type: RecordedOperation['type'], args?: unknown, result?: unknown, error?: Error): void {
    if (this.mockOptions.recordOperations !== false) {
      this.operations.push({
        type,
        timestamp: new Date(),
        args,
        result,
        error,
      })
    }
  }

  /**
   * Simulate delay if configured
   */
  private async delay(type: 'init' | 'operation'): Promise<void> {
    const ms = type === 'init' ? this.mockOptions.initDelay : this.mockOptions.operationDelay

    if (ms && ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
  }

  /**
   * Check if should fail and throw if so
   */
  private checkFail(operation: keyof NonNullable<MockVectorStoreOptions['failOn']>): void {
    const failConfig = this.mockOptions.failOn?.[operation]
    if (failConfig) {
      if (failConfig instanceof Error) {
        throw failConfig
      }
      throw new Error(`Mock error: ${operation} failed`)
    }
  }

  /**
   * Initialize the mock store
   */
  async initialize(): Promise<void> {
    await this.delay('init')
    this.checkFail('initialize')

    // Populate initial entries
    if (this.mockOptions.initialEntries) {
      for (const entry of this.mockOptions.initialEntries) {
        this.entries.set(entry.id, { ...entry })
      }
    }

    this.initialized = true
    this.recordOp('initialize')
  }

  /**
   * Add a single vector entry
   */
  async add(entry: VectorEntry, options?: AddOptions): Promise<void> {
    await this.delay('operation')
    this.checkFail('add')
    this.validateEntry(entry)

    if (this.entries.has(entry.id) && !options?.overwrite) {
      const error = new Error(`Entry with ID ${entry.id} already exists`)
      this.recordOp('add', { entry, options }, undefined, error)
      throw error
    }

    this.entries.set(entry.id, {
      ...entry,
      createdAt: entry.createdAt ?? new Date(),
      updatedAt: new Date(),
    })

    this.recordOp('add', { entry, options })
    this.emit('add', { id: entry.id })
  }

  /**
   * Add multiple vector entries
   */
  async addBatch(entries: VectorEntry[], options?: AddOptions): Promise<BatchResult> {
    await this.delay('operation')

    const result: BatchResult = {
      successful: 0,
      failed: 0,
      errors: [],
    }

    for (const entry of entries) {
      try {
        await this.add(entry, options)
        result.successful++
      } catch (error) {
        result.failed++
        result.errors?.push({
          id: entry.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    this.recordOp('addBatch', { entries, options }, result)
    return result
  }

  /**
   * Update an existing vector entry
   */
  async update(id: string, updates: Partial<VectorEntry>): Promise<boolean> {
    await this.delay('operation')

    const existing = this.entries.get(id)
    if (!existing) {
      this.recordOp('update', { id, updates }, false)
      return false
    }

    if (updates.embedding) {
      validateVector(updates.embedding, this.config.dimensions)
    }

    this.entries.set(id, {
      ...existing,
      ...updates,
      id, // Ensure ID unchanged
      updatedAt: new Date(),
    })

    this.recordOp('update', { id, updates }, true)
    this.emit('update', { id })
    return true
  }

  /**
   * Delete vector entries
   */
  async delete(options: DeleteOptions): Promise<number> {
    await this.delay('operation')
    this.checkFail('delete')

    let deleted = 0

    if (options.deleteAll) {
      deleted = this.entries.size
      this.entries.clear()
    } else if (options.ids && options.ids.length > 0) {
      for (const id of options.ids) {
        if (this.entries.delete(id)) {
          deleted++
        }
      }
    } else if (options.filter) {
      for (const [id, entry] of this.entries) {
        if (this.matchesFilter(entry.metadata, options.filter)) {
          this.entries.delete(id)
          deleted++
        }
      }
    }

    this.recordOp('delete', options, deleted)

    if (deleted > 0) {
      this.emit('delete', { count: deleted })
    }

    return deleted
  }

  /**
   * Get a vector entry by ID
   */
  async get(id: string): Promise<VectorEntry | null> {
    await this.delay('operation')
    this.checkFail('get')

    const entry = this.entries.get(id) ?? null
    this.recordOp('get', { id }, entry)
    return entry ? { ...entry } : null
  }

  /**
   * Check if a vector entry exists
   */
  async exists(id: string): Promise<boolean> {
    await this.delay('operation')

    const exists = this.entries.has(id)
    this.recordOp('exists', { id }, exists)
    return exists
  }

  /**
   * Search for similar vectors
   */
  async search(query: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
    await this.delay('operation')
    this.checkFail('search')
    validateVector(query, this.config.dimensions)

    // Return fixed results if configured
    if (this.mockOptions.fixedSearchResults) {
      this.recordOp('search', { query, options }, this.mockOptions.fixedSearchResults)
      return this.mockOptions.fixedSearchResults
    }

    const opts = this.mergeOptions(options)

    // Perform actual similarity search
    let candidates = Array.from(this.entries.values())
    candidates = this.applyFilters(candidates, opts.filters)

    const results: VectorSearchResult[] = []
    for (const entry of candidates) {
      const score = this.calculateSimilarity(query, entry.embedding)

      if (score >= opts.threshold) {
        results.push({
          id: entry.id,
          score,
          embedding: opts.includeVectors ? entry.embedding : undefined,
          metadata: opts.includeMetadata ? entry.metadata : {},
        })
      }
    }

    results.sort((a, b) => b.score - a.score)
    const limited = results.slice(0, opts.limit)

    this.recordOp('search', { query, options }, limited)
    this.emit('search', { resultsCount: limited.length })

    return limited
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<VectorStoreStats> {
    return {
      totalVectors: this.entries.size,
      dimensions: this.config.dimensions,
      indexType: 'flat',
      metric: this.config.metric ?? 'cosine',
      indexBuilt: true,
      namespaces: ['default'],
    }
  }

  /**
   * Clear all vectors from the store
   */
  async clear(): Promise<void> {
    this.entries.clear()
    this.recordOp('clear')
    this.emit('delete', { deleteAll: true })
  }

  /**
   * Close the vector store
   */
  async close(): Promise<void> {
    this.entries.clear()
    this.initialized = false
    this.recordOp('close')
  }

  /**
   * Get all entries (for testing)
   */
  async getAllEntries(): Promise<VectorEntry[]> {
    return Array.from(this.entries.values())
  }

  /**
   * Set entries directly (for test setup)
   */
  setEntries(entries: VectorEntry[]): void {
    this.entries.clear()
    for (const entry of entries) {
      this.entries.set(entry.id, entry)
    }
  }
}

/**
 * Create a mock vector store
 */
export function createMockVectorStore(
  dimensions: number = 1536,
  mockOptions: MockVectorStoreOptions = {}
): MockVectorStore {
  return new MockVectorStore(
    {
      provider: 'memory',
      dimensions,
    },
    mockOptions
  )
}
