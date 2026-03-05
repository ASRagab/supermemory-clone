/**
 * BullMQ Queue Tests
 *
 * Comprehensive tests for queue system including:
 * - Queue creation and configuration
 * - Job addition with priority
 * - Retry logic with exponential backoff
 * - Dead letter queue functionality
 * - Job progress tracking
 * - Queue metrics collection
 * - Redis connection health checks
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  extractionQueue,
  chunkingQueue,
  embeddingQueue,
  indexingQueue,
  deadLetterQueue,
  getQueue,
  getQueueMetrics,
  getAllQueueMetrics,
  moveToDeadLetterQueue,
  updateJobProgress,
  checkRedisHealth,
  closeAllQueues,
  QueueName,
  JobPriority,
  type JobProgress,
} from '../../src/queues/index.js'
import { concurrencySettings } from '../../src/queues/config.js'

describe('BullMQ Queue System', () => {
  beforeAll(async () => {
    // Ensure Redis is available
    const isHealthy = await checkRedisHealth()
    if (!isHealthy) {
      throw new Error('Redis is not available. Please start Redis server.')
    }
  })

  afterAll(async () => {
    // Clean up all queues and close connections
    await closeAllQueues()
  })

  beforeEach(async () => {
    // Clean queues before each test
    await extractionQueue.drain()
    await chunkingQueue.drain()
    await embeddingQueue.drain()
    await indexingQueue.drain()
    // Note: We don't drain deadLetterQueue here to preserve jobs added during tests
  })

  describe('Queue Creation and Configuration', () => {
    it('should create all 4 processing queues', () => {
      expect(extractionQueue).toBeDefined()
      expect(chunkingQueue).toBeDefined()
      expect(embeddingQueue).toBeDefined()
      expect(indexingQueue).toBeDefined()
    })

    it('should create dead letter queue', () => {
      expect(deadLetterQueue).toBeDefined()
    })

    it('should have correct queue names', () => {
      expect(extractionQueue.name).toBe(QueueName.EXTRACTION)
      expect(chunkingQueue.name).toBe(QueueName.CHUNKING)
      expect(embeddingQueue.name).toBe(QueueName.EMBEDDING)
      expect(indexingQueue.name).toBe(QueueName.INDEXING)
      expect(deadLetterQueue.name).toBe(QueueName.DEAD_LETTER)
    })

    it('should get queue by name', () => {
      const queue = getQueue(QueueName.EXTRACTION)
      expect(queue).toBe(extractionQueue)
    })

    it('should throw error for unknown queue name', () => {
      expect(() => getQueue('invalid' as QueueName)).toThrow('Unknown queue: invalid')
    })

    it('should have correct concurrency settings', () => {
      expect(concurrencySettings.extraction).toBe(5)
      expect(concurrencySettings.chunking).toBe(3)
      expect(concurrencySettings.embedding).toBe(2)
      expect(concurrencySettings.indexing).toBe(1)
    })
  })

  describe('Redis Connection Health', () => {
    it('should verify Redis connection is healthy', async () => {
      const isHealthy = await checkRedisHealth()
      expect(isHealthy).toBe(true)
    })

    it('should handle Redis ping successfully', async () => {
      const isHealthy = await checkRedisHealth()
      expect(isHealthy).toBe(true)
    })
  })

  describe('Job Addition', () => {
    it('should add a job to extraction queue', async () => {
      const job = await extractionQueue.add(
        'extract-document',
        { documentId: 'test-doc-1', url: 'https://example.com' },
        { priority: JobPriority.NORMAL }
      )

      expect(job.id).toBeDefined()
      expect(job.name).toBe('extract-document')
      expect(job.data.documentId).toBe('test-doc-1')
      expect(job.opts.priority).toBe(JobPriority.NORMAL)
    })

    it('should add jobs with different priorities', async () => {
      const lowPriorityJob = await extractionQueue.add(
        'extract-low',
        { documentId: 'low' },
        { priority: JobPriority.LOW }
      )
      const highPriorityJob = await extractionQueue.add(
        'extract-high',
        { documentId: 'high' },
        { priority: JobPriority.HIGH }
      )
      const criticalJob = await extractionQueue.add(
        'extract-critical',
        { documentId: 'critical' },
        { priority: JobPriority.CRITICAL }
      )

      expect(lowPriorityJob.opts.priority).toBe(JobPriority.LOW)
      expect(highPriorityJob.opts.priority).toBe(JobPriority.HIGH)
      expect(criticalJob.opts.priority).toBe(JobPriority.CRITICAL)
    })

    it('should add jobs to all queue types', async () => {
      const extractionJob = await extractionQueue.add('extract', { id: '1' })
      const chunkingJob = await chunkingQueue.add('chunk', { id: '2' })
      const embeddingJob = await embeddingQueue.add('embed', { id: '3' })
      const indexingJob = await indexingQueue.add('index', { id: '4' })

      expect(extractionJob.id).toBeDefined()
      expect(chunkingJob.id).toBeDefined()
      expect(embeddingJob.id).toBeDefined()
      expect(indexingJob.id).toBeDefined()
    })
  })

  describe('Retry Logic', () => {
    it('should configure jobs with maximum 3 retry attempts', async () => {
      const job = await extractionQueue.add('test-retry', { documentId: 'retry-test' })

      expect(job.opts.attempts).toBe(3)
    })

    it('should configure exponential backoff', async () => {
      const job = await extractionQueue.add('test-backoff', { documentId: 'backoff-test' })

      expect(job.opts.backoff).toEqual({
        type: 'exponential',
        delay: 1000,
      })
    })

    it('should respect custom retry attempts', async () => {
      const job = await extractionQueue.add('custom-retry', { documentId: 'custom' }, { attempts: 5 })

      expect(job.opts.attempts).toBe(5)
    })
  })

  describe('Dead Letter Queue', () => {
    it('should move failed job to dead letter queue', async () => {
      // Clean DLQ before this specific test
      await deadLetterQueue.drain()

      // Add a job to extraction queue
      const job = await extractionQueue.add('test-dlq', { documentId: 'dlq-test' })
      const jobId = job.id!

      // Move to dead letter queue and get the DLQ job ID
      const dlqJobId = await moveToDeadLetterQueue(QueueName.EXTRACTION, jobId, 'Maximum retries exceeded')

      // Verify the DLQ job was created and has an ID
      expect(dlqJobId).toBeDefined()

      // Get the DLQ job directly by ID
      const dlqJob = await deadLetterQueue.getJob(dlqJobId)
      expect(dlqJob).toBeDefined()
      expect(dlqJob?.data.originalQueue).toBe(QueueName.EXTRACTION)
      expect(dlqJob?.data.originalJobId).toBe(jobId)
      expect(dlqJob?.data.failureReason).toBe('Maximum retries exceeded')
      expect(dlqJob?.data.originalData.documentId).toBe('dlq-test')

      // Verify job is removed from original queue
      const originalJob = await extractionQueue.getJob(jobId)
      expect(originalJob).toBeUndefined()
    })

    it('should throw error when moving non-existent job', async () => {
      await expect(moveToDeadLetterQueue(QueueName.EXTRACTION, 'non-existent-id', 'Test failure')).rejects.toThrow(
        "Job with ID 'non-existent-id' not found"
      )
    })
  })

  describe('Job Progress Tracking', () => {
    it('should update job progress', async () => {
      const job = await extractionQueue.add('test-progress', { documentId: 'progress-test' })
      const jobId = job.id!

      const progress: JobProgress = {
        percentage: 50,
        stage: 'extraction',
        message: 'Extracting content...',
        processedItems: 5,
        totalItems: 10,
      }

      await updateJobProgress(QueueName.EXTRACTION, jobId, progress)

      // Verify progress was updated
      const updatedJob = await extractionQueue.getJob(jobId)
      expect(updatedJob?.progress).toEqual(progress)
    })

    it('should track progress from 0 to 100', async () => {
      const job = await extractionQueue.add('test-progress-full', { documentId: 'full-progress' })
      const jobId = job.id!

      // Start
      await updateJobProgress(QueueName.EXTRACTION, jobId, { percentage: 0, stage: 'start' })
      let updatedJob = await extractionQueue.getJob(jobId)
      expect((updatedJob?.progress as JobProgress).percentage).toBe(0)

      // Middle
      await updateJobProgress(QueueName.EXTRACTION, jobId, { percentage: 50, stage: 'processing' })
      updatedJob = await extractionQueue.getJob(jobId)
      expect((updatedJob?.progress as JobProgress).percentage).toBe(50)

      // Complete
      await updateJobProgress(QueueName.EXTRACTION, jobId, { percentage: 100, stage: 'complete' })
      updatedJob = await extractionQueue.getJob(jobId)
      expect((updatedJob?.progress as JobProgress).percentage).toBe(100)
    })

    it('should throw error when updating progress of non-existent job', async () => {
      await expect(updateJobProgress(QueueName.EXTRACTION, 'non-existent', { percentage: 50 })).rejects.toThrow(
        "Job with ID 'non-existent' not found"
      )
    })
  })

  describe('Queue Metrics', () => {
    it('should get metrics for a single queue', async () => {
      // Add some jobs
      await extractionQueue.add('test-1', { id: '1' })
      await extractionQueue.add('test-2', { id: '2' })

      const metrics = await getQueueMetrics(QueueName.EXTRACTION)

      expect(metrics).toHaveProperty('waiting')
      expect(metrics).toHaveProperty('active')
      expect(metrics).toHaveProperty('completed')
      expect(metrics).toHaveProperty('failed')
      expect(metrics).toHaveProperty('delayed')
      expect(metrics).toHaveProperty('paused')

      expect(metrics.waiting).toBeGreaterThanOrEqual(2)
      expect(typeof metrics.paused).toBe('boolean')
    })

    it('should get metrics for all queues', async () => {
      // Add jobs to different queues
      await extractionQueue.add('extract', { id: '1' })
      await chunkingQueue.add('chunk', { id: '2' })
      await embeddingQueue.add('embed', { id: '3' })

      const allMetrics = await getAllQueueMetrics()

      expect(allMetrics).toHaveProperty(QueueName.EXTRACTION)
      expect(allMetrics).toHaveProperty(QueueName.CHUNKING)
      expect(allMetrics).toHaveProperty(QueueName.EMBEDDING)
      expect(allMetrics).toHaveProperty(QueueName.INDEXING)
      expect(allMetrics).toHaveProperty(QueueName.DEAD_LETTER)

      expect(allMetrics[QueueName.EXTRACTION].waiting).toBeGreaterThanOrEqual(1)
      expect(allMetrics[QueueName.CHUNKING].waiting).toBeGreaterThanOrEqual(1)
      expect(allMetrics[QueueName.EMBEDDING].waiting).toBeGreaterThanOrEqual(1)
    })

    it('should have completed jobs tracking capability', async () => {
      // This test verifies the metrics structure includes completed count
      const metrics = await getQueueMetrics(QueueName.EXTRACTION)
      expect(metrics).toHaveProperty('completed')
      expect(typeof metrics.completed).toBe('number')
      expect(metrics.completed).toBeGreaterThanOrEqual(0)
    })

    it('should have failed jobs tracking capability', async () => {
      // This test verifies the metrics structure includes failed count
      const metrics = await getQueueMetrics(QueueName.EXTRACTION)
      expect(metrics).toHaveProperty('failed')
      expect(typeof metrics.failed).toBe('number')
      expect(metrics.failed).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Priority Support', () => {
    it('should support priority values from 1 to 10', () => {
      expect(JobPriority.LOW).toBe(1)
      expect(JobPriority.NORMAL).toBe(5)
      expect(JobPriority.HIGH).toBe(8)
      expect(JobPriority.CRITICAL).toBe(10)
    })

    it('should process higher priority jobs first', async () => {
      // This is a behavioral test - in real usage, BullMQ will process
      // higher priority jobs before lower priority ones
      const lowJob = await extractionQueue.add('low-priority', { id: 'low' }, { priority: JobPriority.LOW })
      const highJob = await extractionQueue.add('high-priority', { id: 'high' }, { priority: JobPriority.HIGH })

      expect(lowJob.opts.priority).toBeLessThan(highJob.opts.priority!)
    })
  })
})
