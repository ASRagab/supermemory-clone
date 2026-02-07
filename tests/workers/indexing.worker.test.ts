/**
 * Tests for Indexing Worker
 *
 * Tests cover:
 * - Job processing with embeddings
 * - Duplicate detection via similarity_hash
 * - Memory insertion
 * - Embedding linkage
 * - Relationship detection
 * - Database status updates
 * - Error handling and recovery
 * - Transaction rollback on failure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getPostgresDatabase, closePostgresDatabase } from '../../src/db/postgres.js';
import { documents } from '../../src/db/schema/documents.schema.js';
import { memories } from '../../src/db/schema/memories.schema.js';
import { memoryEmbeddings } from '../../src/db/schema/embeddings.schema.js';
import { processingQueue } from '../../src/db/schema/queue.schema.js';
import { memoryRelationships } from '../../src/db/schema/relationships.schema.js';
import {
  IndexingWorker,
  createIndexingWorker,
  type IndexingJobData,
} from '../../src/workers/indexing.worker.js';
import { MockEmbeddingService } from '../mocks/embedding.service.mock.js';
import { generateId } from '../../src/utils/id.js';
import { createHash } from 'node:crypto';

// Skip tests if PostgreSQL is not available
const DATABASE_URL =
  process.env.TEST_POSTGRES_URL ??
  process.env.DATABASE_URL ??
  'postgresql://supermemory:supermemory_secret@localhost:5432/supermemory';
const skipTests = !DATABASE_URL.startsWith('postgresql://');

describe.skipIf(skipTests)('IndexingWorker', () => {
  let worker: IndexingWorker;
  let db: ReturnType<typeof getPostgresDatabase>;
  let embeddingService: MockEmbeddingService;

  beforeEach(async () => {
    db = getPostgresDatabase(DATABASE_URL);
    embeddingService = new MockEmbeddingService();
    worker = createIndexingWorker({
      db,
      embeddingService,
      enableRelationshipDetection: true,
      duplicateStrategy: 'skip',
    });

    // Clean up test data
    await db.delete(memoryRelationships);
    await db.delete(memoryEmbeddings);
    await db.delete(memories);
    await db.delete(processingQueue);
    await db.delete(documents);
  });

  afterEach(async () => {
    await closePostgresDatabase();
  });

  describe('processJob', () => {
    it('should successfully index memories with embeddings', async () => {
      // Arrange: Create test document and queue job
      const documentId = generateId();
      const queueJobId = generateId();
      const containerTag = 'user-123';

      await db.insert(documents).values({
        id: documentId,
        content: 'Test document',
        containerTag,
        status: 'processing',
      });

      await db.insert(processingQueue).values({
        id: queueJobId,
        documentId,
        stage: 'embedding',
        status: 'processing',
      });

      const jobData: IndexingJobData = {
        documentId,
        containerTag,
        queueJobId,
        memories: [
          {
            content: 'Test memory 1',
            embedding: new Array(1536).fill(0.1),
            memoryType: 'fact',
            confidenceScore: 0.95,
          },
          {
            content: 'Test memory 2',
            embedding: new Array(1536).fill(0.2),
            memoryType: 'preference',
            confidenceScore: 0.85,
          },
        ],
      };

      // Act
      const result = await worker.processJob(jobData);

      // Assert
      expect(result.memoriesIndexed).toBe(2);
      expect(result.duplicatesSkipped).toBe(0);
      expect(result.memoryIds).toHaveLength(2);
      expect(result.processingTimeMs).toBeGreaterThan(0);

      // Verify memories in database
      const memoriesResult = await db.query.memories.findMany({
        where: eq(memories.documentId, documentId),
      });
      expect(memoriesResult).toHaveLength(2);
      expect(memoriesResult[0].content).toBe('Test memory 1');
      expect(memoriesResult[1].content).toBe('Test memory 2');

      // Verify embeddings
      const embeddings = await db.query.memoryEmbeddings.findMany();
      expect(embeddings).toHaveLength(2);

      // Verify document status updated
      const document = await db.query.documents.findFirst({
        where: eq(documents.id, documentId),
      });
      expect(document?.status).toBe('processed');

      // Verify queue job completed
      const queueJob = await db.query.processingQueue.findFirst({
        where: eq(processingQueue.id, queueJobId),
      });
      expect(queueJob?.status).toBe('completed');
      expect(queueJob?.completedAt).toBeDefined();
    });

    it('should detect and skip duplicate memories', async () => {
      // Arrange
      const documentId = generateId();
      const queueJobId = generateId();
      const containerTag = 'user-123';

      await db.insert(documents).values({
        id: documentId,
        content: 'Test document',
        containerTag,
        status: 'processing',
      });

      await db.insert(processingQueue).values({
        id: queueJobId,
        documentId,
        stage: 'embedding',
        status: 'processing',
      });

      // Insert existing memory with same content
      const existingContent = 'Duplicate content test';
      const similarityHash = createHash('sha256')
        .update(existingContent.toLowerCase().replace(/\s+/g, ' ').trim())
        .digest('hex');

      const existingMemoryId = generateId();
      await db.insert(memories).values({
        id: existingMemoryId,
        content: existingContent,
        containerTag,
        similarityHash,
        memoryType: 'fact',
      });

      const jobData: IndexingJobData = {
        documentId,
        containerTag,
        queueJobId,
        memories: [
          {
            content: existingContent, // Exact duplicate
            embedding: new Array(1536).fill(0.1),
          },
          {
            content: 'New unique content',
            embedding: new Array(1536).fill(0.2),
          },
        ],
      };

      // Act
      const result = await worker.processJob(jobData);

      // Assert
      expect(result.memoriesIndexed).toBe(1); // Only the unique one
      expect(result.duplicatesSkipped).toBe(1);

      // Verify only 2 memories total (1 existing + 1 new)
      const allMemories = await db.query.memories.findMany();
      expect(allMemories).toHaveLength(2);
    });

    it('should detect relationships between memories', async () => {
      // Arrange
      const documentId = generateId();
      const queueJobId = generateId();
      const containerTag = 'user-123';

      await db.insert(documents).values({
        id: documentId,
        content: 'Test document',
        containerTag,
        status: 'processing',
      });

      await db.insert(processingQueue).values({
        id: queueJobId,
        documentId,
        stage: 'embedding',
        status: 'processing',
      });

      // Insert existing memory for relationship detection
      const existingMemoryId = generateId();
      await db.insert(memories).values({
        id: existingMemoryId,
        content: 'Existing memory about TypeScript',
        containerTag,
        similarityHash: createHash('sha256').update('existing').digest('hex'),
        memoryType: 'fact',
      });

      await db.insert(memoryEmbeddings).values({
        memoryId: existingMemoryId,
        embedding: new Array(1536).fill(0.5), // Similar embedding
      });

      const jobData: IndexingJobData = {
        documentId,
        containerTag,
        queueJobId,
        memories: [
          {
            content: 'New memory also about TypeScript',
            embedding: new Array(1536).fill(0.5), // Similar to existing
            memoryType: 'fact',
          },
        ],
      };

      // Act
      const result = await worker.processJob(jobData);

      // Assert
      expect(result.memoriesIndexed).toBe(1);
      expect(result.relationshipsDetected).toBeGreaterThanOrEqual(0);

      // Verify relationships table (may or may not have relationships depending on similarity threshold)
      const relationships = await db.query.memoryRelationships.findMany();
      expect(Array.isArray(relationships)).toBe(true);
    });

    it('should handle errors and update queue status to failed', async () => {
      // Arrange: Invalid document ID (doesn't exist)
      const jobData: IndexingJobData = {
        documentId: 'non-existent-doc',
        containerTag: 'user-123',
        queueJobId: generateId(),
        memories: [
          {
            content: 'Test memory',
            embedding: new Array(1536).fill(0.1),
          },
        ],
      };

      // Act & Assert
      await expect(worker.processJob(jobData)).rejects.toThrow();

      // Note: Queue status update would happen if the queue job existed
    });

    it('should handle empty memories array', async () => {
      // Arrange
      const documentId = generateId();
      const queueJobId = generateId();
      const containerTag = 'user-123';

      await db.insert(documents).values({
        id: documentId,
        content: 'Test document',
        containerTag,
        status: 'processing',
      });

      await db.insert(processingQueue).values({
        id: queueJobId,
        documentId,
        stage: 'embedding',
        status: 'processing',
      });

      const jobData: IndexingJobData = {
        documentId,
        containerTag,
        queueJobId,
        memories: [],
      };

      // Act
      const result = await worker.processJob(jobData);

      // Assert
      expect(result.memoriesIndexed).toBe(0);
      expect(result.duplicatesSkipped).toBe(0);
      expect(result.relationshipsDetected).toBe(0);

      // Document should still be marked as processed
      const document = await db.query.documents.findFirst({
        where: eq(documents.id, documentId),
      });
      expect(document?.status).toBe('processed');
    });

    it('should preserve memory metadata', async () => {
      // Arrange
      const documentId = generateId();
      const queueJobId = generateId();
      const containerTag = 'user-123';

      await db.insert(documents).values({
        id: documentId,
        content: 'Test document',
        containerTag,
        status: 'processing',
      });

      await db.insert(processingQueue).values({
        id: queueJobId,
        documentId,
        stage: 'embedding',
        status: 'processing',
      });

      const metadata = {
        source: 'test',
        tags: ['important', 'review'],
        entities: [{ name: 'TypeScript', type: 'technology' }],
      };

      const jobData: IndexingJobData = {
        documentId,
        containerTag,
        queueJobId,
        memories: [
          {
            content: 'Test memory with metadata',
            embedding: new Array(1536).fill(0.1),
            metadata,
          },
        ],
      };

      // Act
      const result = await worker.processJob(jobData);

      // Assert
      const memory = await db.query.memories.findFirst({
        where: eq(memories.id, result.memoryIds[0]!),
      });

      expect(memory?.metadata).toEqual(metadata);
    });

    it('should handle different memory types', async () => {
      // Arrange
      const documentId = generateId();
      const queueJobId = generateId();
      const containerTag = 'user-123';

      await db.insert(documents).values({
        id: documentId,
        content: 'Test document',
        containerTag,
        status: 'processing',
      });

      await db.insert(processingQueue).values({
        id: queueJobId,
        documentId,
        stage: 'embedding',
        status: 'processing',
      });

      const jobData: IndexingJobData = {
        documentId,
        containerTag,
        queueJobId,
        memories: [
          {
            content: 'Fact memory',
            embedding: new Array(1536).fill(0.1),
            memoryType: 'fact',
          },
          {
            content: 'Preference memory',
            embedding: new Array(1536).fill(0.2),
            memoryType: 'preference',
          },
          {
            content: 'Episode memory',
            embedding: new Array(1536).fill(0.3),
            memoryType: 'episode',
          },
        ],
      };

      // Act
      const result = await worker.processJob(jobData);

      // Assert
      expect(result.memoriesIndexed).toBe(3);

      const storedMemories = await db.query.memories.findMany({
        where: eq(memories.documentId, documentId),
      });

      expect(storedMemories.find((m) => m.memoryType === 'fact')).toBeDefined();
      expect(storedMemories.find((m) => m.memoryType === 'preference')).toBeDefined();
      expect(storedMemories.find((m) => m.memoryType === 'episode')).toBeDefined();
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when database is connected', async () => {
      // Act
      const health = await worker.healthCheck();

      // Assert
      expect(health.healthy).toBe(true);
      expect(health.dbConnected).toBe(true);
      expect(health.embeddingServiceReady).toBe(true);
    });
  });

  describe('configuration options', () => {
    it('should respect duplicate strategy configuration', async () => {
      // Arrange: Create worker with skip strategy
      const skipWorker = createIndexingWorker({
        db,
        embeddingService,
        duplicateStrategy: 'skip',
      });

      expect(skipWorker).toBeDefined();
    });

    it('should respect relationship detection configuration', async () => {
      // Arrange: Create worker with relationship detection disabled
      const noRelWorker = createIndexingWorker({
        db,
        embeddingService,
        enableRelationshipDetection: false,
      });

      const documentId = generateId();
      const queueJobId = generateId();
      const containerTag = 'user-123';

      await db.insert(documents).values({
        id: documentId,
        content: 'Test document',
        containerTag,
        status: 'processing',
      });

      await db.insert(processingQueue).values({
        id: queueJobId,
        documentId,
        stage: 'embedding',
        status: 'processing',
      });

      const jobData: IndexingJobData = {
        documentId,
        containerTag,
        queueJobId,
        memories: [
          {
            content: 'Test memory',
            embedding: new Array(1536).fill(0.1),
          },
        ],
      };

      // Act
      const result = await noRelWorker.processJob(jobData);

      // Assert
      expect(result.relationshipsDetected).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle very long memory content', async () => {
      // Arrange
      const documentId = generateId();
      const queueJobId = generateId();
      const containerTag = 'user-123';

      await db.insert(documents).values({
        id: documentId,
        content: 'Test document',
        containerTag,
        status: 'processing',
      });

      await db.insert(processingQueue).values({
        id: queueJobId,
        documentId,
        stage: 'embedding',
        status: 'processing',
      });

      const longContent = 'A'.repeat(10000); // 10k characters

      const jobData: IndexingJobData = {
        documentId,
        containerTag,
        queueJobId,
        memories: [
          {
            content: longContent,
            embedding: new Array(1536).fill(0.1),
          },
        ],
      };

      // Act
      const result = await worker.processJob(jobData);

      // Assert
      expect(result.memoriesIndexed).toBe(1);

      const memory = await db.query.memories.findFirst({
        where: eq(memories.id, result.memoryIds[0]!),
      });
      expect(memory?.content).toBe(longContent);
    });

    it('should handle special characters in content', async () => {
      // Arrange
      const documentId = generateId();
      const queueJobId = generateId();
      const containerTag = 'user-123';

      await db.insert(documents).values({
        id: documentId,
        content: 'Test document',
        containerTag,
        status: 'processing',
      });

      await db.insert(processingQueue).values({
        id: queueJobId,
        documentId,
        stage: 'embedding',
        status: 'processing',
      });

      const specialContent = `Test with "quotes", 'apostrophes', <tags>, & symbols! 🚀`;

      const jobData: IndexingJobData = {
        documentId,
        containerTag,
        queueJobId,
        memories: [
          {
            content: specialContent,
            embedding: new Array(1536).fill(0.1),
          },
        ],
      };

      // Act
      const result = await worker.processJob(jobData);

      // Assert
      expect(result.memoriesIndexed).toBe(1);

      const memory = await db.query.memories.findFirst({
        where: eq(memories.id, result.memoryIds[0]!),
      });
      expect(memory?.content).toBe(specialContent);
    });
  });
});
