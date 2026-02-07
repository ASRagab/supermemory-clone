/**
 * Connections Resource Tests
 *
 * Tests for the Connections resource operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Connections } from '../../../src/sdk/resources/connections.js';
import { HTTPClient } from '../../../src/sdk/http.js';

describe('Connections Resource', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: HTTPClient;
  let connections: Connections;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new HTTPClient({ apiKey: 'test-key', fetch: mockFetch });
    connections = new Connections(client);
  });

  describe('create()', () => {
    it('should create connection via POST', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'conn-123',
            authLink: 'https://auth.example.com/oauth',
            expiresIn: 3600,
          })
        )
      );

      const result = await connections.create('github');

      expect(result.id).toBe('conn-123');
      expect(result.authLink).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/github'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should URL-encode provider name', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'conn-123', authLink: '', expiresIn: 3600 }))
      );

      await connections.create('google-drive');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/google-drive'),
        expect.any(Object)
      );
    });

    it('should include connection parameters', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'conn-123', authLink: '', expiresIn: 3600 }))
      );

      await connections.create('github', {
        containerTags: ['project-a'],
        documentLimit: 100,
        redirectUrl: 'https://myapp.com/callback',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            containerTags: ['project-a'],
            documentLimit: 100,
            redirectUrl: 'https://myapp.com/callback',
          }),
        })
      );
    });

    it('should handle null body', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'conn-123', authLink: '', expiresIn: 3600 }))
      );

      await connections.create('github', null);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({}) })
      );
    });
  });

  describe('list()', () => {
    it('should list connections via POST', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: 'conn-1', provider: 'github' },
            { id: 'conn-2', provider: 'notion' },
          ])
        )
      );

      const result = await connections.list();

      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/list'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should filter by container tags', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([])));

      await connections.list({ containerTags: ['project-a'] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ containerTags: ['project-a'] }),
        })
      );
    });
  });

  describe('getByID()', () => {
    it('should get connection by ID', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'conn-123',
            provider: 'github',
            createdAt: '2024-01-01T00:00:00Z',
          })
        )
      );

      const result = await connections.getByID('conn-123');

      expect(result.id).toBe('conn-123');
      expect(result.provider).toBe('github');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/conn-123'),
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('getByTag()', () => {
    it('should get connections by container tag', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'conn-123',
            provider: 'github',
          })
        )
      );

      const result = await connections.getByTag('github', {
        containerTags: ['project-a'],
      });

      expect(result.id).toBe('conn-123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/github/by-tag'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('configure()', () => {
    it('should configure connection resources', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'conn-123', configured: true }))
      );

      const result = await connections.configure('conn-123', {
        resources: [{ id: 'repo-1', type: 'repository' }],
      });

      expect(result.configured).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/conn-123/configure'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('deleteByID()', () => {
    it('should delete connection by ID', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'conn-123', provider: 'github' }))
      );

      const result = await connections.deleteByID('conn-123');

      expect(result.id).toBe('conn-123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/conn-123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('deleteByProvider()', () => {
    it('should delete connections by provider and tags', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'conn-123', provider: 'github' }))
      );

      const result = await connections.deleteByProvider('github', {
        containerTags: ['old-project'],
      });

      expect(result.provider).toBe('github');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/github'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('import()', () => {
    it('should import resources from connection', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ imported: 25, failed: 2 })));

      const result = await connections.import('conn-123');

      expect(result.imported).toBe(25);
      expect(result.failed).toBe(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/conn-123/import'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include container tags', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ imported: 10, failed: 0 })));

      await connections.import('conn-123', {
        containerTags: ['imported-docs'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ containerTags: ['imported-docs'] }),
        })
      );
    });

    it('should handle null body', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ imported: 0, failed: 0 })));

      await connections.import('conn-123', null);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({}) })
      );
    });
  });

  describe('listDocuments()', () => {
    it('should list documents from connection', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documents: [
              { id: 'doc-1', title: 'Document 1' },
              { id: 'doc-2', title: 'Document 2' },
            ],
          })
        )
      );

      const result = await connections.listDocuments('conn-123');

      expect(result.documents).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/conn-123/documents'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should filter by container tags', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ documents: [] })));

      await connections.listDocuments('conn-123', {
        containerTags: ['project-a'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ containerTags: ['project-a'] }),
        })
      );
    });
  });

  describe('resources()', () => {
    it('should get available resources', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resources: [
              { id: 'repo-1', name: 'Repo 1', type: 'repository' },
              { id: 'repo-2', name: 'Repo 2', type: 'repository' },
            ],
            total_count: 2,
          })
        )
      );

      const result = await connections.resources('conn-123');

      expect(result.resources).toHaveLength(2);
      expect(result.total_count).toBe(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v3/connections/conn-123/resources'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should include pagination parameters', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ resources: [], total_count: 0 }))
      );

      await connections.resources('conn-123', { page: 2, per_page: 50 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/page=2.*per_page=50|per_page=50.*page=2/),
        expect.any(Object)
      );
    });
  });
});
