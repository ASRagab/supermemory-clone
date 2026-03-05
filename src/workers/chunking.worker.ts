/**
 * Chunking Worker
 *
 * BullMQ worker that processes documents from extraction queue,
 * chunks them using appropriate strategies, stores chunks in database,
 * and chains to embedding queue.
 *
 * Part of TASK-008: Content Processing Pipeline
 */

import { Job, Worker, Queue } from 'bullmq'
import { v4 as uuidv4 } from 'uuid'
import { eq } from 'drizzle-orm'
import { chunks } from '../db/schema/chunks.schema.js'
import { memories } from '../db/schema/memories.schema.js'
import { chunkContent, detectContentType } from '../services/chunking/index.js'
import { workerDb as db } from '../db/worker-connection.js'
import { getLogger } from '../utils/logger.js'
import { NotFoundError, ErrorCode } from '../utils/errors.js'

const logger = getLogger('ChunkingWorker')

// Job data interfaces
export interface ChunkingJobData {
  documentId: string
  memoryId: string
  content: string
  contentType?: 'markdown' | 'code' | 'text'
  chunkSize?: number
  overlap?: number
}

export interface ChunkingJobResult {
  documentId: string
  memoryId: string
  chunkCount: number
  chunkIds: string[]
  contentType: 'markdown' | 'code' | 'text'
  totalTokens: number
}

export interface EmbeddingJobData {
  documentId: string
  memoryId: string
  chunkIds: string[]
}

// Queue configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const QUEUE_NAME = 'chunking'
const EMBEDDING_QUEUE_NAME = 'embedding'
const CONCURRENCY = parseInt(process.env.BULLMQ_CONCURRENCY_CHUNKING || '3', 10)

// Retry configuration
const MAX_ATTEMPTS = 3
const BACKOFF_DELAY = 2000 // 2 seconds

/**
 * Process a chunking job
 */
async function processChunkingJob(job: Job<ChunkingJobData>): Promise<ChunkingJobResult> {
  const { documentId, memoryId, content, contentType, chunkSize, overlap } = job.data

  try {
    // Update progress: starting
    await job.updateProgress(0)
    await job.log(`Starting chunking for document ${documentId}`)

    // Detect content type if not provided
    const detectedType = contentType || detectContentType(content)
    await job.log(`Detected content type: ${detectedType}`)

    // Update progress: content type detected
    await job.updateProgress(20)

    // Chunk the content using appropriate strategy
    const contentChunks = chunkContent(content, memoryId, {
      chunkSize,
      overlap,
      contentType: detectedType,
    })

    await job.log(`Generated ${contentChunks.length} chunks`)
    await job.updateProgress(50)

    // Verify memory exists
    const memory = await db.query.memories.findFirst({
      where: eq(memories.id, memoryId),
    })

    if (!memory) {
      throw new NotFoundError('Memory', memoryId, ErrorCode.MEMORY_NOT_FOUND)
    }

    // Store chunks in database
    const chunkIds: string[] = []
    const totalTokens = contentChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0)

    for (let i = 0; i < contentChunks.length; i++) {
      const chunk = contentChunks[i]
      if (!chunk) continue
      const chunkId = uuidv4()

      await db.insert(chunks).values({
        id: chunkId,
        memoryId: memoryId,
        content: chunk.content,
        chunkIndex: i,
        startOffset: chunk.metadata.startOffset,
        endOffset: chunk.metadata.endOffset,
        tokenCount: chunk.tokenCount,
        metadata: {
          contentType: chunk.metadata.contentType,
          language: chunk.metadata.language,
          heading: chunk.metadata.heading,
          position: chunk.metadata.position,
        },
      })

      chunkIds.push(chunkId)

      // Update progress per chunk
      const progress = 50 + Math.floor(((i + 1) / contentChunks.length) * 40)
      await job.updateProgress(progress)
    }

    await job.log(`Stored ${chunkIds.length} chunks in database`)
    await job.updateProgress(90)

    // Chain to embedding queue
    const embeddingQueue = new Queue<EmbeddingJobData>(EMBEDDING_QUEUE_NAME, {
      connection: {
        host: new URL(REDIS_URL).hostname,
        port: parseInt(new URL(REDIS_URL).port || '6379', 10),
      },
    })

    await embeddingQueue.add(
      'embed',
      {
        documentId,
        memoryId,
        chunkIds,
      },
      {
        priority: 5, // Medium priority
        attempts: MAX_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: BACKOFF_DELAY,
        },
      }
    )

    await job.log(`Chained to embedding queue with ${chunkIds.length} chunks`)
    await job.updateProgress(100)

    return {
      documentId,
      memoryId,
      chunkCount: contentChunks.length,
      chunkIds,
      contentType: detectedType,
      totalTokens,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await job.log(`Error: ${errorMessage}`)
    throw error
  }
}

/**
 * Create and start chunking worker
 */
export function createChunkingWorker(): Worker<ChunkingJobData, ChunkingJobResult> {
  const worker = new Worker<ChunkingJobData, ChunkingJobResult>(QUEUE_NAME, async (job) => processChunkingJob(job), {
    connection: {
      host: new URL(REDIS_URL).hostname,
      port: parseInt(new URL(REDIS_URL).port || '6379', 10),
    },
    concurrency: CONCURRENCY,
    autorun: true,
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      count: 500, // Keep last 500 failed jobs for debugging
    },
  })

  // Event handlers
  worker.on('completed', (job, result) => {
    logger.info('Job completed', { jobId: job.id, chunkCount: result.chunkCount })
  })

  worker.on('failed', (job, error) => {
    logger.error('Job failed', { jobId: job?.id, error: error.message })
  })

  worker.on('error', (error) => {
    logger.error('Worker error', { error: error.message })
  })

  worker.on('stalled', (jobId) => {
    logger.warn('Job stalled', { jobId })
  })

  logger.info('Worker started', { concurrency: CONCURRENCY })

  return worker
}

/**
 * Create chunking queue (for adding jobs)
 */
export function createChunkingQueue(): Queue<ChunkingJobData> {
  return new Queue<ChunkingJobData>(QUEUE_NAME, {
    connection: {
      host: new URL(REDIS_URL).hostname,
      port: parseInt(new URL(REDIS_URL).port || '6379', 10),
    },
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: BACKOFF_DELAY,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  })
}

/**
 * Graceful shutdown
 */
export async function shutdownChunkingWorker(worker: Worker): Promise<void> {
  logger.info('Shutting down...')
  await worker.close()
  logger.info('Shutdown complete')
}
