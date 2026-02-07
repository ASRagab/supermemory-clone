/**
 * BullMQ Queue Factory and Exports
 *
 * Provides queue instances for document processing pipeline:
 * - extraction: Document content extraction
 * - chunking: Text chunking for embeddings
 * - embedding: Generate vector embeddings
 * - indexing: Index into vector store
 */

import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import {
  defaultQueueOptions,
  deadLetterQueueOptions,
  redisConfig,
  concurrencySettings,
  JobProgress,
} from './config.js';
import { ValidationError, NotFoundError, ErrorCode } from '../utils/errors.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('queues');

/**
 * Queue names enum for type safety
 */
export enum QueueName {
  EXTRACTION = 'extraction',
  CHUNKING = 'chunking',
  EMBEDDING = 'embedding',
  INDEXING = 'indexing',
  DEAD_LETTER = 'dead-letter',
}

/**
 * Queue metrics interface
 */
export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

/**
 * Redis connection singleton
 */
let redisConnection: Redis | null = null;

/**
 * Get or create Redis connection
 */
export function getRedisConnection(): Redis {
  if (!redisConnection) {
    redisConnection = new Redis(redisConfig.connection);

    redisConnection.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    redisConnection.on('ready', () => {
      logger.info('Redis ready to accept commands');
    });

    redisConnection.on('error', (err: Error) => {
      logger.error('Redis connection error', {}, err);
    });

    redisConnection.on('close', () => {
      logger.info('Redis connection closed');
    });

    redisConnection.on('reconnecting', () => {
      logger.info('Redis attempting to reconnect');
    });
  }

  return redisConnection;
}

/**
 * Check Redis connection health
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const redis = getRedisConnection();
    const result = await redis.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis health check failed', {}, error instanceof Error ? error : undefined);
    return false;
  }
}

/**
 * Close Redis connection gracefully
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
    logger.info('Redis connection closed gracefully');
  }
}

/**
 * Create a queue instance
 */
function createQueue(name: QueueName, isDLQ = false): Queue {
  const options = isDLQ ? deadLetterQueueOptions : defaultQueueOptions;
  return new Queue(name, options);
}

/**
 * Queue instances
 */
export const extractionQueue = createQueue(QueueName.EXTRACTION);
export const chunkingQueue = createQueue(QueueName.CHUNKING);
export const embeddingQueue = createQueue(QueueName.EMBEDDING);
export const indexingQueue = createQueue(QueueName.INDEXING);
export const deadLetterQueue = createQueue(QueueName.DEAD_LETTER, true);

/**
 * Queue events for monitoring
 */
export const extractionEvents = new QueueEvents(QueueName.EXTRACTION, {
  connection: redisConfig.connection,
});
export const chunkingEvents = new QueueEvents(QueueName.CHUNKING, {
  connection: redisConfig.connection,
});
export const embeddingEvents = new QueueEvents(QueueName.EMBEDDING, {
  connection: redisConfig.connection,
});
export const indexingEvents = new QueueEvents(QueueName.INDEXING, {
  connection: redisConfig.connection,
});

/**
 * Get queue by name
 */
export function getQueue(name: QueueName): Queue {
  switch (name) {
    case QueueName.EXTRACTION:
      return extractionQueue;
    case QueueName.CHUNKING:
      return chunkingQueue;
    case QueueName.EMBEDDING:
      return embeddingQueue;
    case QueueName.INDEXING:
      return indexingQueue;
    case QueueName.DEAD_LETTER:
      return deadLetterQueue;
    default:
      throw new ValidationError(`Unknown queue: ${name}`, {
        queue: [`Invalid queue '${name}'. Valid queues: ${Object.values(QueueName).join(', ')}`],
      });
  }
}

/**
 * Get queue metrics for monitoring
 */
export async function getQueueMetrics(queueName: QueueName): Promise<QueueMetrics> {
  const queue = getQueue(queueName);

  const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
    queue.isPaused(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    paused: isPaused,
  };
}

/**
 * Get metrics for all queues
 */
export async function getAllQueueMetrics(): Promise<Record<QueueName, QueueMetrics>> {
  const queueNames = [
    QueueName.EXTRACTION,
    QueueName.CHUNKING,
    QueueName.EMBEDDING,
    QueueName.INDEXING,
    QueueName.DEAD_LETTER,
  ];

  const metricsPromises = queueNames.map(async (name) => ({
    name,
    metrics: await getQueueMetrics(name),
  }));

  const results = await Promise.all(metricsPromises);

  return results.reduce(
    (acc, { name, metrics }) => {
      acc[name] = metrics;
      return acc;
    },
    {} as Record<QueueName, QueueMetrics>,
  );
}

/**
 * Move failed job to dead letter queue
 */
export async function moveToDeadLetterQueue(
  queueName: QueueName,
  jobId: string,
  reason: string,
): Promise<string> {
  const sourceQueue = getQueue(queueName);
  const job = await sourceQueue.getJob(jobId);

  if (!job) {
    throw new NotFoundError('Job', jobId, ErrorCode.NOT_FOUND);
  }

  // Add to dead letter queue with original data plus metadata
  const dlqJob = await deadLetterQueue.add(
    'failed-job',
    {
      originalQueue: queueName,
      originalJobId: jobId,
      originalData: job.data,
      failureReason: reason,
      attemptsMade: job.attemptsMade,
      timestamp: new Date().toISOString(),
    },
    {
      priority: 1, // Low priority for manual review
    },
  );

  // Remove from original queue
  await job.remove();
  logger.info('Moved job to dead letter queue', { jobId, queueName, reason });

  return dlqJob.id!;
}

/**
 * Update job progress
 */
export async function updateJobProgress(
  queueName: QueueName,
  jobId: string,
  progress: JobProgress,
): Promise<void> {
  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);

  if (!job) {
    throw new NotFoundError('Job', jobId, ErrorCode.NOT_FOUND);
  }

  await job.updateProgress(progress);
}

/**
 * Clean up old jobs across all queues
 */
export async function cleanupQueues(gracePeriodMs = 24 * 60 * 60 * 1000): Promise<void> {
  const queues = [extractionQueue, chunkingQueue, embeddingQueue, indexingQueue];

  for (const queue of queues) {
    await queue.clean(gracePeriodMs, 1000, 'completed');
    await queue.clean(gracePeriodMs * 7, 1000, 'failed'); // Keep failed jobs longer
  }

  logger.info('Queue cleanup completed', { gracePeriodMs });
}

/**
 * Gracefully close all queues
 */
export async function closeAllQueues(): Promise<void> {
  const queues = [
    extractionQueue,
    chunkingQueue,
    embeddingQueue,
    indexingQueue,
    deadLetterQueue,
  ];

  const events = [extractionEvents, chunkingEvents, embeddingEvents, indexingEvents];

  await Promise.all([
    ...queues.map((q) => q.close()),
    ...events.map((e) => e.close()),
    closeRedisConnection(),
  ]);

  logger.info('All queues closed gracefully');
}

// Export types and enums
export type { JobProgress };
export { JobPriority } from './config.js';
export { concurrencySettings } from './config.js';
