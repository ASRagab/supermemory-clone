/**
 * Indexing Worker
 *
 * Processes memories with embeddings, detects duplicates via similarity_hash,
 * detects relationships using EmbeddingRelationshipDetector, and updates
 * database status.
 *
 * Flow:
 * 1. Receive embeddings from embedding queue
 * 2. Check for duplicates using similarity_hash
 * 3. Insert memories into memories table
 * 4. Link embeddings via memory_embeddings table
 * 5. Detect relationships using EmbeddingRelationshipDetector
 * 6. Insert relationships into memory_relationships table
 * 7. Update documents.status = 'processed'
 * 8. Mark processing_queue job as 'completed'
 */

import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { documents } from '../db/schema/documents.schema.js'
import { memories } from '../db/schema/memories.schema.js'
import { memoryEmbeddings } from '../db/schema/embeddings.schema.js'
import { processingQueue } from '../db/schema/queue.schema.js'
import { memoryRelationships } from '../db/schema/relationships.schema.js'
import { getLogger } from '../utils/logger.js'
import { AppError, ErrorCode, DatabaseError } from '../utils/errors.js'
import { generateId } from '../utils/id.js'
import { EmbeddingRelationshipDetector, InMemoryVectorStoreAdapter } from '../services/relationships/detector.js'
import type { EmbeddingService } from '../services/embedding.service.js'
import { createHash } from 'node:crypto'
import { workerDb as db, type WorkerTransaction as DbTransaction } from '../db/worker-connection.js'
import type { MemoryType } from '../types/index.js'

const logger = getLogger('IndexingWorker')

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Database allows: fact, preference, episode, belief, skill, context
 * Vector store type (MemoryType from types/index.ts) allows: fact, event, preference, skill, relationship, context, note
 *
 * This function maps database types to vector store types for the relationship detector
 */
function mapToVectorStoreType(dbType: string): MemoryType {
  // Map database types to vector store types
  const mapping: Record<string, MemoryType> = {
    fact: 'fact',
    preference: 'preference',
    episode: 'event', // Map episode to event
    belief: 'fact', // Map belief to fact
    skill: 'skill',
    context: 'context',
  }

  return mapping[dbType] ?? 'note'
}

// ============================================================================
// Types
// ============================================================================

export interface IndexingJobData {
  /** ID of the document being indexed */
  documentId: string
  /** Container tag for the document */
  containerTag: string
  /** Processing queue job ID */
  queueJobId: string
  /** Memories with their content and embeddings */
  memories: Array<{
    content: string
    embedding: number[]
    memoryType?: 'fact' | 'preference' | 'episode' | 'belief' | 'skill' | 'context' | 'note' | 'event' | 'relationship'
    confidenceScore?: number
    metadata?: Record<string, unknown>
  }>
}

export interface IndexingJobResult {
  /** Number of memories indexed (after duplicate detection) */
  memoriesIndexed: number
  /** Number of duplicates skipped */
  duplicatesSkipped: number
  /** Number of relationships detected */
  relationshipsDetected: number
  /** IDs of indexed memories */
  memoryIds: string[]
  /** Processing time in milliseconds */
  processingTimeMs: number
}

export interface IndexingWorkerConfig {
  /** Embedding service for relationship detection */
  embeddingService: EmbeddingService
  /** Enable relationship detection (default: true) */
  enableRelationshipDetection?: boolean
  /** Skip duplicates or merge (default: skip) */
  duplicateStrategy?: 'skip' | 'merge'
  /** Batch size for relationship detection */
  relationshipBatchSize?: number
}

// ============================================================================
// Indexing Worker
// ============================================================================

export class IndexingWorker {
  private readonly embeddingService: EmbeddingService
  private readonly enableRelationshipDetection: boolean
  private readonly duplicateStrategy: 'skip' | 'merge'
  private readonly relationshipBatchSize: number
  private readonly vectorStore: InMemoryVectorStoreAdapter
  private readonly relationshipDetector: EmbeddingRelationshipDetector

  constructor(config: IndexingWorkerConfig) {
    this.embeddingService = config.embeddingService
    this.enableRelationshipDetection = config.enableRelationshipDetection ?? true
    this.duplicateStrategy = config.duplicateStrategy ?? 'skip'
    this.relationshipBatchSize = config.relationshipBatchSize ?? 50

    // Initialize vector store for relationship detection
    this.vectorStore = new InMemoryVectorStoreAdapter()
    this.relationshipDetector = new EmbeddingRelationshipDetector(this.embeddingService, this.vectorStore, {
      maxCandidates: 20,
      batchSize: this.relationshipBatchSize,
      enableContradictionDetection: true,
      enableLLMVerification: false, // Disable for performance in worker
    })

    logger.info('IndexingWorker initialized', {
      enableRelationshipDetection: this.enableRelationshipDetection,
      duplicateStrategy: this.duplicateStrategy,
      relationshipBatchSize: this.relationshipBatchSize,
    })
  }

  /**
   * Process an indexing job
   */
  async processJob(jobData: IndexingJobData): Promise<IndexingJobResult> {
    const startTime = Date.now()
    const result: IndexingJobResult = {
      memoriesIndexed: 0,
      duplicatesSkipped: 0,
      relationshipsDetected: 0,
      memoryIds: [],
      processingTimeMs: 0,
    }

    try {
      logger.info('Processing indexing job', {
        documentId: jobData.documentId,
        memoryCount: jobData.memories.length,
        containerTag: jobData.containerTag,
      })

      // Validate document exists
      const document = await db.query.documents.findFirst({
        where: eq(documents.id, jobData.documentId),
      })

      if (!document) {
        throw new DatabaseError(`Document not found: ${jobData.documentId}`, 'findDocument')
      }

      // Start transaction for atomicity
      await db.transaction(async (tx) => {
        // Step 1: Process each memory (duplicate detection + insertion)
        for (const memoryData of jobData.memories) {
          const similarityHash = this.generateSimilarityHash(memoryData.content)

          // Check for duplicates
          const existingMemory = await tx.query.memories.findFirst({
            where: eq(memories.similarityHash, similarityHash),
          })

          if (existingMemory) {
            logger.debug('Duplicate memory detected', {
              similarityHash,
              existingMemoryId: existingMemory.id,
            })
            result.duplicatesSkipped++

            if (this.duplicateStrategy === 'skip') {
              continue
            }
            // If merge strategy, we would update the existing memory here
            // For now, we skip to keep it simple
            continue
          }

          // Insert memory
          const memoryId = generateId()
          await tx.insert(memories).values({
            id: memoryId,
            documentId: jobData.documentId,
            content: memoryData.content,
            memoryType: memoryData.memoryType ?? 'fact',
            similarityHash,
            containerTag: jobData.containerTag,
            confidenceScore: memoryData.confidenceScore?.toString() ?? '1.000',
            metadata: memoryData.metadata ?? {},
            isLatest: true,
            version: 1,
          })

          // Insert embedding
          await tx.insert(memoryEmbeddings).values({
            memoryId,
            embedding: memoryData.embedding,
            model: 'text-embedding-3-small',
            normalized: true,
          })

          result.memoryIds.push(memoryId)
          result.memoriesIndexed++

          logger.debug('Memory indexed', { memoryId, similarityHash })
        }

        // Step 2: Detect relationships if enabled
        if (this.enableRelationshipDetection && result.memoriesIndexed > 0) {
          const relationshipCount = await this.detectAndStoreRelationships(tx, result.memoryIds, jobData.containerTag)
          result.relationshipsDetected = relationshipCount
        }

        // Step 3: Update document status
        await tx
          .update(documents)
          .set({
            status: 'processed',
            updatedAt: new Date(),
          })
          .where(eq(documents.id, jobData.documentId))

        // Step 4: Mark processing queue job as completed
        await tx
          .update(processingQueue)
          .set({
            status: 'completed',
            completedAt: new Date(),
          })
          .where(eq(processingQueue.id, jobData.queueJobId))

        logger.info('Transaction committed successfully', {
          documentId: jobData.documentId,
          memoriesIndexed: result.memoriesIndexed,
          duplicatesSkipped: result.duplicatesSkipped,
          relationshipsDetected: result.relationshipsDetected,
        })
      })

      result.processingTimeMs = Date.now() - startTime

      logger.info('Indexing job completed', {
        documentId: jobData.documentId,
        result,
      })

      return result
    } catch (error) {
      logger.errorWithException('Indexing job failed', error, {
        documentId: jobData.documentId,
        queueJobId: jobData.queueJobId,
      })

      // Update processing queue to failed status
      try {
        await db
          .update(processingQueue)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR,
            completedAt: new Date(),
          })
          .where(eq(processingQueue.id, jobData.queueJobId))
      } catch (updateError) {
        logger.errorWithException('Failed to update queue status to failed', updateError)
      }

      throw AppError.from(error, ErrorCode.DATABASE_ERROR)
    }
  }

  /**
   * Detect relationships between memories and store in database
   */
  private async detectAndStoreRelationships(
    tx: DbTransaction,
    memoryIds: string[],
    containerTag: string
  ): Promise<number> {
    try {
      // Load memories with embeddings
      const memoryRowsRaw = await tx
        .select({ memory: memories, embedding: memoryEmbeddings })
        .from(memories)
        .leftJoin(memoryEmbeddings, eq(memoryEmbeddings.memoryId, memories.id))
        .where(inArray(memories.id, memoryIds))

      // Filter memories to those with valid embeddings
      const memoryRows = memoryRowsRaw
        .map(({ memory, embedding }) => ({
          ...memory,
          embedding: embedding ? { embedding: embedding.embedding } : null,
        }))
        .filter((m) => {
          const emb = m.embedding as { embedding: number[] | null } | null
          return (
            emb !== null &&
            emb.embedding !== null &&
            Array.isArray(emb.embedding) &&
            m.containerTag !== null &&
            m.confidenceScore !== null
          )
        })

      if (memoryRows.length === 0) {
        return 0
      }

      // Load existing memories from the same container for relationship detection
      const existingMemoryRowsRaw = await tx
        .select({ memory: memories, embedding: memoryEmbeddings })
        .from(memories)
        .leftJoin(memoryEmbeddings, eq(memoryEmbeddings.memoryId, memories.id))
        .where(and(eq(memories.containerTag, containerTag), notInArray(memories.id, memoryIds)))
        .limit(1000) // Limit to prevent memory issues

      // Filter existing memories to those with valid embeddings
      const existingMemoryRows = existingMemoryRowsRaw
        .map(({ memory, embedding }) => ({
          ...memory,
          embedding: embedding ? { embedding: embedding.embedding } : null,
        }))
        .filter((m) => {
          const emb = m.embedding as { embedding: number[] | null } | null
          return (
            emb !== null &&
            emb.embedding !== null &&
            Array.isArray(emb.embedding) &&
            m.containerTag !== null &&
            m.confidenceScore !== null
          )
        })

      // Add existing memories to vector store
      for (const memory of existingMemoryRows) {
        // Type assertion: We've already filtered for non-null embeddings
        const embedding = (memory.embedding as { embedding: number[] }).embedding
        this.vectorStore.addMemory(
          {
            id: memory.id,
            content: memory.content,
            type: mapToVectorStoreType(memory.memoryType),
            relationships: [],
            isLatest: memory.isLatest,
            containerTag: memory.containerTag!,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt,
            confidence: parseFloat(memory.confidenceScore!),
            metadata: {
              ...(memory.metadata as Record<string, unknown>),
              confidence: parseFloat(memory.confidenceScore!),
              originalDbType: memory.memoryType, // Preserve original type
            },
          },
          embedding
        )
      }

      let totalRelationships = 0

      // Detect relationships for each new memory (already filtered to have embeddings)
      for (const memory of memoryRows) {
        // Type assertion: We've already filtered for non-null embeddings
        const embedding = (memory.embedding as { embedding: number[] }).embedding

        const detectionResult = await this.relationshipDetector.detectRelationships(
          {
            id: memory.id,
            content: memory.content,
            type: mapToVectorStoreType(memory.memoryType),
            relationships: [],
            isLatest: memory.isLatest,
            containerTag: memory.containerTag!,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt,
            confidence: parseFloat(memory.confidenceScore!),
            embedding,
            metadata: {
              ...(memory.metadata as Record<string, unknown>),
              confidence: parseFloat(memory.confidenceScore!),
              originalDbType: memory.memoryType, // Preserve original type
            },
          },
          { containerTag }
        )

        // Insert detected relationships
        for (const rel of detectionResult.relationships) {
          await tx.insert(memoryRelationships).values({
            sourceMemoryId: rel.relationship.sourceMemoryId,
            targetMemoryId: rel.relationship.targetMemoryId,
            relationshipType: rel.relationship.type,
            weight: rel.score.toString(),
            bidirectional: false,
            metadata: {
              vectorSimilarity: rel.score,
              detectedAt: new Date().toISOString(),
              llmVerified: rel.llmVerified ?? false,
            },
          })
          totalRelationships++
        }

        // Add newly indexed memory to vector store for subsequent detections
        this.vectorStore.addMemory(
          {
            id: memory.id,
            content: memory.content,
            type: mapToVectorStoreType(memory.memoryType),
            relationships: [],
            isLatest: memory.isLatest,
            containerTag: memory.containerTag!,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt,
            confidence: parseFloat(memory.confidenceScore!),
            metadata: {
              ...(memory.metadata as Record<string, unknown>),
              confidence: parseFloat(memory.confidenceScore!),
              originalDbType: memory.memoryType, // Preserve original type
            },
          },
          embedding
        )
      }

      logger.info('Relationships detected and stored', {
        newMemoriesCount: memoryRows.length,
        existingMemoriesCount: existingMemoryRows.length,
        relationshipsDetected: totalRelationships,
      })

      return totalRelationships
    } catch (error) {
      logger.errorWithException('Relationship detection failed', error)
      // Don't fail the job for relationship detection errors
      return 0
    }
  }

  /**
   * Generate similarity hash for duplicate detection
   * Uses content normalization + SHA256
   */
  private generateSimilarityHash(content: string): string {
    // Normalize content: lowercase, remove extra whitespace, trim
    const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim()

    // Generate SHA256 hash
    return createHash('sha256').update(normalized).digest('hex')
  }

  /**
   * Health check for the worker
   */
  async healthCheck(): Promise<{
    healthy: boolean
    dbConnected: boolean
    embeddingServiceReady: boolean
  }> {
    try {
      // Test database connection
      await db.query.documents.findFirst()

      return {
        healthy: true,
        dbConnected: true,
        embeddingServiceReady: !!this.embeddingService,
      }
    } catch (error) {
      logger.errorWithException('Health check failed', error)
      return {
        healthy: false,
        dbConnected: false,
        embeddingServiceReady: false,
      }
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an indexing worker instance
 */
export function createIndexingWorker(config: IndexingWorkerConfig): IndexingWorker {
  return new IndexingWorker(config)
}
