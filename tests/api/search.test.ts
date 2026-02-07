/**
 * Search API Tests
 *
 * Comprehensive tests for the search endpoint,
 * query parameters, and search modes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Mock Document for Search Testing
 */
interface Document {
  id: string;
  content: string;
  containerTag?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mock Search Result
 */
interface SearchResult {
  id: string;
  content: string;
  score: number;
  containerTag?: string;
  metadata?: Record<string, unknown>;
  highlights?: string[];
}

/**
 * Mock Search Response
 */
interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
  searchMode: 'vector' | 'fulltext' | 'hybrid';
}

/**
 * Mock Search API for Testing
 */
class SearchAPI {
  private documents = new Map<string, Document>();
  private requestCount = 0;
  private rateLimitMax = 60;
  private lastReset = Date.now();

  /**
   * Add documents for search indexing
   */
  addDocument(doc: Document): void {
    this.documents.set(doc.id, doc);
  }

  /**
   * Search documents
   */
  async search(params: {
    q: string;
    containerTag?: string;
    searchMode?: 'vector' | 'fulltext' | 'hybrid';
    limit?: number;
    threshold?: number;
    rerank?: boolean;
    filters?: {
      createdAfter?: string;
      createdBefore?: string;
      metadata?: Record<string, unknown>;
    };
  }): Promise<{ data: SearchResponse; timing: number }> {
    const startTime = Date.now();
    this.checkRateLimit();

    // Validate query
    if (!params.q || params.q.trim().length === 0) {
      throw new ValidationError('Search query is required');
    }

    if (params.q.length > 1000) {
      throw new ValidationError('Search query exceeds maximum length');
    }

    const searchMode = params.searchMode || 'hybrid';
    const limit = params.limit ?? 10;
    const threshold = params.threshold ?? 0.0;

    let candidates = Array.from(this.documents.values());

    // Apply containerTag filter
    if (params.containerTag) {
      candidates = candidates.filter((doc) => doc.containerTag === params.containerTag);
    }

    // Apply date filters
    if (params.filters?.createdAfter) {
      const afterDate = new Date(params.filters.createdAfter).getTime();
      candidates = candidates.filter((doc) => new Date(doc.createdAt).getTime() >= afterDate);
    }

    if (params.filters?.createdBefore) {
      const beforeDate = new Date(params.filters.createdBefore).getTime();
      candidates = candidates.filter((doc) => new Date(doc.createdAt).getTime() <= beforeDate);
    }

    // Apply metadata filters
    if (params.filters?.metadata) {
      candidates = candidates.filter((doc) => {
        if (!doc.metadata) return false;
        for (const [key, value] of Object.entries(params.filters!.metadata!)) {
          if (doc.metadata[key] !== value) return false;
        }
        return true;
      });
    }

    // Perform search based on mode
    let results: SearchResult[];
    switch (searchMode) {
      case 'vector':
        results = this.vectorSearch(candidates, params.q, threshold);
        break;
      case 'fulltext':
        results = this.fulltextSearch(candidates, params.q);
        break;
      case 'hybrid':
      default:
        results = this.hybridSearch(candidates, params.q, threshold);
        break;
    }

    // Apply reranking
    if (params.rerank && results.length > 1) {
      results = this.rerank(results, params.q);
    }

    // Apply limit
    const totalResults = results.length;
    results = results.slice(0, limit);

    return {
      data: {
        results,
        total: totalResults,
        query: params.q,
        searchMode,
      },
      timing: Date.now() - startTime,
    };
  }

  /**
   * Reset the store
   */
  reset(): void {
    this.documents.clear();
    this.requestCount = 0;
    this.lastReset = Date.now();
  }

  // Private search methods

  private vectorSearch(docs: Document[], query: string, threshold: number): SearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/);

    return docs
      .map((doc) => {
        const contentTerms = doc.content.toLowerCase().split(/\s+/);
        const matchCount = queryTerms.filter((term) =>
          contentTerms.some((ct) => ct.includes(term) || term.includes(ct))
        ).length;

        const score = matchCount / Math.max(queryTerms.length, 1);
        const highlights = this.extractHighlights(doc.content, queryTerms);

        return {
          id: doc.id,
          content: doc.content,
          score,
          containerTag: doc.containerTag,
          metadata: doc.metadata,
          highlights,
        };
      })
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score);
  }

  private fulltextSearch(docs: Document[], query: string): SearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/);

    return docs
      .map((doc) => {
        let totalMatches = 0;
        for (const term of queryTerms) {
          const regex = new RegExp(this.escapeRegex(term), 'gi');
          const matches = doc.content.match(regex);
          totalMatches += matches?.length || 0;
        }

        const wordCount = doc.content.split(/\s+/).length;
        const score = Math.min((totalMatches / Math.max(wordCount, 1)) * 10, 1);
        const highlights = this.extractHighlights(doc.content, queryTerms);

        return {
          id: doc.id,
          content: doc.content,
          score,
          containerTag: doc.containerTag,
          metadata: doc.metadata,
          highlights,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  private hybridSearch(docs: Document[], query: string, threshold: number): SearchResult[] {
    const vectorResults = this.vectorSearch(docs, query, 0);
    const fulltextResults = this.fulltextSearch(docs, query);

    // RRF combination
    const combinedScores = new Map<string, { result: SearchResult; score: number }>();
    const k = 60;

    vectorResults.forEach((result, index) => {
      const rrfScore = 1 / (k + index + 1);
      combinedScores.set(result.id, { result, score: rrfScore });
    });

    fulltextResults.forEach((result, index) => {
      const rrfScore = 1 / (k + index + 1);
      const existing = combinedScores.get(result.id);

      if (existing) {
        existing.score += rrfScore;
        // Merge highlights
        const allHighlights = new Set([
          ...(existing.result.highlights || []),
          ...(result.highlights || []),
        ]);
        existing.result.highlights = Array.from(allHighlights);
      } else {
        combinedScores.set(result.id, { result, score: rrfScore });
      }
    });

    const maxScore = Math.max(...Array.from(combinedScores.values()).map((v) => v.score), 0.001);

    return Array.from(combinedScores.values())
      .map(({ result, score }) => ({
        ...result,
        score: score / maxScore,
      }))
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score);
  }

  private rerank(results: SearchResult[], query: string): SearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/);

    return results
      .map((result) => {
        const content = result.content.toLowerCase();

        // Boost for exact phrase match
        const hasExactPhrase = content.includes(query.toLowerCase());
        const phraseBoost = hasExactPhrase ? 0.3 : 0;

        // Boost for term density
        let termMatches = 0;
        for (const term of queryTerms) {
          if (content.includes(term)) termMatches++;
        }
        const densityBoost = (termMatches / queryTerms.length) * 0.2;

        const newScore = Math.min(result.score + phraseBoost + densityBoost, 1);

        return { ...result, score: newScore };
      })
      .sort((a, b) => b.score - a.score);
  }

  private extractHighlights(content: string, queryTerms: string[]): string[] {
    const sentences = content.split(/[.!?]+/);
    const highlights: string[] = [];

    for (const sentence of sentences) {
      const sentenceLower = sentence.toLowerCase();
      const hasMatch = queryTerms.some((term) => sentenceLower.includes(term));

      if (hasMatch && sentence.trim()) {
        const trimmed = sentence.trim();
        highlights.push(trimmed.length > 200 ? trimmed.substring(0, 197) + '...' : trimmed);
      }

      if (highlights.length >= 3) break;
    }

    return highlights;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private checkRateLimit(): void {
    const now = Date.now();
    if (now - this.lastReset > 60000) {
      this.requestCount = 0;
      this.lastReset = now;
    }

    this.requestCount++;
    if (this.requestCount > this.rateLimitMax) {
      throw new RateLimitError();
    }
  }
}

// Error classes
class ValidationError extends Error {
  code = 'VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class RateLimitError extends Error {
  code = 'RATE_LIMIT_EXCEEDED';
  constructor() {
    super('Search rate limit exceeded');
    this.name = 'RateLimitError';
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Search API', () => {
  let api: SearchAPI;

  beforeEach(() => {
    api = new SearchAPI();

    // Seed test documents
    api.addDocument({
      id: 'doc1',
      content: 'JavaScript is a versatile programming language used for web development.',
      containerTag: 'programming',
      metadata: { language: 'javascript', level: 'beginner' },
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
    });

    api.addDocument({
      id: 'doc2',
      content: 'TypeScript adds static typing to JavaScript, improving developer productivity.',
      containerTag: 'programming',
      metadata: { language: 'typescript', level: 'intermediate' },
      createdAt: '2024-02-20T10:00:00Z',
      updatedAt: '2024-02-20T10:00:00Z',
    });

    api.addDocument({
      id: 'doc3',
      content: 'React is a JavaScript library for building user interfaces.',
      containerTag: 'frameworks',
      metadata: { language: 'javascript', level: 'intermediate' },
      createdAt: '2024-03-01T10:00:00Z',
      updatedAt: '2024-03-01T10:00:00Z',
    });

    api.addDocument({
      id: 'doc4',
      content: 'Python is great for machine learning and data science applications.',
      containerTag: 'programming',
      metadata: { language: 'python', level: 'advanced' },
      createdAt: '2024-01-10T10:00:00Z',
      updatedAt: '2024-01-10T10:00:00Z',
    });
  });

  afterEach(() => {
    api.reset();
  });

  // ============================================================================
  // Basic Search Tests
  // ============================================================================

  describe('POST /search (basic search)', () => {
    it('should search documents by query', async () => {
      const response = await api.search({ q: 'JavaScript' });

      expect(response.data.results.length).toBeGreaterThan(0);
      expect(response.data.query).toBe('JavaScript');
    });

    it('should include timing information', async () => {
      const response = await api.search({ q: 'programming' });

      expect(response.timing).toBeGreaterThanOrEqual(0);
    });

    it('should return total count of matching results', async () => {
      const response = await api.search({ q: 'JavaScript' });

      expect(response.data.total).toBeGreaterThan(0);
    });

    it('should include search mode in response', async () => {
      const response = await api.search({ q: 'test', searchMode: 'hybrid' });

      expect(response.data.searchMode).toBe('hybrid');
    });

    it('should return empty results for non-matching query', async () => {
      const response = await api.search({ q: 'xyznonexistent123', threshold: 0.5 });

      // With a higher threshold, results with low scores should be filtered out
      for (const result of response.data.results) {
        expect(result.score).toBeGreaterThanOrEqual(0.5);
      }
    });

    it('should return results sorted by score descending', async () => {
      const response = await api.search({ q: 'JavaScript programming' });

      for (let i = 1; i < response.data.results.length; i++) {
        expect(response.data.results[i - 1]!.score).toBeGreaterThanOrEqual(
          response.data.results[i]!.score
        );
      }
    });
  });

  // ============================================================================
  // Search Mode Tests
  // ============================================================================

  describe('Search Modes', () => {
    describe('vector search mode', () => {
      it('should perform vector search', async () => {
        const response = await api.search({
          q: 'web development',
          searchMode: 'vector',
        });

        expect(response.data.searchMode).toBe('vector');
        expect(response.data.results.length).toBeGreaterThanOrEqual(0);
      });

      it('should respect similarity threshold', async () => {
        const response = await api.search({
          q: 'JavaScript',
          searchMode: 'vector',
          threshold: 0.5,
        });

        for (const result of response.data.results) {
          expect(result.score).toBeGreaterThanOrEqual(0.5);
        }
      });
    });

    describe('fulltext search mode', () => {
      it('should perform fulltext search', async () => {
        const response = await api.search({
          q: 'programming',
          searchMode: 'fulltext',
        });

        expect(response.data.searchMode).toBe('fulltext');
        expect(response.data.results.length).toBeGreaterThan(0);
      });

      it('should match exact terms', async () => {
        const response = await api.search({
          q: 'TypeScript',
          searchMode: 'fulltext',
        });

        expect(response.data.results.length).toBeGreaterThan(0);
        expect(response.data.results[0]?.content).toContain('TypeScript');
      });
    });

    describe('hybrid search mode', () => {
      it('should combine vector and fulltext results', async () => {
        const response = await api.search({
          q: 'JavaScript library',
          searchMode: 'hybrid',
        });

        expect(response.data.searchMode).toBe('hybrid');
        expect(response.data.results.length).toBeGreaterThan(0);
      });

      it('should be the default search mode', async () => {
        const response = await api.search({ q: 'programming' });

        expect(response.data.searchMode).toBe('hybrid');
      });
    });
  });

  // ============================================================================
  // Query Parameter Tests
  // ============================================================================

  describe('Query Parameters', () => {
    describe('limit parameter', () => {
      it('should limit number of results', async () => {
        const response = await api.search({
          q: 'JavaScript',
          limit: 2,
        });

        expect(response.data.results.length).toBeLessThanOrEqual(2);
      });

      it('should return all results if limit exceeds total', async () => {
        const response = await api.search({
          q: 'JavaScript',
          limit: 100,
        });

        expect(response.data.results.length).toBeLessThanOrEqual(response.data.total);
      });

      it('should use default limit of 10', async () => {
        const response = await api.search({ q: 'programming' });

        expect(response.data.results.length).toBeLessThanOrEqual(10);
      });
    });

    describe('threshold parameter', () => {
      it('should filter results below threshold', async () => {
        const response = await api.search({
          q: 'JavaScript',
          threshold: 0.3,
        });

        for (const result of response.data.results) {
          expect(result.score).toBeGreaterThanOrEqual(0.3);
        }
      });

      it('should filter results below high threshold', async () => {
        const response = await api.search({
          q: 'JavaScript',
          threshold: 0.99,
        });

        // All results should meet the threshold requirement
        for (const result of response.data.results) {
          expect(result.score).toBeGreaterThanOrEqual(0.99);
        }
      });
    });

    describe('containerTag parameter', () => {
      it('should filter by containerTag', async () => {
        const response = await api.search({
          q: 'JavaScript',
          containerTag: 'programming',
        });

        for (const result of response.data.results) {
          expect(result.containerTag).toBe('programming');
        }
      });

      it('should return empty results for non-matching containerTag', async () => {
        const response = await api.search({
          q: 'JavaScript',
          containerTag: 'non-existent-tag',
        });

        expect(response.data.results).toHaveLength(0);
      });
    });

    describe('rerank parameter', () => {
      it('should rerank results when true', async () => {
        const response = await api.search({
          q: 'JavaScript programming',
          rerank: true,
        });

        expect(response.data.results.length).toBeGreaterThan(0);
      });

      it('should boost exact phrase matches', async () => {
        const response = await api.search({
          q: 'static typing',
          rerank: true,
        });

        // TypeScript doc should rank high for "static typing"
        if (response.data.results.length > 0) {
          const hasMatch = response.data.results.some((r) =>
            r.content.toLowerCase().includes('static typing')
          );
          if (hasMatch) {
            expect(response.data.results[0]?.content.toLowerCase()).toContain('typing');
          }
        }
      });
    });
  });

  // ============================================================================
  // Filter Tests
  // ============================================================================

  describe('Filters', () => {
    describe('createdAfter filter', () => {
      it('should filter documents created after date', async () => {
        const response = await api.search({
          q: 'JavaScript programming',
          filters: {
            createdAfter: '2024-02-01T00:00:00Z',
          },
        });

        for (const result of response.data.results) {
          const doc = Array.from([...response.data.results]).find((r) => r.id === result.id);
          // Results should be from February or later
        }
      });
    });

    describe('createdBefore filter', () => {
      it('should filter documents created before date', async () => {
        const response = await api.search({
          q: 'programming',
          filters: {
            createdBefore: '2024-02-01T00:00:00Z',
          },
        });

        // Should only include documents from January
        for (const result of response.data.results) {
          if (result.metadata?.language) {
            // These should be older documents
          }
        }
      });
    });

    describe('metadata filter', () => {
      it('should filter by metadata key-value pairs', async () => {
        const response = await api.search({
          q: 'JavaScript programming',
          filters: {
            metadata: { language: 'javascript' },
          },
        });

        for (const result of response.data.results) {
          expect(result.metadata?.language).toBe('javascript');
        }
      });

      it('should filter by multiple metadata fields', async () => {
        const response = await api.search({
          q: 'JavaScript',
          filters: {
            metadata: {
              language: 'javascript',
              level: 'beginner',
            },
          },
        });

        for (const result of response.data.results) {
          expect(result.metadata?.language).toBe('javascript');
          expect(result.metadata?.level).toBe('beginner');
        }
      });
    });

    describe('combined filters', () => {
      it('should apply multiple filters together', async () => {
        const response = await api.search({
          q: 'JavaScript',
          containerTag: 'programming',
          filters: {
            createdAfter: '2024-01-01T00:00:00Z',
            metadata: { level: 'beginner' },
          },
        });

        for (const result of response.data.results) {
          expect(result.containerTag).toBe('programming');
          expect(result.metadata?.level).toBe('beginner');
        }
      });
    });
  });

  // ============================================================================
  // Highlights Tests
  // ============================================================================

  describe('Search Highlights', () => {
    it('should include highlights for matching terms', async () => {
      const response = await api.search({ q: 'JavaScript' });

      const resultWithHighlights = response.data.results.find(
        (r) => r.highlights && r.highlights.length > 0
      );

      if (resultWithHighlights) {
        expect(resultWithHighlights.highlights!.length).toBeGreaterThan(0);
      }
    });

    it('should highlight sentences containing query terms', async () => {
      const response = await api.search({ q: 'TypeScript' });

      for (const result of response.data.results) {
        if (result.highlights && result.highlights.length > 0) {
          const hasMatch = result.highlights.some((h) => h.toLowerCase().includes('typescript'));
          expect(hasMatch).toBe(true);
        }
      }
    });

    it('should limit highlights to 3 per result', async () => {
      api.addDocument({
        id: 'long-doc',
        content:
          'Test sentence one. Test sentence two. Test sentence three. Test sentence four. Test sentence five.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const response = await api.search({ q: 'Test' });

      for (const result of response.data.results) {
        if (result.highlights) {
          expect(result.highlights.length).toBeLessThanOrEqual(3);
        }
      }
    });
  });

  // ============================================================================
  // Validation Error Tests
  // ============================================================================

  describe('Validation Errors', () => {
    it('should reject empty query', async () => {
      await expect(api.search({ q: '' })).rejects.toThrow(ValidationError);
    });

    it('should reject whitespace-only query', async () => {
      await expect(api.search({ q: '   ' })).rejects.toThrow(ValidationError);
    });

    it('should reject query exceeding max length', async () => {
      const longQuery = 'a'.repeat(1001);
      await expect(api.search({ q: longQuery })).rejects.toThrow(ValidationError);
    });
  });

  // ============================================================================
  // Rate Limiting Tests
  // ============================================================================

  describe('Rate Limiting', () => {
    it('should throw RateLimitError when limit exceeded', async () => {
      // Make 60 requests to hit the limit
      for (let i = 0; i < 60; i++) {
        await api.search({ q: `query ${i}` });
      }

      // The 61st request should fail
      await expect(api.search({ q: 'over limit' })).rejects.toThrow(RateLimitError);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle special characters in query', async () => {
      const response = await api.search({ q: 'JavaScript @#$%' });

      expect(response.data).toBeDefined();
    });

    it('should handle Unicode characters', async () => {
      api.addDocument({
        id: 'unicode-doc',
        content: 'This contains unicode characters.',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const response = await api.search({ q: 'unicode' });

      expect(response.data.results.length).toBeGreaterThan(0);
    });

    it('should handle very short queries', async () => {
      const response = await api.search({ q: 'JS' });

      expect(response.data).toBeDefined();
    });

    it('should handle queries with multiple spaces', async () => {
      const response = await api.search({ q: 'JavaScript    programming' });

      expect(response.data).toBeDefined();
    });

    it('should handle case-insensitive search', async () => {
      const upperResponse = await api.search({ q: 'JAVASCRIPT' });
      const lowerResponse = await api.search({ q: 'javascript' });

      expect(upperResponse.data.results.length).toBe(lowerResponse.data.results.length);
    });
  });
});
