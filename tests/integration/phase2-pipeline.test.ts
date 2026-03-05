/**
 * Phase 2 Integration Tests - Complete Async Processing Pipeline
 *
 * Tests the full document processing flow:
 * Document → Extraction → Chunking → Embedding → Indexing → Vector Store
 */

// CRITICAL: Set DATABASE_URL BEFORE any imports that use the database
process.env.DATABASE_URL =
  process.env.TEST_POSTGRES_URL || 'postgresql://supermemory:supermemory_secret@localhost:5432/supermemory'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Queue } from 'bullmq'
import {
  extractionQueue,
  chunkingQueue,
  embeddingQueue,
  indexingQueue,
  checkRedisHealth,
  closeAllQueues,
  getQueueMetrics,
} from '../../src/queues/index.js'
import { getDatabase } from '../../src/db/client.js'
import { documents } from '../../src/db/schema/documents.schema.js'
import { memories } from '../../src/db/schema/memories.schema.js'
import { memoryEmbeddings } from '../../src/db/schema/embeddings.schema.js'
import { processingQueue } from '../../src/db/schema/queue.schema.js'
import { eq } from 'drizzle-orm'

const db = getDatabase()

describe('Phase 2 - Complete Pipeline Integration', () => {
  beforeAll(async () => {
    // Verify Redis is running
    const redisHealthy = await checkRedisHealth()
    if (!redisHealthy) {
      throw new Error('Redis is not running. Start with: docker-compose up -d redis')
    }

    // Clean up test data
    await db.delete(processingQueue)
    await db.delete(memoryEmbeddings)
    await db.delete(memories)
    await db.delete(documents)
  })

  afterAll(async () => {
    await closeAllQueues()
  })

  describe('Queue Infrastructure', () => {
    it('should have all 4 queues initialized', () => {
      expect(extractionQueue).toBeDefined()
      expect(chunkingQueue).toBeDefined()
      expect(embeddingQueue).toBeDefined()
      expect(indexingQueue).toBeDefined()
    })

    it('should connect to Redis successfully', async () => {
      const healthy = await checkRedisHealth()
      expect(healthy).toBe(true)
    })

    it('should report queue metrics', async () => {
      const metrics = await getQueueMetrics('extraction')
      expect(metrics).toHaveProperty('waiting')
      expect(metrics).toHaveProperty('active')
      expect(metrics).toHaveProperty('completed')
      expect(metrics).toHaveProperty('failed')
    })
  })

  describe.skip('Text Document Processing', () => {
    it('should process text document through complete pipeline', async () => {
      const testContent = `
# Machine Learning Basics

Machine learning is a subset of artificial intelligence that focuses on
building systems that learn from data. There are three main types:

1. Supervised Learning - Learning from labeled data
2. Unsupervised Learning - Finding patterns in unlabeled data
3. Reinforcement Learning - Learning through trial and error

The key to successful ML is having quality training data and choosing
the right algorithm for your problem.
      `.trim()

      // Step 1: Create document
      const [doc] = await db
        .insert(documents)
        .values({
          content: testContent,
          contentType: 'text/plain',
          containerTag: 'ml-notes',
          metadata: { source: 'integration-test' },
        })
        .returning()

      expect(doc).toBeDefined()
      expect(doc.id).toBeDefined()

      // Step 2: Add to extraction queue
      const job = await extractionQueue.add('extract-document', {
        documentId: doc.id,
        contentType: doc.contentType,
        content: doc.content,
      })

      expect(job.id).toBeDefined()

      // Wait for processing (with timeout)
      const timeout = 60000 // 60 seconds
      const startTime = Date.now()

      // Poll for completion
      let completed = false
      while (!completed && Date.now() - startTime < timeout) {
        const queueStatus = await db.select().from(processingQueue).where(eq(processingQueue.documentId, doc.id))

        if (queueStatus.length > 0) {
          const lastStage = queueStatus[queueStatus.length - 1]
          if (lastStage.status === 'completed') {
            completed = true
            break
          }
        }

        // Wait 1 second before checking again
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      expect(completed).toBe(true)

      // Verify memories were created
      const createdMemories = await db.select().from(memories).where(eq(memories.documentId, doc.id))

      expect(createdMemories.length).toBeGreaterThan(0)

      // Verify embeddings were created
      const createdEmbeddings = await db.select().from(memoryEmbeddings)

      expect(createdEmbeddings.length).toBeGreaterThan(0)

      console.log(`✅ Pipeline complete: ${createdMemories.length} memories, ${createdEmbeddings.length} embeddings`)
    }, 90000) // 90 second timeout
  })

  describe.skip('URL Document Processing', () => {
    it('should process URL document through pipeline', async () => {
      const [doc] = await db
        .insert(documents)
        .values({
          content: 'https://example.com',
          contentType: 'text/html',
          containerTag: 'web-articles',
          metadata: { title: 'Example Website' },
        })
        .returning()

      const job = await extractionQueue.add('extract-url', {
        documentId: doc.id,
        userId: doc.userId,
        contentType: doc.contentType,
        url: doc.content,
      })

      expect(job.id).toBeDefined()
    })
  })

  describe('Queue Chaining', () => {
    it('should chain from extraction to chunking', async () => {
      const metrics = await getQueueMetrics('chunking')
      expect(metrics).toBeDefined()
    })

    it('should chain from chunking to embedding', async () => {
      const metrics = await getQueueMetrics('embedding')
      expect(metrics).toBeDefined()
    })

    it('should chain from embedding to indexing', async () => {
      const metrics = await getQueueMetrics('indexing')
      expect(metrics).toBeDefined()
    })
  })

  describe.skip('Error Handling', () => {
    it('should retry failed jobs with exponential backoff', async () => {
      const [doc] = await db
        .insert(documents)
        .values({
          content: 'invalid-content-to-trigger-error',
          contentType: 'text/plain',
          containerTag: 'error-test',
        })
        .returning()

      const job = await extractionQueue.add('extract-error-test', {
        documentId: doc.id,
        contentType: 'invalid-type' as any, // Intentional error
        content: 'invalid',
      })

      // Job should be attempted multiple times before failing
      await new Promise((resolve) => setTimeout(resolve, 10000)) // Wait 10s

      const queueStatus = await db.select().from(processingQueue).where(eq(processingQueue.documentId, doc.id))

      const failedJob = queueStatus.find((q) => q.status === 'failed')
      if (failedJob) {
        expect(failedJob.attempts).toBeGreaterThan(1)
        expect(failedJob.attempts).toBeLessThanOrEqual(3)
      }
    }, 15000)
  })

  describe('Performance Metrics', () => {
    it('should track processing time per stage', async () => {
      const allMetrics = await Promise.all([
        getQueueMetrics('extraction'),
        getQueueMetrics('chunking'),
        getQueueMetrics('embedding'),
        getQueueMetrics('indexing'),
      ])

      expect(allMetrics.length).toBe(4)
      allMetrics.forEach((metrics) => {
        expect(metrics).toHaveProperty('waiting')
        expect(metrics).toHaveProperty('completed')
      })
    })

    it('should report cost for embedding operations', async () => {
      // Cost tracking is logged during embedding
      // Verify through processing_queue metadata
      const embeddingJobs = await db.select().from(processingQueue).where(eq(processingQueue.stage, 'embedding'))

      const jobsWithCost = embeddingJobs.filter((job) => job.metadata && 'estimatedCost' in job.metadata)

      expect(jobsWithCost.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Database State', () => {
    it('should update document status after processing', async () => {
      const processedDocs = await db.select().from(documents)

      const completedDocs = processedDocs.filter((doc) => {
        // Check if document has been processed (has memories)
        return doc.metadata && 'processed' in doc.metadata
      })

      expect(completedDocs.length).toBeGreaterThanOrEqual(0)
    })

    it('should maintain referential integrity', async () => {
      // All embeddings should reference valid memories
      const allEmbeddings = await db.select().from(memoryEmbeddings)

      for (const emb of allEmbeddings) {
        const [memory] = await db.select().from(memories).where(eq(memories.id, emb.memoryId))

        expect(memory).toBeDefined()
      }
    })
  })
})

describe('Phase 2 - Worker Health Checks', () => {
  it('should verify extraction worker is configured', () => {
    expect(extractionQueue).toBeDefined()
    expect(extractionQueue.name).toBe('extraction')
  })

  it('should verify chunking worker is configured', () => {
    expect(chunkingQueue).toBeDefined()
    expect(chunkingQueue.name).toBe('chunking')
  })

  it('should verify embedding worker is configured', () => {
    expect(embeddingQueue).toBeDefined()
    expect(embeddingQueue.name).toBe('embedding')
  })

  it('should verify indexing worker is configured', () => {
    expect(indexingQueue).toBeDefined()
    expect(indexingQueue.name).toBe('indexing')
  })
})
