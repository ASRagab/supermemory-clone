/**
 * Documents API Tests
 *
 * Comprehensive tests for document CRUD operations,
 * validation errors, and rate limiting.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * Mock Document Store for API Testing
 */
interface Document {
  id: string;
  content: string;
  containerTag?: string;
  customId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Mock API Client for Document Operations
 */
class DocumentsAPI {
  private documents = new Map<string, Document>();
  private requestCount = 0;
  private rateLimitWindow = 60000; // 1 minute
  private rateLimitMax = 100;
  private lastReset = Date.now();

  /**
   * Create a new document
   */
  async create(input: {
    content: string;
    containerTag?: string;
    customId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ data: Document; timing: number }> {
    const startTime = Date.now();
    this.checkRateLimit();

    // Validation
    if (!input.content || input.content.trim().length === 0) {
      throw new ValidationError('Content is required');
    }

    if (input.content.length > 100000) {
      throw new ValidationError('Content exceeds maximum length of 100000 characters');
    }

    // Check for duplicate customId
    if (input.customId) {
      for (const doc of this.documents.values()) {
        if (doc.customId === input.customId) {
          throw new ValidationError(`Document with customId '${input.customId}' already exists`);
        }
      }
    }

    const now = new Date().toISOString();
    const document: Document = {
      id: this.generateId(),
      content: input.content,
      containerTag: input.containerTag,
      customId: input.customId,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };

    this.documents.set(document.id, document);

    return {
      data: document,
      timing: Date.now() - startTime,
    };
  }

  /**
   * Get a document by ID or customId
   */
  async get(id: string): Promise<{ data: Document; timing: number }> {
    const startTime = Date.now();
    this.checkRateLimit();

    let document = this.documents.get(id);

    // Check by customId
    if (!document) {
      for (const doc of this.documents.values()) {
        if (doc.customId === id) {
          document = doc;
          break;
        }
      }
    }

    if (!document) {
      throw new NotFoundError('Document', id);
    }

    return {
      data: document,
      timing: Date.now() - startTime,
    };
  }

  /**
   * Update a document
   */
  async update(
    id: string,
    input: {
      content?: string;
      containerTag?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<{ data: Document; timing: number }> {
    const startTime = Date.now();
    this.checkRateLimit();

    const existing = await this.findDocument(id);

    if (!existing) {
      throw new NotFoundError('Document', id);
    }

    // Validation
    if (input.content !== undefined && input.content.trim().length === 0) {
      throw new ValidationError('Content cannot be empty');
    }

    const updated: Document = {
      ...existing,
      ...(input.content !== undefined && { content: input.content }),
      ...(input.containerTag !== undefined && { containerTag: input.containerTag }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
      updatedAt: new Date().toISOString(),
    };

    this.documents.set(existing.id, updated);

    return {
      data: updated,
      timing: Date.now() - startTime,
    };
  }

  /**
   * Delete a document
   */
  async delete(id: string): Promise<{ data: { deleted: true; id: string }; timing: number }> {
    const startTime = Date.now();
    this.checkRateLimit();

    const existing = await this.findDocument(id);

    if (!existing) {
      throw new NotFoundError('Document', id);
    }

    this.documents.delete(existing.id);

    return {
      data: { deleted: true, id: existing.id },
      timing: Date.now() - startTime,
    };
  }

  /**
   * List documents with optional filtering
   */
  async list(query?: { containerTag?: string; limit?: number; offset?: number }): Promise<{
    data: { documents: Document[]; total: number; limit: number; offset: number };
    timing: number;
  }> {
    const startTime = Date.now();
    this.checkRateLimit();

    const limit = query?.limit ?? 20;
    const offset = query?.offset ?? 0;

    let results = Array.from(this.documents.values());

    // Filter by containerTag
    if (query?.containerTag) {
      results = results.filter((doc) => doc.containerTag === query.containerTag);
    }

    // Sort by createdAt descending
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = results.length;
    results = results.slice(offset, offset + limit);

    return {
      data: {
        documents: results,
        total,
        limit,
        offset,
      },
      timing: Date.now() - startTime,
    };
  }

  /**
   * Bulk delete documents
   */
  async bulkDelete(input: { ids?: string[]; containerTags?: string[] }): Promise<{
    data: { deleted: string[]; notFound: string[]; count: number };
    timing: number;
  }> {
    const startTime = Date.now();
    this.checkRateLimit();

    const deletedIds: string[] = [];
    const notFoundIds: string[] = [];

    // Delete by IDs
    if (input.ids) {
      for (const id of input.ids) {
        const doc = await this.findDocument(id);
        if (doc) {
          this.documents.delete(doc.id);
          deletedIds.push(doc.id);
        } else {
          notFoundIds.push(id);
        }
      }
    }

    // Delete by containerTags
    if (input.containerTags) {
      for (const tag of input.containerTags) {
        for (const [id, doc] of this.documents.entries()) {
          if (doc.containerTag === tag) {
            this.documents.delete(id);
            deletedIds.push(id);
          }
        }
      }
    }

    return {
      data: {
        deleted: deletedIds,
        notFound: notFoundIds,
        count: deletedIds.length,
      },
      timing: Date.now() - startTime,
    };
  }

  /**
   * Reset the store (for testing)
   */
  reset(): void {
    this.documents.clear();
    this.requestCount = 0;
    this.lastReset = Date.now();
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(): { remaining: number; limit: number; reset: number } {
    this.maybeResetWindow();
    return {
      remaining: this.rateLimitMax - this.requestCount,
      limit: this.rateLimitMax,
      reset: this.lastReset + this.rateLimitWindow,
    };
  }

  private generateId(): string {
    return `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async findDocument(id: string): Promise<Document | undefined> {
    let document = this.documents.get(id);

    if (!document) {
      for (const doc of this.documents.values()) {
        if (doc.customId === id) {
          document = doc;
          break;
        }
      }
    }

    return document;
  }

  private checkRateLimit(): void {
    this.maybeResetWindow();
    this.requestCount++;

    if (this.requestCount > this.rateLimitMax) {
      throw new RateLimitError();
    }
  }

  private maybeResetWindow(): void {
    const now = Date.now();
    if (now - this.lastReset > this.rateLimitWindow) {
      this.requestCount = 0;
      this.lastReset = now;
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

class NotFoundError extends Error {
  code = 'NOT_FOUND';
  constructor(resource: string, id: string) {
    super(`${resource} with id '${id}' not found`);
    this.name = 'NotFoundError';
  }
}

class RateLimitError extends Error {
  code = 'RATE_LIMIT_EXCEEDED';
  constructor() {
    super('Rate limit exceeded. Please try again later.');
    this.name = 'RateLimitError';
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Documents API', () => {
  let api: DocumentsAPI;

  beforeEach(() => {
    api = new DocumentsAPI();
  });

  afterEach(() => {
    api.reset();
  });

  // ============================================================================
  // Create Document Tests
  // ============================================================================

  describe('POST /documents (create)', () => {
    it('should create a document with valid content', async () => {
      const response = await api.create({
        content: 'Test document content',
      });

      expect(response.data).toBeDefined();
      expect(response.data.id).toBeDefined();
      expect(response.data.content).toBe('Test document content');
    });

    it('should include timing information', async () => {
      const response = await api.create({
        content: 'Timing test',
      });

      expect(response.timing).toBeGreaterThanOrEqual(0);
    });

    it('should set createdAt and updatedAt timestamps', async () => {
      const response = await api.create({
        content: 'Timestamp test',
      });

      expect(response.data.createdAt).toBeDefined();
      expect(response.data.updatedAt).toBeDefined();
    });

    it('should accept optional containerTag', async () => {
      const response = await api.create({
        content: 'Tagged content',
        containerTag: 'my-project',
      });

      expect(response.data.containerTag).toBe('my-project');
    });

    it('should accept optional customId', async () => {
      const response = await api.create({
        content: 'Custom ID content',
        customId: 'my-custom-id',
      });

      expect(response.data.customId).toBe('my-custom-id');
    });

    it('should accept optional metadata', async () => {
      const response = await api.create({
        content: 'Metadata content',
        metadata: { source: 'test', priority: 'high' },
      });

      expect(response.data.metadata).toEqual({ source: 'test', priority: 'high' });
    });

    it('should generate unique IDs for each document', async () => {
      const doc1 = await api.create({ content: 'Doc 1' });
      const doc2 = await api.create({ content: 'Doc 2' });

      expect(doc1.data.id).not.toBe(doc2.data.id);
    });
  });

  // ============================================================================
  // Get Document Tests
  // ============================================================================

  describe('GET /documents/:id (get)', () => {
    it('should retrieve a document by ID', async () => {
      const created = await api.create({ content: 'Get test' });
      const response = await api.get(created.data.id);

      expect(response.data.id).toBe(created.data.id);
      expect(response.data.content).toBe('Get test');
    });

    it('should retrieve a document by customId', async () => {
      await api.create({ content: 'Custom ID test', customId: 'custom-123' });
      const response = await api.get('custom-123');

      expect(response.data.customId).toBe('custom-123');
    });

    it('should throw NotFoundError for non-existent ID', async () => {
      await expect(api.get('non-existent-id')).rejects.toThrow(NotFoundError);
    });

    it('should return timing information', async () => {
      const created = await api.create({ content: 'Timing test' });
      const response = await api.get(created.data.id);

      expect(response.timing).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // Update Document Tests
  // ============================================================================

  describe('PUT /documents/:id (update)', () => {
    it('should update document content', async () => {
      const created = await api.create({ content: 'Original content' });
      const updated = await api.update(created.data.id, { content: 'Updated content' });

      expect(updated.data.content).toBe('Updated content');
    });

    it('should update containerTag', async () => {
      const created = await api.create({ content: 'Tag test', containerTag: 'old-tag' });
      const updated = await api.update(created.data.id, { containerTag: 'new-tag' });

      expect(updated.data.containerTag).toBe('new-tag');
    });

    it('should update metadata', async () => {
      const created = await api.create({ content: 'Meta test', metadata: { a: 1 } });
      const updated = await api.update(created.data.id, { metadata: { b: 2 } });

      expect(updated.data.metadata).toEqual({ b: 2 });
    });

    it('should update the updatedAt timestamp', async () => {
      const created = await api.create({ content: 'Timestamp test' });
      const originalUpdatedAt = created.data.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      const updated = await api.update(created.data.id, { content: 'New content' });

      expect(updated.data.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should preserve fields not being updated', async () => {
      const created = await api.create({
        content: 'Preserve test',
        containerTag: 'my-tag',
        metadata: { key: 'value' },
      });

      const updated = await api.update(created.data.id, { content: 'New content' });

      expect(updated.data.containerTag).toBe('my-tag');
      expect(updated.data.metadata).toEqual({ key: 'value' });
    });

    it('should throw NotFoundError for non-existent document', async () => {
      await expect(api.update('non-existent', { content: 'test' })).rejects.toThrow(NotFoundError);
    });

    it('should work with customId', async () => {
      await api.create({ content: 'Custom update', customId: 'update-custom' });
      const updated = await api.update('update-custom', { content: 'Updated via custom' });

      expect(updated.data.content).toBe('Updated via custom');
    });
  });

  // ============================================================================
  // Delete Document Tests
  // ============================================================================

  describe('DELETE /documents/:id (delete)', () => {
    it('should delete a document', async () => {
      const created = await api.create({ content: 'Delete test' });
      const response = await api.delete(created.data.id);

      expect(response.data.deleted).toBe(true);
      expect(response.data.id).toBe(created.data.id);
    });

    it('should make document unretrievable after deletion', async () => {
      const created = await api.create({ content: 'Gone test' });
      await api.delete(created.data.id);

      await expect(api.get(created.data.id)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for non-existent document', async () => {
      await expect(api.delete('non-existent')).rejects.toThrow(NotFoundError);
    });

    it('should work with customId', async () => {
      await api.create({ content: 'Custom delete', customId: 'delete-custom' });
      const response = await api.delete('delete-custom');

      expect(response.data.deleted).toBe(true);
    });
  });

  // ============================================================================
  // List Documents Tests
  // ============================================================================

  describe('GET /documents (list)', () => {
    it('should list all documents', async () => {
      await api.create({ content: 'Doc 1' });
      await api.create({ content: 'Doc 2' });
      await api.create({ content: 'Doc 3' });

      const response = await api.list();

      expect(response.data.documents).toHaveLength(3);
      expect(response.data.total).toBe(3);
    });

    it('should filter by containerTag', async () => {
      await api.create({ content: 'Work 1', containerTag: 'work' });
      await api.create({ content: 'Personal 1', containerTag: 'personal' });
      await api.create({ content: 'Work 2', containerTag: 'work' });

      const response = await api.list({ containerTag: 'work' });

      expect(response.data.documents).toHaveLength(2);
      response.data.documents.forEach((doc: Document) => {
        expect(doc.containerTag).toBe('work');
      });
    });

    it('should support pagination with limit', async () => {
      for (let i = 0; i < 10; i++) {
        await api.create({ content: `Doc ${i}` });
      }

      const response = await api.list({ limit: 5 });

      expect(response.data.documents).toHaveLength(5);
      expect(response.data.limit).toBe(5);
    });

    it('should support pagination with offset', async () => {
      for (let i = 0; i < 10; i++) {
        await api.create({ content: `Doc ${i}` });
      }

      const response = await api.list({ limit: 5, offset: 5 });

      expect(response.data.documents).toHaveLength(5);
      expect(response.data.offset).toBe(5);
    });

    it('should sort by createdAt descending', async () => {
      await api.create({ content: 'First' });
      await new Promise((r) => setTimeout(r, 10));
      await api.create({ content: 'Second' });
      await new Promise((r) => setTimeout(r, 10));
      await api.create({ content: 'Third' });

      const response = await api.list();

      expect(response.data.documents[0]?.content).toBe('Third');
      expect(response.data.documents[2]?.content).toBe('First');
    });

    it('should return empty array when no documents exist', async () => {
      const response = await api.list();

      expect(response.data.documents).toHaveLength(0);
      expect(response.data.total).toBe(0);
    });
  });

  // ============================================================================
  // Bulk Delete Tests
  // ============================================================================

  describe('POST /documents/bulk-delete (bulkDelete)', () => {
    it('should delete multiple documents by IDs', async () => {
      const doc1 = await api.create({ content: 'Bulk 1' });
      const doc2 = await api.create({ content: 'Bulk 2' });
      await api.create({ content: 'Keep this' });

      const response = await api.bulkDelete({ ids: [doc1.data.id, doc2.data.id] });

      expect(response.data.deleted).toHaveLength(2);
      expect(response.data.count).toBe(2);

      const remaining = await api.list();
      expect(remaining.data.total).toBe(1);
    });

    it('should delete by containerTags', async () => {
      await api.create({ content: 'Project A', containerTag: 'project-a' });
      await api.create({ content: 'Project A 2', containerTag: 'project-a' });
      await api.create({ content: 'Project B', containerTag: 'project-b' });

      const response = await api.bulkDelete({ containerTags: ['project-a'] });

      expect(response.data.count).toBe(2);

      const remaining = await api.list();
      expect(remaining.data.total).toBe(1);
    });

    it('should report not found IDs', async () => {
      await api.create({ content: 'Exists' });

      const response = await api.bulkDelete({ ids: ['non-existent-1', 'non-existent-2'] });

      expect(response.data.notFound).toHaveLength(2);
      expect(response.data.notFound).toContain('non-existent-1');
    });

    it('should handle mixed existing and non-existing IDs', async () => {
      const doc = await api.create({ content: 'Exists' });

      const response = await api.bulkDelete({
        ids: [doc.data.id, 'non-existent'],
      });

      expect(response.data.deleted).toHaveLength(1);
      expect(response.data.notFound).toHaveLength(1);
    });
  });

  // ============================================================================
  // Validation Error Tests
  // ============================================================================

  describe('Validation Errors', () => {
    it('should reject empty content', async () => {
      await expect(api.create({ content: '' })).rejects.toThrow(ValidationError);
    });

    it('should reject whitespace-only content', async () => {
      await expect(api.create({ content: '   ' })).rejects.toThrow(ValidationError);
    });

    it('should reject content exceeding max length', async () => {
      const longContent = 'A'.repeat(100001);
      await expect(api.create({ content: longContent })).rejects.toThrow(ValidationError);
    });

    it('should reject duplicate customId', async () => {
      await api.create({ content: 'First', customId: 'duplicate' });

      await expect(api.create({ content: 'Second', customId: 'duplicate' })).rejects.toThrow(
        ValidationError
      );
    });

    it('should reject update with empty content', async () => {
      const doc = await api.create({ content: 'Original' });

      await expect(api.update(doc.data.id, { content: '' })).rejects.toThrow(ValidationError);
    });
  });

  // ============================================================================
  // Rate Limiting Tests
  // ============================================================================

  describe('Rate Limiting', () => {
    it('should track remaining requests', () => {
      const status = api.getRateLimitStatus();

      expect(status.remaining).toBe(100);
      expect(status.limit).toBe(100);
    });

    it('should decrease remaining after requests', async () => {
      await api.create({ content: 'Request 1' });
      await api.create({ content: 'Request 2' });

      const status = api.getRateLimitStatus();
      expect(status.remaining).toBe(98);
    });

    it('should throw RateLimitError when limit exceeded', async () => {
      // Make 100 requests to hit the limit
      for (let i = 0; i < 100; i++) {
        await api.create({ content: `Doc ${i}` });
      }

      // The 101st request should fail
      await expect(api.create({ content: 'Over limit' })).rejects.toThrow(RateLimitError);
    });

    it('should include reset time in status', () => {
      const status = api.getRateLimitStatus();

      expect(status.reset).toBeGreaterThan(Date.now());
    });
  });
});
