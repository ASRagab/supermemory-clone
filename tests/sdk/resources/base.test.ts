/**
 * Base Resource Tests
 *
 * Tests for the APIResource base class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APIResource } from '../../../src/sdk/resources/base.js';
import { HTTPClient } from '../../../src/sdk/http.js';

// Create a concrete implementation for testing
class TestResource extends APIResource {
  async testGet<T>(path: string, options?: Parameters<APIResource['_get']>[1]) {
    return this._get<T>(path, options);
  }

  async testPost<T>(path: string, options?: Parameters<APIResource['_post']>[1]) {
    return this._post<T>(path, options);
  }

  async testPut<T>(path: string, options?: Parameters<APIResource['_put']>[1]) {
    return this._put<T>(path, options);
  }

  async testPatch<T>(path: string, options?: Parameters<APIResource['_patch']>[1]) {
    return this._patch<T>(path, options);
  }

  async testDelete<T>(path: string, options?: Parameters<APIResource['_delete']>[1]) {
    return this._delete<T>(path, options);
  }
}

describe('APIResource', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: HTTPClient;
  let resource: TestResource;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new HTTPClient({ apiKey: 'test-key', fetch: mockFetch });
    resource = new TestResource(client);
  });

  describe('_get()', () => {
    it('should delegate to client.get()', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: 'test' })));

      const result = await resource.testGet<{ data: string }>('/test');

      expect(result).toEqual({ data: 'test' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should pass query parameters', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({})));

      await resource.testGet('/test', { query: { limit: 10 } });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      );
    });

    it('should pass request options', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({})));

      await resource.testGet('/test', {
        requestOptions: { headers: { 'X-Custom': 'value' } },
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.get('X-Custom')).toBe('value');
    });
  });

  describe('_post()', () => {
    it('should delegate to client.post()', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: '123' })));

      const result = await resource.testPost<{ id: string }>('/test', {
        body: { content: 'test' },
      });

      expect(result).toEqual({ id: '123' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should serialize body as JSON', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({})));

      await resource.testPost('/test', { body: { key: 'value' } });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ key: 'value' }),
        })
      );
    });
  });

  describe('_put()', () => {
    it('should delegate to client.put()', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ updated: true })));

      const result = await resource.testPut<{ updated: boolean }>('/test/123', {
        body: { content: 'updated' },
      });

      expect(result).toEqual({ updated: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  describe('_patch()', () => {
    it('should delegate to client.patch()', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ patched: true })));

      const result = await resource.testPatch<{ patched: boolean }>('/test/123', {
        body: { field: 'value' },
      });

      expect(result).toEqual({ patched: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });

  describe('_delete()', () => {
    it('should delegate to client.delete()', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const result = await resource.testDelete('/test/123');

      expect(result).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should support delete with body', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ deleted: 5 })));

      const result = await resource.testDelete<{ deleted: number }>('/test', {
        body: { ids: ['1', '2', '3'] },
      });

      expect(result).toEqual({ deleted: 5 });
    });
  });

  describe('error handling', () => {
    it('should propagate errors from client', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
      );

      await expect(resource.testGet('/test')).rejects.toThrow();
    });
  });
});
