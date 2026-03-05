/**
 * Mock Embedding Service for Testing
 *
 * Provides deterministic embeddings for testing purposes
 */

import type { EmbeddingService } from '../../src/services/embedding.service.js'

/**
 * Simple hash function for consistent embeddings
 */
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return hash
}

/**
 * Generate seeded random number
 */
function seededRandom(seed: number): () => number {
  return function (): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
}

/**
 * Mock embedding service that generates deterministic embeddings
 */
export class MockEmbeddingService implements EmbeddingService {
  private dimensions: number

  constructor(dimensions: number = 1536) {
    this.dimensions = dimensions
  }

  /**
   * Generate a deterministic embedding for text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const seed = hashCode(text)
    const random = seededRandom(seed)
    const embedding = new Array(this.dimensions).fill(0).map(() => random() * 2 - 1)

    // Normalize to unit length
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
    return embedding.map((val) => val / (magnitude || 1))
  }

  /**
   * Generate embeddings for multiple texts
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.generateEmbedding(text)))
  }
}
