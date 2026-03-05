/**
 * Embedding Service for Supermemory Clone
 *
 * Provides vector embedding generation using OpenAI's text-embedding-3-small
 * with fallback to local embeddings.
 */

import type { EmbeddingConfig, EmbeddingProvider } from './search.types.js'
import { ValidationError, EmbeddingError, ExternalServiceError } from '../utils/errors.js'

/**
 * Configuration for embedding models
 */
const EMBEDDING_CONFIGS: Record<EmbeddingProvider, EmbeddingConfig> = {
  openai: {
    model: 'text-embedding-3-small',
    dimensions: 1536,
    isLocal: false,
    maxTokens: 8191,
    batchSize: 100,
  },
  local: {
    model: 'local-tfidf',
    dimensions: 384,
    isLocal: true,
    maxTokens: 512,
    batchSize: 50,
  },
}

/**
 * Simple hash function for consistent local embeddings
 */
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return hash
}

/**
 * Generate a deterministic pseudo-random number from a seed
 */
function seededRandom(seed: number): () => number {
  return function (): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
}

/**
 * Normalize a vector to unit length (L2 normalization)
 */
function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
  if (magnitude === 0) return vector
  return vector.map((val) => val / magnitude)
}

/**
 * Local TF-IDF based embedding generator (fallback)
 * Generates deterministic embeddings based on text content
 */
function generateLocalEmbedding(text: string, dimensions: number = 384): number[] {
  // Tokenize and normalize text
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)

  // Initialize embedding vector
  const embedding = new Array(dimensions).fill(0)

  // Combine token-based features with random projection
  const tokenWeights = new Map<string, number>()

  // Calculate term frequency
  for (const token of tokens) {
    tokenWeights.set(token, (tokenWeights.get(token) || 0) + 1)
  }

  // Apply TF weighting and random projection
  for (const [token, count] of tokenWeights.entries()) {
    const tf = Math.log(1 + count)
    const tokenHash = hashCode(token)
    const tokenRandom = seededRandom(tokenHash)

    // Project each token into the embedding space
    for (let i = 0; i < dimensions; i++) {
      embedding[i] += tf * (tokenRandom() * 2 - 1)
    }
  }

  // Add positional information
  for (let i = 0; i < Math.min(tokens.length, 50); i++) {
    const token = tokens[i]
    if (!token) continue
    const posWeight = 1 / (1 + i * 0.1)
    const tokenHash = hashCode(token + ':' + i)
    const posRandom = seededRandom(tokenHash)

    for (let j = 0; j < dimensions; j++) {
      embedding[j] += posWeight * (posRandom() * 2 - 1) * 0.1
    }
  }

  // Normalize to unit vector
  return normalizeVector(embedding)
}

/**
 * Embedding Service class
 */
export class EmbeddingService {
  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  private readonly config: EmbeddingConfig
  private readonly provider: EmbeddingProvider

  constructor(options?: { apiKey?: string; baseUrl?: string; provider?: EmbeddingProvider }) {
    this.apiKey = options?.apiKey || process.env.OPENAI_API_KEY
    this.baseUrl = options?.baseUrl || 'https://api.openai.com/v1'
    this.provider = options?.provider || (this.apiKey ? 'openai' : 'local')
    this.config = EMBEDDING_CONFIGS[this.provider]

    if (!this.apiKey && this.provider === 'openai') {
      console.warn('[EmbeddingService] No OpenAI API key found, falling back to local embeddings')
      this.provider = 'local'
    }
  }

  /**
   * Get the current embedding configuration
   */
  getConfig(): EmbeddingConfig {
    return { ...this.config }
  }

  /**
   * Get the embedding dimensions
   */
  getDimensions(): number {
    return EMBEDDING_CONFIGS[this.provider].dimensions
  }

  /**
   * Check if using local fallback
   */
  isUsingLocalFallback(): boolean {
    return this.provider === 'local'
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new ValidationError('Text cannot be empty', {
        text: ['Text is required and cannot be empty'],
      })
    }

    // Truncate if too long
    const maxChars = (this.config.maxTokens || 8191) * 4 // Rough estimate
    const truncatedText = text.length > maxChars ? text.slice(0, maxChars) : text

    if (this.provider === 'local') {
      return this.generateLocalEmbedding(truncatedText)
    }

    try {
      return await this.generateOpenAIEmbedding(truncatedText)
    } catch (error) {
      console.warn('[EmbeddingService] OpenAI embedding failed, falling back to local:', error)
      return this.generateLocalEmbedding(truncatedText)
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async batchEmbed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return []
    }

    // Filter empty texts and track indices
    const validTexts: { text: string; originalIndex: number }[] = []
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]
      if (text && text.trim().length > 0) {
        validTexts.push({ text, originalIndex: i })
      }
    }

    if (validTexts.length === 0) {
      return texts.map(() => [])
    }

    // Truncate texts
    const maxChars = (this.config.maxTokens || 8191) * 4
    const truncatedTexts = validTexts.map(({ text }) => (text.length > maxChars ? text.slice(0, maxChars) : text))

    if (this.provider === 'local') {
      const embeddings = truncatedTexts.map((text) => this.generateLocalEmbedding(text))
      return this.reconstructBatch(
        embeddings,
        validTexts.map((v) => v.originalIndex),
        texts.length
      )
    }

    try {
      const batchSize = this.config.batchSize || 100
      const allEmbeddings: number[][] = []

      // Process in batches
      for (let i = 0; i < truncatedTexts.length; i += batchSize) {
        const batch = truncatedTexts.slice(i, i + batchSize)
        const batchEmbeddings = await this.generateOpenAIBatchEmbedding(batch)
        allEmbeddings.push(...batchEmbeddings)
      }

      return this.reconstructBatch(
        allEmbeddings,
        validTexts.map((v) => v.originalIndex),
        texts.length
      )
    } catch (error) {
      console.warn('[EmbeddingService] OpenAI batch embedding failed, falling back to local:', error)
      const embeddings = truncatedTexts.map((text) => this.generateLocalEmbedding(text))
      return this.reconstructBatch(
        embeddings,
        validTexts.map((v) => v.originalIndex),
        texts.length
      )
    }
  }

  /**
   * Reconstruct batch with empty embeddings for filtered entries
   */
  private reconstructBatch(embeddings: number[][], validIndices: number[], totalLength: number): number[][] {
    const result: number[][] = new Array(totalLength).fill(null).map(() => [])
    for (let i = 0; i < validIndices.length; i++) {
      const idx = validIndices[i]
      const emb = embeddings[i]
      if (idx !== undefined && emb !== undefined) {
        result[idx] = emb
      }
    }
    return result
  }

  /**
   * Generate local embedding (wrapper for static function)
   */
  private generateLocalEmbedding(text: string): number[] {
    const dimensions = EMBEDDING_CONFIGS.local.dimensions
    return generateLocalEmbedding(text, dimensions)
  }

  /**
   * Generate embedding using OpenAI API
   */
  private async generateOpenAIEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: text,
        encoding_format: 'float',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new ExternalServiceError('OpenAI', `OpenAI API error: ${error}`, response.status, {
        model: this.config.model,
        endpoint: 'embeddings',
      })
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>
    }

    const firstResult = data.data[0]
    if (!firstResult) {
      throw new EmbeddingError('No embedding returned from OpenAI API', 'openai', {
        model: this.config.model,
      })
    }
    return firstResult.embedding
  }

  /**
   * Generate batch embeddings using OpenAI API
   */
  private async generateOpenAIBatchEmbedding(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
        encoding_format: 'float',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new ExternalServiceError('OpenAI', `OpenAI API batch embedding error: ${error}`, response.status, {
        model: this.config.model,
        batchSize: texts.length,
      })
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>
    }

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index)
    return sorted.map((item) => item.embedding)
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new ValidationError(`Vector dimension mismatch: ${a.length} vs ${b.length}`, {
      vectorA: [`Expected dimension ${b.length}, got ${a.length}`],
    })
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0
    const bVal = b[i] ?? 0
    dotProduct += aVal * bVal
    normA += aVal * aVal
    normB += bVal * bVal
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  if (magnitude === 0) return 0

  return dotProduct / magnitude
}

/**
 * Create a default embedding service instance
 */
export function createEmbeddingService(options?: {
  apiKey?: string
  baseUrl?: string
  provider?: EmbeddingProvider
}): EmbeddingService {
  return new EmbeddingService(options)
}

// Lazy singleton instance
let _embeddingService: EmbeddingService | null = null

/**
 * Get the singleton embedding service instance (created lazily)
 */
export function getEmbeddingService(): EmbeddingService {
  if (!_embeddingService) {
    _embeddingService = new EmbeddingService()
  }
  return _embeddingService
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetEmbeddingService(): void {
  _embeddingService = null
}

// Export default instance (lazy getter for backwards compatibility)
export const embeddingService = new Proxy({} as EmbeddingService, {
  get(_, prop) {
    return getEmbeddingService()[prop as keyof EmbeddingService]
  },
})
