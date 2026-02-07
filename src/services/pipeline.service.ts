/**
 * Document processing pipeline - orchestrates the full extraction workflow
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Document,
  DocumentStatus,
  Chunk,
  PipelineResult,
  ChunkingOptions,
} from '../types/document.types.js';
import { ExtractionService } from './extraction.service.js';
import { ChunkingService } from './chunking.service.js';
import { NotFoundError, ExtractionError, ErrorCode } from '../utils/errors.js';

/**
 * Simple mutex implementation for protecting queue operations
 */
class Mutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift();
      next?.();
    } else {
      this.locked = false;
    }
  }

  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Thread-safe concurrent queue for document processing
 */
class ConcurrentQueue<T> {
  private items: T[] = [];
  private mutex = new Mutex();

  async enqueue(item: T): Promise<void> {
    await this.mutex.withLock(() => {
      this.items.push(item);
    });
  }

  async enqueueBatch(items: T[]): Promise<void> {
    await this.mutex.withLock(() => {
      this.items.push(...items);
    });
  }

  async dequeue(): Promise<T | undefined> {
    return this.mutex.withLock(() => {
      return this.items.shift();
    });
  }

  async size(): Promise<number> {
    return this.mutex.withLock(() => {
      return this.items.length;
    });
  }

  async isEmpty(): Promise<boolean> {
    return this.mutex.withLock(() => {
      return this.items.length === 0;
    });
  }
}

interface PipelineConfig {
  maxRetries: number;
  retryDelayMs: number;
  chunkingOptions?: ChunkingOptions;
  /** Timeout for extraction stage in milliseconds (default: 30000) */
  extractionTimeoutMs?: number;
  /** Timeout for chunking stage in milliseconds (default: 10000) */
  chunkingTimeoutMs?: number;
  /** Timeout for embedding stage in milliseconds (default: 60000) */
  embeddingTimeoutMs?: number;
  /** Timeout for indexing stage in milliseconds (default: 30000) */
  indexingTimeoutMs?: number;
  onStatusChange?: (docId: string, status: DocumentStatus) => void;
  onError?: (docId: string, error: Error) => void;
}

interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

interface IndexProvider {
  index(chunks: Chunk[]): Promise<void>;
  remove(documentId: string): Promise<void>;
}

const DEFAULT_CONFIG: PipelineConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  extractionTimeoutMs: 30000,
  chunkingTimeoutMs: 10000,
  embeddingTimeoutMs: 60000,
  indexingTimeoutMs: 30000,
};

/**
 * Timeout error for pipeline stage cancellation
 */
class PipelineTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super(`Pipeline ${stage} stage timed out after ${timeoutMs}ms`);
    this.name = 'PipelineTimeoutError';
  }
}

/**
 * Wrap an operation with a timeout that properly cancels on timeout
 */
async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  stageName: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new PipelineTimeoutError(stageName, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([operation(), timeoutPromise]);
    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export class PipelineService {
  private readonly extractionService: ExtractionService;
  private readonly chunkingService: ChunkingService;
  private readonly config: PipelineConfig;

  // Document store (in-memory for now, could be replaced with database)
  private readonly documents: Map<string, Document> = new Map();
  private readonly chunks: Map<string, Chunk[]> = new Map();

  // Optional providers
  private embeddingProvider?: EmbeddingProvider;
  private indexProvider?: IndexProvider;

  constructor(config?: Partial<PipelineConfig>) {
    this.extractionService = new ExtractionService();
    this.chunkingService = new ChunkingService();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set embedding provider for generating vector embeddings
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /**
   * Set index provider for storing and searching chunks
   */
  setIndexProvider(provider: IndexProvider): void {
    this.indexProvider = provider;
  }

  /**
   * Create a new document and add it to the queue
   */
  async createDocument(content: string, metadata?: Document['metadata']): Promise<Document> {
    const now = new Date();
    const document: Document = {
      id: uuidv4(),
      content,
      status: 'queued',
      metadata: metadata || {},
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
    };

    this.documents.set(document.id, document);
    return document;
  }

  /**
   * Process a document through the full pipeline with configurable timeouts
   */
  async processDocument(docId: string): Promise<PipelineResult> {
    const startTime = Date.now();
    const document = this.documents.get(docId);

    if (!document) {
      throw new NotFoundError('Document', docId, ErrorCode.DOCUMENT_NOT_FOUND);
    }

    try {
      // Stage 1: Extracting (with timeout)
      await this.updateStatus(docId, 'extracting');
      const extractionResult = await withTimeout(
        () => this.withRetry(() => this.extractionService.extract(document), 'extraction'),
        this.config.extractionTimeoutMs ?? DEFAULT_CONFIG.extractionTimeoutMs!,
        'extraction'
      );

      // Update document with extraction results
      document.contentType = extractionResult.contentType;
      document.metadata = {
        ...document.metadata,
        ...extractionResult.metadata,
      };

      // Stage 2: Chunking (with timeout)
      await this.updateStatus(docId, 'chunking');
      const chunks = await withTimeout(
        () =>
          this.withRetry(
            () =>
              Promise.resolve(
                this.chunkingService.chunk(
                  docId,
                  extractionResult.content,
                  extractionResult.contentType,
                  this.config.chunkingOptions
                )
              ),
            'chunking'
          ),
        this.config.chunkingTimeoutMs ?? DEFAULT_CONFIG.chunkingTimeoutMs!,
        'chunking'
      );

      // Stage 3: Embedding (if provider available, with timeout)
      if (this.embeddingProvider) {
        await this.updateStatus(docId, 'embedding');
        await withTimeout(
          () => this.withRetry(() => this.generateEmbeddings(chunks), 'embedding'),
          this.config.embeddingTimeoutMs ?? DEFAULT_CONFIG.embeddingTimeoutMs!,
          'embedding'
        );
      }

      // Stage 4: Indexing (if provider available, with timeout)
      if (this.indexProvider) {
        await this.updateStatus(docId, 'indexing');
        await withTimeout(
          () => this.withRetry(() => this.indexProvider!.index(chunks), 'indexing'),
          this.config.indexingTimeoutMs ?? DEFAULT_CONFIG.indexingTimeoutMs!,
          'indexing'
        );
      }

      // Stage 5: Done
      await this.updateStatus(docId, 'done');
      this.chunks.set(docId, chunks);

      return {
        documentId: docId,
        status: 'done',
        chunks,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      document.errorMessage = errorMessage;
      await this.updateStatus(docId, 'error');

      this.config.onError?.(docId, error as Error);

      return {
        documentId: docId,
        status: 'error',
        chunks: [],
        processingTimeMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Process multiple documents in parallel with thread-safe queue
   */
  async processDocuments(docIds: string[], concurrency: number = 5): Promise<PipelineResult[]> {
    const results: PipelineResult[] = [];
    const resultsMutex = new Mutex();
    const queue = new ConcurrentQueue<string>();

    // Enqueue all document IDs
    await queue.enqueueBatch(docIds);

    const processNext = async (): Promise<void> => {
      while (!(await queue.isEmpty())) {
        const docId = await queue.dequeue();
        if (docId) {
          const result = await this.processDocument(docId);
          // Thread-safe push to results array
          await resultsMutex.withLock(() => {
            results.push(result);
          });
        }
      }
    };

    // Create concurrent workers
    const workers = Array(Math.min(concurrency, docIds.length))
      .fill(null)
      .map(() => processNext());

    await Promise.all(workers);
    return results;
  }

  /**
   * Reprocess a failed document
   */
  async reprocessDocument(docId: string): Promise<PipelineResult> {
    const document = this.documents.get(docId);

    if (!document) {
      throw new NotFoundError('Document', docId, ErrorCode.DOCUMENT_NOT_FOUND);
    }

    // Reset retry count and clear error
    document.retryCount = 0;
    document.errorMessage = undefined;
    document.status = 'queued';

    return this.processDocument(docId);
  }

  /**
   * Get document by ID
   */
  getDocument(docId: string): Document | undefined {
    return this.documents.get(docId);
  }

  /**
   * Get chunks for a document
   */
  getChunks(docId: string): Chunk[] | undefined {
    return this.chunks.get(docId);
  }

  /**
   * Get all documents with a specific status
   */
  getDocumentsByStatus(status: DocumentStatus): Document[] {
    return Array.from(this.documents.values()).filter((doc) => doc.status === status);
  }

  /**
   * Delete a document and its chunks
   */
  async deleteDocument(docId: string): Promise<void> {
    if (this.indexProvider) {
      await this.indexProvider.remove(docId);
    }

    this.documents.delete(docId);
    this.chunks.delete(docId);
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<DocumentStatus, number>;
    totalChunks: number;
  } {
    const docs = Array.from(this.documents.values());
    const statuses: DocumentStatus[] = [
      'queued',
      'extracting',
      'chunking',
      'embedding',
      'indexing',
      'done',
      'error',
    ];

    const byStatus = statuses.reduce(
      (acc, status) => {
        acc[status] = docs.filter((d) => d.status === status).length;
        return acc;
      },
      {} as Record<DocumentStatus, number>
    );

    const totalChunks = Array.from(this.chunks.values()).reduce(
      (sum, chunks) => sum + chunks.length,
      0
    );

    return {
      total: docs.length,
      byStatus,
      totalChunks,
    };
  }

  /**
   * Update document status and notify listeners
   */
  private async updateStatus(docId: string, status: DocumentStatus): Promise<void> {
    const document = this.documents.get(docId);
    if (document) {
      document.status = status;
      document.updatedAt = new Date();
      this.config.onStatusChange?.(docId, status);
    }
  }

  /**
   * Execute with retry logic
   */
  private async withRetry<T>(operation: () => Promise<T>, stageName: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.config.maxRetries) {
          // Exponential backoff
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          await this.delay(delay);
        }
      }
    }

    throw new ExtractionError(
      `${stageName} failed after ${this.config.maxRetries + 1} attempts: ${lastError?.message}`,
      undefined,
      {
        stage: stageName,
        attempts: this.config.maxRetries + 1,
        lastError: lastError?.message,
      }
    );
  }

  /**
   * Generate embeddings for chunks
   */
  private async generateEmbeddings(chunks: Chunk[]): Promise<void> {
    if (!this.embeddingProvider) return;

    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embeddingProvider.embedBatch(texts);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      if (chunk && embedding) {
        chunk.embedding = embedding;
      }
    }
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Export documents for backup
   */
  exportDocuments(): { documents: Document[]; chunks: Record<string, Chunk[]> } {
    return {
      documents: Array.from(this.documents.values()),
      chunks: Object.fromEntries(this.chunks.entries()),
    };
  }

  /**
   * Import documents from backup
   */
  importDocuments(data: { documents: Document[]; chunks: Record<string, Chunk[]> }): void {
    for (const doc of data.documents) {
      this.documents.set(doc.id, doc);
    }

    for (const [docId, docChunks] of Object.entries(data.chunks)) {
      this.chunks.set(docId, docChunks);
    }
  }

  /**
   * Clear all documents
   */
  clear(): void {
    this.documents.clear();
    this.chunks.clear();
  }
}
