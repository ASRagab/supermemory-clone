/**
 * Memories Resource Tests
 *
 * Tests for the Memories resource operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Memories } from '../../../src/sdk/resources/memories.js';
import { HTTPClient } from '../../../src/sdk/http.js';

describe('Memories Resource', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: HTTPClient;
  let memories: Memories;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new HTTPClient({ apiKey: 'test-key', fetch: mockFetch });
    memories = new Memories(client);
  });

  describe('get()', () => {
    it('should fetch memory by ID', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'mem-123',
            content: 'Test memory',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          })
        )
      );

      const result = await memories.get('mem-123');

      expect(result.id).toBe('mem-123');
      expect(result.content).toBe('Test memory');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories/mem-123'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should URL-encode memory ID', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'mem/special' })));

      await memories.get('mem/special');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories/mem%2Fspecial'),
        expect.any(Object)
      );
    });
  });

  describe('list()', () => {
    it('should list memories with POST to /v4/memories/list', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            memories: [{ id: 'mem-1' }, { id: 'mem-2' }],
            pagination: { currentPage: 1, limit: 20, totalItems: 2, totalPages: 1 },
          })
        )
      );

      const result = await memories.list();

      expect(result.memories).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories/list'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include filter parameters', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ memories: [], pagination: {} }))
      );

      await memories.list({
        containerTags: ['user-123'],
        limit: 50,
        page: 2,
        includeContent: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            containerTags: ['user-123'],
            limit: 50,
            page: 2,
            includeContent: true,
          }),
        })
      );
    });

    it('should handle null body', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ memories: [], pagination: {} }))
      );

      await memories.list(null);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({}) })
      );
    });
  });

  describe('add()', () => {
    it('should add memory via POST to /v4/memories', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'mem-new', status: 'created' }))
      );

      const result = await memories.add({ content: 'New memory' });

      expect(result.id).toBe('mem-new');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include all memory fields', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'mem-new', status: 'created' }))
      );

      await memories.add({
        content: 'Memory content',
        containerTag: 'user-123',
        customId: 'custom-mem',
        metadata: { type: 'preference' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            content: 'Memory content',
            containerTag: 'user-123',
            customId: 'custom-mem',
            metadata: { type: 'preference' },
          }),
        })
      );
    });
  });

  describe('update()', () => {
    it('should update memory via PATCH', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'mem-123', status: 'updated' }))
      );

      const result = await memories.update('mem-123', { content: 'Updated memory' });

      expect(result.id).toBe('mem-123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories/mem-123'),
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('should handle null body', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'mem-123', status: 'updated' }))
      );

      await memories.update('mem-123', null);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({}) })
      );
    });
  });

  describe('delete()', () => {
    it('should delete memory by ID', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await memories.delete('mem-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories/mem-123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should URL-encode memory ID', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await memories.delete('mem/special');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories/mem%2Fspecial'),
        expect.any(Object)
      );
    });
  });

  describe('forget()', () => {
    it('should soft delete memory', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'mem-123', forgotten: true }))
      );

      const result = await memories.forget({ id: 'mem-123' });

      expect(result.forgotten).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories/forget'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include reason in request', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'mem-123', forgotten: true }))
      );

      await memories.forget({ id: 'mem-123', reason: 'User requested deletion' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            id: 'mem-123',
            reason: 'User requested deletion',
          }),
        })
      );
    });
  });

  describe('updateMemory()', () => {
    it('should create new memory version', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'mem-new-version',
            memory: 'Updated memory content',
            version: 2,
            parentMemoryId: 'mem-123',
            rootMemoryId: 'mem-123',
            createdAt: '2024-01-01T00:00:00Z',
          })
        )
      );

      const result = await memories.updateMemory({
        id: 'mem-123',
        memory: 'Updated memory content',
      });

      expect(result.version).toBe(2);
      expect(result.parentMemoryId).toBe('mem-123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories/update'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include metadata in update', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'mem-new-version',
            memory: 'Updated',
            version: 2,
            parentMemoryId: null,
            rootMemoryId: null,
            createdAt: '2024-01-01T00:00:00Z',
          })
        )
      );

      await memories.updateMemory({
        id: 'mem-123',
        memory: 'Updated',
        metadata: { updatedBy: 'user' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            id: 'mem-123',
            memory: 'Updated',
            metadata: { updatedBy: 'user' },
          }),
        })
      );
    });
  });

  describe('uploadFile()', () => {
    it('should upload file as memory', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'mem-upload', status: 'processing' }))
      );

      const file = new Blob(['test content'], { type: 'text/plain' });
      const result = await memories.uploadFile({ file });

      expect(result.id).toBe('mem-upload');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v4/memories/upload'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include containerTag in form data', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'mem-upload', status: 'processing' }))
      );

      const file = new Blob(['test']);
      await memories.uploadFile({ file, containerTag: 'user-123' });

      const body = mockFetch.mock.calls[0][1].body;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('containerTag')).toBe('user-123');
    });

    it('should include metadata as JSON string', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'mem-upload', status: 'processing' }))
      );

      const file = new Blob(['test']);
      await memories.uploadFile({
        file,
        metadata: { source: 'upload', type: 'note' },
      });

      const body = mockFetch.mock.calls[0][1].body;
      expect(body.get('metadata')).toBe(JSON.stringify({ source: 'upload', type: 'note' }));
    });
  });
});
