/**
 * Supermemory Client Tests
 *
 * Tests for the main SDK client class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Supermemory } from '../../src/sdk/client.js'
import { Search, Documents, Memories, Connections, Settings } from '../../src/sdk/resources/index.js'

describe('Supermemory Client', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
  })

  describe('constructor', () => {
    it('should create client with API key', () => {
      const client = new Supermemory({ apiKey: 'test-key', fetch: mockFetch })

      expect(client).toBeDefined()
    })

    it('should throw error without API key', () => {
      expect(() => new Supermemory({ apiKey: '' })).toThrow('API key is required')
    })

    it('should initialize all resources', () => {
      const client = new Supermemory({ apiKey: 'test-key', fetch: mockFetch })

      expect(client.search).toBeInstanceOf(Search)
      expect(client.documents).toBeInstanceOf(Documents)
      expect(client.memories).toBeInstanceOf(Memories)
      expect(client.connections).toBeInstanceOf(Connections)
      expect(client.settings).toBeInstanceOf(Settings)
    })
  })

  describe('add()', () => {
    it('should make POST request to /v3/add', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'doc-123', status: 'processing' })))

      const client = new Supermemory({ apiKey: 'test-key', fetch: mockFetch })
      const result = await client.add({ content: 'Test content' })

      expect(result).toEqual({ id: 'doc-123', status: 'processing' })
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/add'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Test content' }),
        })
      )
    })

    it('should include containerTag in request', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'doc-123', status: 'processing' })))

      const client = new Supermemory({ apiKey: 'test-key', fetch: mockFetch })
      await client.add({ content: 'Test', containerTag: 'my-project' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ content: 'Test', containerTag: 'my-project' }),
        })
      )
    })

    it('should include metadata in request', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'doc-123', status: 'processing' })))

      const client = new Supermemory({ apiKey: 'test-key', fetch: mockFetch })
      await client.add({
        content: 'Test',
        metadata: { source: 'test', priority: 1 },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            content: 'Test',
            metadata: { source: 'test', priority: 1 },
          }),
        })
      )
    })
  })

  describe('profile()', () => {
    it('should make POST request to /v3/profile', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            profile: {
              dynamic: [],
              static: [],
            },
          })
        )
      )

      const client = new Supermemory({ apiKey: 'test-key', fetch: mockFetch })
      const result = await client.profile({ containerTag: 'user-123' })

      expect(result.profile).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/profile'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should include search query parameter', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            profile: { dynamic: [], static: [] },
            searchResults: { results: [], total: 0, timing: 10 },
          })
        )
      )

      const client = new Supermemory({ apiKey: 'test-key', fetch: mockFetch })
      await client.profile({ containerTag: 'user-123', q: 'preferences' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ containerTag: 'user-123', q: 'preferences' }),
        })
      )
    })
  })

  describe('raw HTTP methods', () => {
    let client: Supermemory

    beforeEach(() => {
      client = new Supermemory({ apiKey: 'test-key', fetch: mockFetch })
    })

    describe('get()', () => {
      it('should make GET request to custom path', async () => {
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: 'test' })))

        const result = await client.get<{ data: string }>('/custom/path')

        expect(result).toEqual({ data: 'test' })
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/custom/path'),
          expect.objectContaining({ method: 'GET' })
        )
      })

      it('should include query parameters', async () => {
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({})))

        await client.get('/test', { query: { limit: 10 } })

        expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('limit=10'), expect.any(Object))
      })
    })

    describe('post()', () => {
      it('should make POST request with body', async () => {
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ created: true })))

        const result = await client.post<{ created: boolean }>('/custom', {
          body: { data: 'test' },
        })

        expect(result).toEqual({ created: true })
        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ data: 'test' }),
          })
        )
      })
    })

    describe('put()', () => {
      it('should make PUT request', async () => {
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ updated: true })))

        const result = await client.put<{ updated: boolean }>('/resource/123', {
          body: { data: 'updated' },
        })

        expect(result).toEqual({ updated: true })
        expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'PUT' }))
      })
    })

    describe('patch()', () => {
      it('should make PATCH request', async () => {
        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ patched: true })))

        const result = await client.patch<{ patched: boolean }>('/resource/123', {
          body: { field: 'value' },
        })

        expect(result).toEqual({ patched: true })
        expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'PATCH' }))
      })
    })

    describe('delete()', () => {
      it('should make DELETE request', async () => {
        mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

        const result = await client.delete('/resource/123')

        expect(result).toBeUndefined()
        expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'DELETE' }))
      })
    })
  })

  describe('withOptions()', () => {
    it('should create new client with merged options', () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({})))

      const original = new Supermemory({
        apiKey: 'original-key',
        timeout: 30000,
        fetch: mockFetch,
      })

      const modified = original.withOptions({ timeout: 60000 })

      expect(modified).not.toBe(original)
      expect(modified).toBeInstanceOf(Supermemory)
    })

    it('should preserve original options not overridden', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({})))

      const original = new Supermemory({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com',
        fetch: mockFetch,
      })

      const modified = original.withOptions({ timeout: 60000 })

      await modified.get('/test')

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('https://custom.api.com'), expect.any(Object))
    })

    it('should override specified options', async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({})))

      const original = new Supermemory({
        apiKey: 'original-key',
        baseURL: 'https://original.api.com',
        fetch: mockFetch,
      })

      const modified = original.withOptions({ baseURL: 'https://new.api.com' })

      await modified.get('/test')

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('https://new.api.com'), expect.any(Object))
    })
  })

  describe('request options', () => {
    it('should pass request options to HTTP client', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'doc-123', status: 'processing' })))

      const client = new Supermemory({ apiKey: 'test-key', fetch: mockFetch })

      await client.add({ content: 'Test' }, { timeout: 5000, headers: { 'X-Custom': 'value' } })

      const headers = mockFetch.mock.calls[0][1].headers
      expect(headers.get('X-Custom')).toBe('value')
    })
  })

  describe('configuration', () => {
    it('should use default base URL', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({})))

      const client = new Supermemory({ apiKey: 'test-key', fetch: mockFetch })
      await client.get('/test')

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('https://api.supermemory.ai'), expect.any(Object))
    })

    it('should use custom base URL', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({})))

      const client = new Supermemory({
        apiKey: 'test-key',
        baseURL: 'https://custom.supermemory.ai',
        fetch: mockFetch,
      })
      await client.get('/test')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://custom.supermemory.ai'),
        expect.any(Object)
      )
    })

    it('should include default headers', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({})))

      const client = new Supermemory({
        apiKey: 'test-key',
        defaultHeaders: { 'X-Organization': 'org-123' },
        fetch: mockFetch,
      })
      await client.get('/test')

      const headers = mockFetch.mock.calls[0][1].headers
      expect(headers.get('X-Organization')).toBe('org-123')
    })

    it('should include default query parameters', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({})))

      const client = new Supermemory({
        apiKey: 'test-key',
        defaultQuery: { version: 'v3' },
        fetch: mockFetch,
      })
      await client.get('/test')

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('version=v3'), expect.any(Object))
    })
  })
})
