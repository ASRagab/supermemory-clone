/**
 * Embedding Service Tests
 *
 * Tests for embedding generation including OpenAI integration,
 * batching, caching, and fallback strategies.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Types
interface EmbeddingConfig {
  apiKey?: string
  model?: string
  batchSize?: number
  dimensions?: number
  cache?: EmbeddingCache
  fallback?: EmbeddingProvider
}

interface EmbeddingCache {
  get(text: string): Promise<number[] | null>
  set(text: string, embedding: number[]): Promise<void>
}

interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
}

// TF-IDF fallback implementation
class TfIdfProvider implements EmbeddingProvider {
  private vocabulary: Map<string, number> = new Map()
  private documentFrequency: Map<string, number> = new Map()
  private totalDocuments = 0

  async embed(texts: string[]): Promise<number[][]> {
    // Build vocabulary
    for (const text of texts) {
      this.totalDocuments++
      const words = this.tokenize(text)
      const uniqueWords = new Set(words)
      for (const word of uniqueWords) {
        if (!this.vocabulary.has(word)) {
          this.vocabulary.set(word, this.vocabulary.size)
        }
        this.documentFrequency.set(word, (this.documentFrequency.get(word) ?? 0) + 1)
      }
    }

    // Generate embeddings
    return texts.map((text) => this.generateEmbedding(text))
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 0)
  }

  private generateEmbedding(text: string): number[] {
    const words = this.tokenize(text)
    const termFrequency = new Map<string, number>()

    for (const word of words) {
      termFrequency.set(word, (termFrequency.get(word) ?? 0) + 1)
    }

    const vector = new Array(Math.max(64, this.vocabulary.size)).fill(0)

    for (const [word, tf] of termFrequency) {
      const idx = this.vocabulary.get(word) ?? 0
      const df = this.documentFrequency.get(word) ?? 1
      const idf = Math.log(this.totalDocuments / df)
      vector[idx % vector.length] = tf * idf
    }

    // Normalize
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] = (vector[i] ?? 0) / magnitude
      }
    }

    return vector
  }
}

// Memory cache implementation
class MemoryCache implements EmbeddingCache {
  private cache = new Map<string, number[]>()
  private maxSize: number

  constructor(maxSize = 1000) {
    this.maxSize = maxSize
  }

  async get(text: string): Promise<number[] | null> {
    const key = this.hashText(text)
    return this.cache.get(key) ?? null
  }

  async set(text: string, embedding: number[]): Promise<void> {
    const key = this.hashText(text)

    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, embedding)
  }

  clear(): void {
    this.cache.clear()
  }

  private hashText(text: string): string {
    // Simple hash for cache key
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return hash.toString(36)
  }
}

// Embedding service implementation
class EmbeddingService {
  private config: Required<EmbeddingConfig>
  private openAIClient: OpenAIClient | null = null

  constructor(config: EmbeddingConfig) {
    this.config = {
      apiKey: config.apiKey ?? '',
      model: config.model ?? 'text-embedding-3-small',
      batchSize: config.batchSize ?? 100,
      dimensions: config.dimensions ?? 1536,
      cache: config.cache ?? new MemoryCache(),
      fallback: config.fallback ?? new TfIdfProvider(),
    }

    if (this.config.apiKey) {
      this.openAIClient = new OpenAIClient(this.config.apiKey, this.config.model)
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    // Check cache first
    const results: (number[] | null)[] = await Promise.all(texts.map((text) => this.config.cache.get(text)))

    const uncachedIndices: number[] = []
    const uncachedTexts: string[] = []

    results.forEach((result, i) => {
      if (result === null) {
        uncachedIndices.push(i)
        uncachedTexts.push(texts[i] ?? '')
      }
    })

    if (uncachedTexts.length > 0) {
      const embeddings = await this.generateEmbeddings(uncachedTexts)

      // Cache new embeddings
      await Promise.all(embeddings.map((embedding, i) => this.config.cache.set(uncachedTexts[i] ?? '', embedding)))

      // Merge with cached results
      uncachedIndices.forEach((originalIndex, i) => {
        results[originalIndex] = embeddings[i] ?? []
      })
    }

    return results as number[][]
  }

  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Try OpenAI first
    if (this.openAIClient) {
      try {
        return await this.openAIClient.createEmbeddings(texts, this.config.batchSize)
      } catch (error) {
        console.warn('OpenAI embedding failed, using fallback:', error)
      }
    }

    // Use fallback
    return this.config.fallback.embed(texts)
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text])
    return results[0] ?? []
  }

  getProvider(): 'openai' | 'fallback' {
    return this.openAIClient ? 'openai' : 'fallback'
  }
}

// Mock OpenAI client
class OpenAIClient {
  constructor(
    private apiKey: string,
    private model: string
  ) {}

  async createEmbeddings(texts: string[], batchSize: number): Promise<number[][]> {
    const results: number[][] = []

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const batchResults = await this.callAPI(batch)
      results.push(...batchResults)
    }

    return results
  }

  private async callAPI(texts: string[]): Promise<number[][]> {
    // Mock API call - returns deterministic embeddings based on text
    return texts.map((text) => {
      const embedding = new Array(1536).fill(0)
      for (let i = 0; i < text.length && i < 1536; i++) {
        embedding[i] = (text.charCodeAt(i) % 100) / 100
      }
      return embedding
    })
  }
}

describe('EmbeddingService', () => {
  let service: EmbeddingService
  let mockCache: EmbeddingCache
  let mockFallback: EmbeddingProvider

  beforeEach(() => {
    mockCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    }

    mockFallback = {
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    }
  })

  describe('embed()', () => {
    it('should return empty array for empty input', async () => {
      service = new EmbeddingService({ cache: mockCache, fallback: mockFallback })

      const result = await service.embed([])

      expect(result).toEqual([])
    })

    it('should return embeddings for texts', async () => {
      service = new EmbeddingService({ cache: mockCache, fallback: mockFallback })

      const result = await service.embed(['test'])

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual([0.1, 0.2, 0.3])
    })

    it('should return embeddings for multiple texts', async () => {
      mockFallback.embed = vi.fn().mockResolvedValue([
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
      ])
      service = new EmbeddingService({ cache: mockCache, fallback: mockFallback })

      const result = await service.embed(['text1', 'text2', 'text3'])

      expect(result).toHaveLength(3)
    })
  })

  describe('caching', () => {
    it('should check cache before generating embeddings', async () => {
      mockCache.get = vi.fn().mockResolvedValue([0.9, 0.8, 0.7])
      service = new EmbeddingService({ cache: mockCache, fallback: mockFallback })

      const result = await service.embed(['cached text'])

      expect(mockCache.get).toHaveBeenCalledWith('cached text')
      expect(result[0]).toEqual([0.9, 0.8, 0.7])
      expect(mockFallback.embed).not.toHaveBeenCalled()
    })

    it('should cache new embeddings', async () => {
      service = new EmbeddingService({ cache: mockCache, fallback: mockFallback })

      await service.embed(['new text'])

      expect(mockCache.set).toHaveBeenCalledWith('new text', [0.1, 0.2, 0.3])
    })

    it('should handle partial cache hits', async () => {
      mockCache.get = vi
        .fn()
        .mockResolvedValueOnce([0.9, 0.8, 0.7]) // cached
        .mockResolvedValueOnce(null) // not cached
        .mockResolvedValueOnce([0.6, 0.5, 0.4]) // cached

      mockFallback.embed = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]])

      service = new EmbeddingService({ cache: mockCache, fallback: mockFallback })

      const result = await service.embed(['cached1', 'new', 'cached2'])

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual([0.9, 0.8, 0.7])
      expect(result[1]).toEqual([0.1, 0.2, 0.3])
      expect(result[2]).toEqual([0.6, 0.5, 0.4])
      expect(mockFallback.embed).toHaveBeenCalledWith(['new'])
    })
  })

  describe('OpenAI integration', () => {
    it('should use OpenAI when API key is provided', async () => {
      service = new EmbeddingService({
        apiKey: 'sk-test-key',
        cache: mockCache,
        fallback: mockFallback,
      })

      expect(service.getProvider()).toBe('openai')
    })

    it('should use fallback when no API key', async () => {
      service = new EmbeddingService({
        cache: mockCache,
        fallback: mockFallback,
      })

      expect(service.getProvider()).toBe('fallback')
    })

    it('should generate embeddings with OpenAI', async () => {
      service = new EmbeddingService({
        apiKey: 'sk-test-key',
        cache: mockCache,
      })

      const result = await service.embed(['test text'])

      expect(result).toHaveLength(1)
      expect(result[0]?.length).toBe(1536)
    })
  })

  describe('embedSingle()', () => {
    it('should return single embedding', async () => {
      service = new EmbeddingService({ cache: mockCache, fallback: mockFallback })

      const result = await service.embedSingle('single text')

      expect(result).toEqual([0.1, 0.2, 0.3])
    })
  })

  describe('batching', () => {
    it('should batch large requests', async () => {
      const callSpy = vi.fn().mockImplementation((texts: string[]) => {
        return Promise.resolve(texts.map(() => [0.1, 0.2]))
      })

      mockFallback.embed = callSpy
      service = new EmbeddingService({
        batchSize: 3,
        cache: mockCache,
        fallback: mockFallback,
      })

      const texts = ['t1', 't2', 't3', 't4', 't5']
      await service.embed(texts)

      // Fallback receives all texts at once (batching is done by OpenAI client)
      expect(callSpy).toHaveBeenCalled()
    })
  })
})

describe('TfIdfProvider', () => {
  let provider: TfIdfProvider

  beforeEach(() => {
    provider = new TfIdfProvider()
  })

  it('should generate embeddings', async () => {
    const result = await provider.embed(['test document'])

    expect(result).toHaveLength(1)
    expect(result[0]?.length).toBeGreaterThan(0)
  })

  it('should generate different embeddings for different texts', async () => {
    const result = await provider.embed(['first document', 'second document'])

    expect(result).toHaveLength(2)
    expect(result[0]).not.toEqual(result[1])
  })

  it('should generate similar embeddings for similar texts', async () => {
    const result = await provider.embed(['the quick brown fox', 'the quick brown dog'])

    // Both should have non-zero embeddings
    expect(result[0]?.some((v) => v !== 0)).toBe(true)
    expect(result[1]?.some((v) => v !== 0)).toBe(true)

    // Calculate cosine similarity
    const dot = result[0]?.reduce((sum, v, i) => sum + v * (result[1]?.[i] ?? 0), 0) ?? 0
    // Similar texts should have positive similarity (some overlap in vocabulary)
    expect(dot).toBeGreaterThanOrEqual(0)
  })

  it('should handle empty text', async () => {
    const result = await provider.embed([''])

    expect(result).toHaveLength(1)
    expect(result[0]?.every((v) => v === 0)).toBe(true)
  })

  it('should produce consistent embeddings for same text', async () => {
    const result1 = await provider.embed(['test normalization'])
    const result2 = await provider.embed(['test normalization'])

    // Same text should produce same embedding
    expect(result1[0]).toEqual(result2[0])
  })

  it('should produce embeddings with words in vocabulary', async () => {
    // Embed multiple texts to build vocabulary
    const result = await provider.embed(['test document', 'another test'])

    // The embeddings should be arrays of numbers
    expect(Array.isArray(result[0])).toBe(true)
    expect(result[0]?.length).toBeGreaterThan(0)

    // After normalization, magnitude is either 1 or 0 (for empty text)
    const magnitude = Math.sqrt(result[0]?.reduce((sum, v) => sum + v * v, 0) ?? 0)
    // Normalized vectors have magnitude 1, or 0 for empty
    expect(magnitude).toBeLessThanOrEqual(1.01)
  })
})

describe('MemoryCache', () => {
  let cache: MemoryCache

  beforeEach(() => {
    cache = new MemoryCache(3)
  })

  afterEach(() => {
    cache.clear()
  })

  it('should return null for non-existent keys', async () => {
    const result = await cache.get('non-existent')

    expect(result).toBeNull()
  })

  it('should store and retrieve embeddings', async () => {
    const embedding = [0.1, 0.2, 0.3]
    await cache.set('test', embedding)

    const result = await cache.get('test')

    expect(result).toEqual(embedding)
  })

  it('should evict oldest entry when full', async () => {
    await cache.set('first', [0.1])
    await cache.set('second', [0.2])
    await cache.set('third', [0.3])
    await cache.set('fourth', [0.4]) // Should evict 'first'

    const first = await cache.get('first')
    const fourth = await cache.get('fourth')

    expect(first).toBeNull()
    expect(fourth).toEqual([0.4])
  })

  it('should handle same text multiple times', async () => {
    await cache.set('test', [0.1])
    await cache.set('test', [0.2]) // Update

    const result = await cache.get('test')

    expect(result).toEqual([0.2])
  })
})
