/**
 * Documents Resource Tests
 *
 * Tests for the Documents resource CRUD operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Documents } from '../../../src/sdk/resources/documents.js';
import { HTTPClient } from '../../../src/sdk/http.js';

describe('Documents Resource', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: HTTPClient;
  let documents: Documents;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new HTTPClient({ apiKey: 'test-key', fetch: mockFetch });
    documents = new Documents(client);
  });

  describe('get()', () => {
    it('should fetch document by ID', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'doc-123',
            content: 'Test content',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            status: 'ready',
          })
        )
      );

      const result = await documents.get('doc-123');

      expect(result.id).toBe('doc-123');
      expect(result.content).toBe('Test content');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/documents/doc-123'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should URL-encode document ID', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'doc/special' })));

      await documents.get('doc/special');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/documents/doc%2Fspecial'),
        expect.any(Object)
      );
    });
  });

  describe('list()', () => {
    it('should list documents with POST to /v3/documents/list', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documents: [{ id: 'doc-1' }, { id: 'doc-2' }],
            pagination: { currentPage: 1, limit: 20, totalItems: 2, totalPages: 1 },
          })
        )
      );

      const result = await documents.list();

      expect(result.documents).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/documents/list'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include filter parameters', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: [], pagination: {} }))
      );

      await documents.list({
        containerTags: ['project-a'],
        limit: 50,
        page: 2,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            containerTags: ['project-a'],
            limit: 50,
            page: 2,
          }),
        })
      );
    });

    it('should handle null body', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ documents: [], pagination: {} }))
      );

      await documents.list(null);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({}) })
      );
    });
  });

  describe('add()', () => {
    it('should add document via POST to /v3/add', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc-new', status: 'processing' }))
      );

      const result = await documents.add({ content: 'New content' });

      expect(result.id).toBe('doc-new');
      expect(result.status).toBe('processing');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/add'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include all document fields', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc-new', status: 'processing' }))
      );

      await documents.add({
        content: 'Content',
        containerTag: 'my-project',
        customId: 'custom-123',
        metadata: { source: 'api' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            content: 'Content',
            containerTag: 'my-project',
            customId: 'custom-123',
            metadata: { source: 'api' },
          }),
        })
      );
    });
  });

  describe('batchAdd()', () => {
    it('should add multiple documents', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documents: [
              { id: 'doc-1', status: 'processing' },
              { id: 'doc-2', status: 'processing' },
            ],
            failed: [],
          })
        )
      );

      const result = await documents.batchAdd({
        documents: [{ content: 'Content 1' }, { content: 'Content 2' }],
      });

      expect(result.documents).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/documents/batch'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should handle partial failures', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documents: [{ id: 'doc-1', status: 'processing' }],
            failed: [{ index: 1, error: 'Invalid content' }],
          })
        )
      );

      const result = await documents.batchAdd({
        documents: [{ content: 'Valid content' }, { content: '' }],
      });

      expect(result.documents).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toEqual({ index: 1, error: 'Invalid content' });
    });
  });

  describe('update()', () => {
    it('should update document via PATCH', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc-123', status: 'processing' }))
      );

      const result = await documents.update('doc-123', { content: 'Updated content' });

      expect(result.id).toBe('doc-123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/documents/doc-123'),
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('should handle null body', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc-123', status: 'ready' }))
      );

      await documents.update('doc-123', null);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({}) })
      );
    });

    it('should URL-encode document ID', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc/special', status: 'ready' }))
      );

      await documents.update('doc/special', { content: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/documents/doc%2Fspecial'),
        expect.any(Object)
      );
    });
  });

  describe('delete()', () => {
    it('should delete document by ID', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await documents.delete('doc-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/documents/doc-123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('deleteBulk()', () => {
    it('should delete multiple documents by IDs', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            deleted: 3,
            ids: ['doc-1', 'doc-2', 'doc-3'],
          })
        )
      );

      const result = await documents.deleteBulk({
        ids: ['doc-1', 'doc-2', 'doc-3'],
      });

      expect(result.deleted).toBe(3);
      expect(result.ids).toEqual(['doc-1', 'doc-2', 'doc-3']);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/documents/delete'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should delete by container tags', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ deleted: 10, ids: [] })));

      await documents.deleteBulk({ containerTags: ['old-project'] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ containerTags: ['old-project'] }),
        })
      );
    });

    it('should handle null body', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ deleted: 0, ids: [] })));

      await documents.deleteBulk(null);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({}) })
      );
    });
  });

  describe('listProcessing()', () => {
    it('should list documents in processing state', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documents: [
              { id: 'doc-1', status: 'processing', progress: 50 },
              { id: 'doc-2', status: 'processing', progress: 75 },
            ],
          })
        )
      );

      const result = await documents.listProcessing();

      expect(result.documents).toHaveLength(2);
      expect(result.documents[0]?.status).toBe('processing');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/documents/processing'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('uploadFile()', () => {
    it('should upload file via multipart form', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc-upload', status: 'processing' }))
      );

      const file = new Blob(['test content'], { type: 'application/pdf' });
      const result = await documents.uploadFile({ file });

      expect(result.id).toBe('doc-upload');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/documents/upload'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include containerTag in form data', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc-upload', status: 'processing' }))
      );

      const file = new Blob(['test']);
      await documents.uploadFile({ file, containerTag: 'my-project' });

      const body = mockFetch.mock.calls[0][1].body;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('containerTag')).toBe('my-project');
    });

    it('should include customId in form data', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc-upload', status: 'processing' }))
      );

      const file = new Blob(['test']);
      await documents.uploadFile({ file, customId: 'custom-123' });

      const body = mockFetch.mock.calls[0][1].body;
      expect(body.get('customId')).toBe('custom-123');
    });

    it('should include metadata as JSON string', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'doc-upload', status: 'processing' }))
      );

      const file = new Blob(['test']);
      await documents.uploadFile({
        file,
        metadata: { source: 'upload', tags: ['important'] },
      });

      const body = mockFetch.mock.calls[0][1].body;
      expect(body.get('metadata')).toBe(JSON.stringify({ source: 'upload', tags: ['important'] }));
    });
  });
});
