/**
 * Extraction Worker - Processes documents from queue and extracts content
 *
 * Flow:
 * 1. Job Received (0%)
 * 2. Fetch Document from database
 * 3. Detect Content Type (text/url/file)
 * 4. Call Appropriate Extractor (50%)
 * 5. Save Extracted Content to database
 * 6. Chain to Chunking Queue (90%)
 * 7. Mark Job Complete (100%)
 *
 * Error Handling:
 * - Retry with exponential backoff (max 3 attempts)
 * - Move to dead letter queue after max retries
 * - Update processing_queue table status
 */

import { Worker, Job, Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import {
  TextExtractor,
  UrlExtractor,
  PdfExtractor,
  MarkdownExtractor,
  CodeExtractor,
} from '../services/extractors/index.js';
import type { ContentType, ExtractionResult } from '../types/document.types.js';
import { documents, processingQueue } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { workerDb as db } from '../db/worker-connection.js';
import { getLogger } from '../utils/logger.js';
import { NotFoundError, ErrorCode } from '../utils/errors.js';

const logger = getLogger('ExtractionWorker');

// Shared queue instance for chaining (prevents connection leak)
let sharedChunkingQueue: Queue | null = null;

// Job data interface
export interface ExtractionJobData {
  documentId: string;
  sourceUrl?: string;
  sourceType?: 'text' | 'url' | 'file';
  filePath?: string;
  containerTag: string;
}

// Job result interface
export interface ExtractionJobResult {
  documentId: string;
  extractedContent: string;
  contentType: ContentType;
  metadata: Record<string, unknown>;
  processingTimeMs: number;
}

// Extractor instances (singleton pattern)
const extractors = {
  text: new TextExtractor(),
  url: new UrlExtractor(),
  pdf: new PdfExtractor(),
  markdown: new MarkdownExtractor(),
  code: new CodeExtractor(),
};

/**
 * Convert content type to MIME type for database storage
 */
function contentTypeToMimeType(contentType: ContentType): string {
  const mimeTypeMap: Record<ContentType, string> = {
    text: 'text/plain',
    url: 'text/html',
    pdf: 'application/pdf',
    markdown: 'text/markdown',
    code: 'text/plain',
    unknown: 'application/octet-stream',
  };
  return mimeTypeMap[contentType] || 'text/plain';
}

/**
 * Detect content type from content string, URL, or file path
 */
function detectContentType(
  content: string,
  sourceType?: string,
  filePath?: string
): ContentType {
  // Explicit source type
  if (sourceType === 'url' && extractors.url.canHandle(content)) {
    return 'url';
  }

  // File type detection from path
  if (sourceType === 'file' && filePath) {
    const ext = filePath.toLowerCase().split('.').pop();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'go', 'rs'].includes(ext ?? '')) {
      return 'code';
    }
  }

  // Content-based detection
  if (extractors.url.canHandle(content)) {
    return 'url';
  }

  // Check for markdown patterns
  if (content.includes('```') || /^#{1,6}\s/.test(content) || content.includes('[](')) {
    return 'markdown';
  }

  // Check for code patterns
  if (
    content.includes('function ') ||
    content.includes('class ') ||
    content.includes('import ') ||
    content.includes('const ') ||
    content.includes('def ') ||
    content.includes('public class ')
  ) {
    return 'code';
  }

  // Default to text
  return 'text';
}

/**
 * Extract content using appropriate extractor
 */
async function extractContent(
  content: string,
  contentType: ContentType,
  options?: Record<string, unknown>
): Promise<ExtractionResult> {
  switch (contentType) {
    case 'url':
      return extractors.url.extract(content, options);
    case 'pdf':
      return extractors.pdf.extract(content, options);
    case 'markdown':
      return extractors.markdown.extract(content, options);
    case 'code':
      return extractors.code.extract(content, options);
    case 'text':
    default:
      return extractors.text.extract(content, options);
  }
}

/**
 * Job processor function
 */
export async function processExtractionJob(
  job: Job<ExtractionJobData>
): Promise<ExtractionJobResult> {
  const startTime = Date.now();
  const { documentId, sourceUrl, sourceType, filePath, containerTag } = job.data;

  try {
    // Update progress: 0% - Job received
    await job.updateProgress(0);
    await db
      .update(processingQueue)
      .set({
        status: 'processing',
        startedAt: new Date(),
        workerId: job.id,
      })
      .where(eq(processingQueue.documentId, documentId));

    // Fetch document from database
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);

    if (!doc) {
      throw new NotFoundError('Document', documentId, ErrorCode.DOCUMENT_NOT_FOUND);
    }

    // Detect content type
    const contentType = detectContentType(
      sourceUrl || doc.content,
      sourceType,
      filePath
    );

    // Update progress: 25% - Content type detected
    await job.updateProgress(25);

    // Extract content using appropriate extractor
    const extractionOptions = {
      metadata: doc.metadata || {},
      sourceUrl,
      filePath,
    };

    const extractionResult = await extractContent(
      sourceUrl || doc.content,
      contentType,
      extractionOptions
    );

    // Update progress: 50% - Content extracted
    await job.updateProgress(50);

    // Save extracted content to database
    await db
      .update(documents)
      .set({
        content: extractionResult.content,
        contentType: contentTypeToMimeType(contentType),
        metadata: Object.assign({}, doc.metadata || {}, extractionResult.metadata),
        status: 'processing',
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    // Update progress: 75% - Saved to database
    await job.updateProgress(75);

    // Chain to chunking queue (using shared instance to prevent connection leak)
    if (!sharedChunkingQueue) {
      // Lazy initialization for direct processExtractionJob calls (e.g., in tests)
      const connection = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      };
      sharedChunkingQueue = new Queue('chunking', { connection });
    }

    await sharedChunkingQueue.add(
      'chunk',
      {
        documentId,
        content: extractionResult.content,
        contentType,
        containerTag,
      },
      {
        priority: job.opts.priority || 0,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    // Update progress: 90% - Chained to chunking
    await job.updateProgress(90);

    // Mark processing queue job as completed
    await db
      .update(processingQueue)
      .set({
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(processingQueue.documentId, documentId));

    // Update progress: 100% - Complete
    await job.updateProgress(100);

    const processingTimeMs = Date.now() - startTime;

    return {
      documentId,
      extractedContent: extractionResult.content,
      contentType,
      metadata: extractionResult.metadata,
      processingTimeMs,
    };
  } catch (error) {
    // Update processing queue with error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const attemptNumber = job.attemptsMade + 1;

    await db
      .update(processingQueue)
      .set({
        status: attemptNumber >= 3 ? 'failed' : 'retry',
        error: errorMessage,
        errorCode: 'EXTRACTION_FAILED',
        attempts: attemptNumber,
      })
      .where(eq(processingQueue.documentId, documentId));

    // Update document status
    await db
      .update(documents)
      .set({
        status: 'failed',
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    throw error;
  }
}

/**
 * Create and configure extraction worker
 */
export function createExtractionWorker(connection: ConnectionOptions): Worker<ExtractionJobData, ExtractionJobResult> {
  // Initialize shared chunking queue to prevent connection leak
  if (!sharedChunkingQueue) {
    sharedChunkingQueue = new Queue('chunking', { connection });
  }

  const worker = new Worker<ExtractionJobData, ExtractionJobResult>(
    'extraction',
    processExtractionJob,
    {
      connection,
      concurrency: parseInt(process.env.BULLMQ_CONCURRENCY_EXTRACTION || '5', 10),
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
      limiter: {
        max: 10,
        duration: 1000,
      },
    }
  );

  // Worker event handlers
  worker.on('completed', (job: Job<ExtractionJobData, ExtractionJobResult>) => {
    logger.info('Job completed', { jobId: job.id, documentId: job.data.documentId });
  });

  worker.on('failed', (job: Job<ExtractionJobData> | undefined, err: Error) => {
    if (job) {
      logger.error('Job failed', { jobId: job.id, documentId: job.data.documentId, error: err.message });
    } else {
      logger.error('Job failed', { error: err.message });
    }
  });

  worker.on('error', (err: Error) => {
    logger.error('Worker error', { error: err.message });
  });

  worker.on('active', (job: Job<ExtractionJobData>) => {
    logger.info('Processing job', { jobId: job.id, documentId: job.data.documentId });
  });

  return worker;
}

/**
 * Create extraction queue for enqueueing jobs
 */
export function createExtractionQueue(connection: ConnectionOptions): Queue<ExtractionJobData, ExtractionJobResult> {
  return new Queue<ExtractionJobData, ExtractionJobResult>('extraction', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000, // 2s, 4s, 8s
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });
}
