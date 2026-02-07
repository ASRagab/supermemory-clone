/**
 * Embedding Worker - Generates embeddings for chunks in batches
 *
 * Responsibilities:
 * - Receive chunks from chunking queue
 * - Group into batches of 100 (OpenAI API limit)
 * - Generate embeddings using EmbeddingService
 * - Store in memory_embeddings table via PgVectorStore
 * - Chain to indexing queue with embedding IDs
 * - Track cost and progress per batch
 * - Rate limiting: 3500 RPM (58 req/sec)
 */

import { Queue, Worker, Job } from 'bullmq';
import pLimit from 'p-limit';
import { getEmbeddingService } from '../services/embedding.service.js';
import { createPgVectorStore } from '../services/vectorstore/pgvector.js';
import type { PgVectorStore } from '../services/vectorstore/pgvector.js';
import type { VectorEntry } from '../services/vectorstore/types.js';
import { getLogger } from '../utils/logger.js';
import { DatabaseError, EmbeddingError, ErrorCode } from '../utils/errors.js';

const logger = getLogger('EmbeddingWorker');

/**
 * Job data structure for embedding worker
 */
export interface EmbeddingJobData {
  /** Document ID for tracking */
  documentId: string;
  /** Chunks to embed */
  chunks: Array<{
    id: string;
    content: string;
    metadata?: Record<string, any>;
  }>;
  /** Optional: Override default batch size */
  batchSize?: number;
  /** Optional: Processing queue ID for status updates */
  processingQueueId?: string;
}

/**
 * Job result structure
 */
export interface EmbeddingJobResult {
  /** Total number of embeddings generated */
  embeddingCount: number;
  /** Total cost in USD */
  costUsd: number;
  /** Number of batches processed */
  batchesProcessed: number;
  /** Embedding IDs for chaining to indexing queue */
  embeddingIds: string[];
  /** Processing time in milliseconds */
  processingTimeMs: number;
}

/**
 * Embedding cost constants
 * Based on OpenAI text-embedding-3-small pricing: $0.0001 per 1K tokens
 */
const COST_PER_1K_TOKENS = 0.0001;
const AVG_TOKENS_PER_CHAR = 0.25; // Rough estimate: 4 chars = 1 token

/**
 * Rate limiting constants
 * 3500 RPM = 58.33 requests per second
 * Conservative limit: 58 concurrent requests
 */
const MAX_CONCURRENT_REQUESTS = 58;

/**
 * Default batch size for OpenAI API
 */
const DEFAULT_BATCH_SIZE = 100;

/**
 * Estimate token count from text length
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length * AVG_TOKENS_PER_CHAR);
}

/**
 * Calculate cost based on token count
 */
function calculateCost(tokens: number): number {
  return (tokens / 1000) * COST_PER_1K_TOKENS;
}

/**
 * Group chunks into batches
 */
function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Embedding Worker class
 */
export class EmbeddingWorker {
  private worker: Worker<EmbeddingJobData, EmbeddingJobResult> | null = null;
  private readonly queueName: string;
  private readonly connectionString: string;
  private vectorStore: PgVectorStore | null = null;
  private rateLimiter = pLimit(MAX_CONCURRENT_REQUESTS);

  constructor(
    queueName: string = 'embedding',
    connectionString?: string
  ) {
    this.queueName = queueName;
    this.connectionString = connectionString || process.env.DATABASE_URL || 'postgresql://localhost:5432/supermemory';
  }

  /**
   * Initialize the worker
   */
  async initialize(): Promise<void> {
    // Initialize vector store
    const embeddingService = getEmbeddingService();
    const dimensions = embeddingService.getDimensions();

    this.vectorStore = createPgVectorStore(this.connectionString, dimensions, {
      tableName: 'memory_embeddings',
      batchSize: DEFAULT_BATCH_SIZE,
      hnswConfig: { M: 16, efConstruction: 64 },
      metric: 'cosine',
    });

    await this.vectorStore.initialize();

    // Create worker
    this.worker = new Worker<EmbeddingJobData, EmbeddingJobResult>(
      this.queueName,
      this.processJob.bind(this),
      {
        connection: {
          host: 'localhost',
          port: 6379,
        },
        concurrency: 1, // Process one job at a time to control rate limiting globally
        removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
        removeOnFail: { count: 500 }, // Keep last 500 failed jobs
      }
    );

    // Error handling
    this.worker.on('error', (error) => {
      logger.error('Worker error', { error: error.message });
    });

    this.worker.on('failed', (job, error) => {
      logger.error('Job failed', { jobId: job?.id, error: error.message });
    });

    logger.info('Worker initialized', { queueName: this.queueName });
  }

  /**
   * Process embedding job
   */
  private async processJob(
    job: Job<EmbeddingJobData, EmbeddingJobResult>
  ): Promise<EmbeddingJobResult> {
    const startTime = Date.now();
    const { documentId, chunks, batchSize = DEFAULT_BATCH_SIZE } = job.data;

    logger.info('Processing job', { jobId: job.id, documentId, chunkCount: chunks.length });

    if (!this.vectorStore) {
      throw new DatabaseError('Vector store not initialized', 'embedding', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
      });
    }

    // Filter out empty chunks
    const validChunks = chunks.filter((chunk) => chunk.content && chunk.content.trim().length > 0);

    if (validChunks.length === 0) {
      logger.warn('No valid chunks to process', { jobId: job.id });
      return {
        embeddingCount: 0,
        costUsd: 0,
        batchesProcessed: 0,
        embeddingIds: [],
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Create batches
    const batches = createBatches(validChunks, batchSize);
    logger.info('Created batches', { batchCount: batches.length, batchSize });

    const embeddingService = getEmbeddingService();
    const embeddingIds: string[] = [];
    let totalCost = 0;
    let totalTokens = 0;

    // Process batches with rate limiting
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (!batch) continue;

      const batchProgress = Math.round(((i + 1) / batches.length) * 100);
      await job.updateProgress(batchProgress);
      logger.info('Processing batch', {
        batchNum: i + 1,
        totalBatches: batches.length,
        progress: batchProgress
      });

      // Extract texts from batch
      const texts = batch.map((chunk) => chunk.content);

      // Estimate tokens and cost
      const batchTokens = texts.reduce((sum, text) => sum + estimateTokens(text), 0);
      const batchCost = calculateCost(batchTokens);
      totalTokens += batchTokens;
      totalCost += batchCost;

      // Generate embeddings with rate limiting
      const embeddings = await this.rateLimiter(async () => {
        try {
          return await embeddingService.batchEmbed(texts);
        } catch (error) {
          logger.error('Batch failed, retrying', { batchNum: i + 1, error });
          // Retry once after exponential backoff
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, i)));
          return await embeddingService.batchEmbed(texts);
        }
      });

      // Store embeddings in vector store
      const vectorEntries: VectorEntry[] = batch.map((chunk, idx) => {
        const embedding = embeddings[idx];
        if (!embedding || embedding.length === 0) {
          throw new EmbeddingError(`Empty embedding for chunk ${chunk.id}`, undefined, {
            chunkId: chunk.id,
            batchIndex: idx,
          });
        }

        return {
          id: chunk.id,
          embedding,
          metadata: {
            ...chunk.metadata,
            documentId,
            chunkId: chunk.id,
            createdAt: new Date().toISOString(),
          },
        };
      });

      // Add to vector store in batch
      const batchResult = await this.vectorStore.addBatch(vectorEntries, {
        overwrite: false,
        namespace: 'memories',
      });

      if (batchResult.failed > 0) {
        logger.warn('Batch had failures', {
          batchNum: i + 1,
          failures: batchResult.failed,
          errors: batchResult.errors
        });
      }

      // Collect embedding IDs
      embeddingIds.push(...vectorEntries.map((entry) => entry.id));

      logger.info('Batch complete', {
        batchNum: i + 1,
        totalBatches: batches.length,
        embeddingCount: vectorEntries.length,
        tokens: batchTokens,
        cost: batchCost.toFixed(6)
      });
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info('Job complete', {
      jobId: job.id,
      embeddingCount: embeddingIds.length,
      tokens: totalTokens,
      cost: totalCost.toFixed(6),
      processingTimeMs
    });

    // Chain to indexing queue (if configured)
    await this.chainToIndexingQueue(documentId, embeddingIds);

    return {
      embeddingCount: embeddingIds.length,
      costUsd: totalCost,
      batchesProcessed: batches.length,
      embeddingIds,
      processingTimeMs,
    };
  }

  /**
   * Chain to indexing queue with embedding IDs
   */
  private async chainToIndexingQueue(
    documentId: string,
    embeddingIds: string[]
  ): Promise<void> {
    try {
      const indexingQueue = new Queue('indexing', {
        connection: {
          host: 'localhost',
          port: 6379,
        },
      });

      await indexingQueue.add(
        'index',
        {
          documentId,
          embeddingIds,
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        }
      );

      logger.info('Chained to indexing queue', { documentId });
    } catch (error) {
      logger.error('Failed to chain to indexing queue', { documentId, error });
      // Don't throw - embedding job succeeded
    }
  }

  /**
   * Close the worker and cleanup resources
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    if (this.vectorStore) {
      await this.vectorStore.close();
      this.vectorStore = null;
    }

    logger.info('Worker closed');
  }
}

/**
 * Create and initialize an embedding worker
 */
export async function createEmbeddingWorker(
  queueName?: string,
  connectionString?: string
): Promise<EmbeddingWorker> {
  const worker = new EmbeddingWorker(queueName, connectionString);
  await worker.initialize();
  return worker;
}
