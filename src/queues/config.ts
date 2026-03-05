/**
 * BullMQ Queue Configuration
 *
 * Configures Redis connection, queue options, retry logic, and concurrency settings
 * for the job queue system.
 */

import { QueueOptions, WorkerOptions } from 'bullmq'

/**
 * Redis connection configuration with health checks and reconnection logic
 */
export const redisConfig = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: true,
    enableOfflineQueue: true,
    retryStrategy: (times: number) => {
      // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
      const delay = Math.min(times * 1000, 30000)
      console.log(`[Redis] Reconnection attempt ${times}, waiting ${delay}ms`)
      return delay
    },
    reconnectOnError: (err: Error) => {
      const targetErrors = ['READONLY', 'ECONNREFUSED', 'ETIMEDOUT']
      if (targetErrors.some((targetError) => err.message.includes(targetError))) {
        console.log(`[Redis] Reconnecting due to error: ${err.message}`)
        return true
      }
      return false
    },
  },
}

/**
 * Default queue options with retry logic and dead letter queue support
 */
export const defaultQueueOptions: QueueOptions = {
  connection: redisConfig.connection,
  defaultJobOptions: {
    attempts: 3, // Maximum retry attempts
    backoff: {
      type: 'exponential',
      delay: 1000, // Initial delay: 1 second
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
      age: 24 * 3600, // Keep for 24 hours
    },
    removeOnFail: {
      count: 500, // Keep last 500 failed jobs for debugging
      age: 7 * 24 * 3600, // Keep for 7 days
    },
  },
}

/**
 * Queue-specific concurrency settings from environment variables
 */
export const concurrencySettings = {
  extraction: parseInt(process.env.BULLMQ_CONCURRENCY_EXTRACTION || '5', 10),
  chunking: parseInt(process.env.BULLMQ_CONCURRENCY_CHUNKING || '3', 10),
  embedding: parseInt(process.env.BULLMQ_CONCURRENCY_EMBEDDING || '2', 10),
  indexing: parseInt(process.env.BULLMQ_CONCURRENCY_INDEXING || '1', 10),
}

/**
 * Worker options factory
 * Creates worker configuration with concurrency settings
 */
export function createWorkerOptions(queueName: keyof typeof concurrencySettings): WorkerOptions {
  return {
    connection: redisConfig.connection,
    concurrency: concurrencySettings[queueName],
    autorun: true,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  }
}

/**
 * Dead letter queue configuration
 * Failed jobs after max retries are moved here for manual inspection
 */
export const deadLetterQueueOptions: QueueOptions = {
  ...defaultQueueOptions,
  defaultJobOptions: {
    attempts: 1, // No retries for dead letter queue
    removeOnComplete: {
      count: 1000,
      age: 30 * 24 * 3600, // Keep for 30 days
    },
    removeOnFail: false, // Never remove failed jobs from DLQ
  },
}

/**
 * Priority levels for job scheduling
 * Higher number = higher priority (executed first)
 */
export enum JobPriority {
  LOW = 1,
  NORMAL = 5,
  HIGH = 8,
  CRITICAL = 10,
}

/**
 * Job progress tracking interface
 */
export interface JobProgress {
  percentage: number // 0-100
  stage?: string
  message?: string
  processedItems?: number
  totalItems?: number
}
