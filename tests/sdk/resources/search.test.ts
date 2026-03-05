/**
 * Search Resource Tests
 *
 * Tests for the Search resource operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Search } from '../../../src/sdk/resources/search.js'
import { HTTPClient } from '../../../src/sdk/http.js'

describe('Search Resource', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let client: HTTPClient
  let search: Search

  beforeEach(() => {
    mockFetch = vi.fn()
    client = new HTTPClient({ apiKey: 'test-key', fetch: mockFetch })
    search = new Search(client)
  })

  describe('documents()', () => {
    it('should search documents via POST to /v3/search', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              { documentId: 'doc-1', score: 0.95, title: 'Result 1' },
              { documentId: 'doc-2', score: 0.85, title: 'Result 2' },
            ],
            timing: 42,
            total: 2,
          })
        )
      )

      const result = await search.documents({ q: 'test query' })

      expect(result.results).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.timing).toBe(42)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/search'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should include all search parameters', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [], timing: 10, total: 0 })))

      await search.documents({
        q: 'test query',
        containerTags: ['project-a', 'project-b'],
        limit: 20,
        chunkThreshold: 0.7,
        includeFullDocs: true,
        includeSummary: true,
        rerank: true,
        rewriteQuery: true,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            q: 'test query',
            containerTags: ['project-a', 'project-b'],
            limit: 20,
            chunkThreshold: 0.7,
            includeFullDocs: true,
            includeSummary: true,
            rerank: true,
            rewriteQuery: true,
          }),
        })
      )
    })

    it('should include filter expression', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [], timing: 10, total: 0 })))

      await search.documents({
        q: 'test',
        filters: {
          and: [
            { key: 'status', value: 'published', filterType: 'exact' },
            { key: 'priority', value: 5, numericOperator: 'gte' },
          ],
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"filters"'),
        })
      )
    })

    it('should filter by document ID', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [], timing: 10, total: 0 })))

      await search.documents({
        q: 'test',
        docId: 'doc-123',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            q: 'test',
            docId: 'doc-123',
          }),
        })
      )
    })
  })

  describe('execute()', () => {
    it('should be an alias for documents()', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ documentId: 'doc-1', score: 0.9 }],
            timing: 15,
            total: 1,
          })
        )
      )

      const result = await search.execute({ q: 'test query' })

      expect(result.results).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/search'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should accept the same parameters as documents()', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [], timing: 10, total: 0 })))

      await search.execute({
        q: 'test',
        limit: 5,
        rerank: true,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            q: 'test',
            limit: 5,
            rerank: true,
          }),
        })
      )
    })
  })

  describe('memories()', () => {
    it('should search memories via POST to /v4/memories/search', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              { id: 'mem-1', similarity: 0.92, memory: 'Result 1' },
              { id: 'mem-2', similarity: 0.88, memory: 'Result 2' },
            ],
            timing: 25,
            total: 2,
          })
        )
      )

      const result = await search.memories({ q: 'test query' })

      expect(result.results).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.timing).toBe(25)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories/search'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should include search parameters', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [], timing: 10, total: 0 })))

      await search.memories({
        q: 'test query',
        containerTags: ['user-123'],
        limit: 15,
        rerank: true,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            q: 'test query',
            containerTags: ['user-123'],
            limit: 15,
            rerank: true,
          }),
        })
      )
    })

    it('should include filter expression', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [], timing: 10, total: 0 })))

      await search.memories({
        q: 'test',
        filters: {
          or: [
            { key: 'type', value: 'preference' },
            { key: 'type', value: 'fact' },
          ],
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"filters"'),
        })
      )
    })
  })

  describe('error handling', () => {
    it('should propagate errors from client', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Search failed' }), { status: 500 }))

      await expect(search.documents({ q: 'test' })).rejects.toThrow()
    })

    it('should handle empty results', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [], timing: 5, total: 0 })))

      const result = await search.documents({ q: 'no matches' })

      expect(result.results).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('request options', () => {
    it('should pass request options to client', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ results: [], timing: 10, total: 0 })))

      await search.documents({ q: 'test' }, { timeout: 5000, headers: { 'X-Custom': 'value' } })

      const headers = mockFetch.mock.calls[0][1].headers
      expect(headers.get('X-Custom')).toBe('value')
    })
  })
})
