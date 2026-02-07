import { eq } from 'drizzle-orm';
import { getDatabaseUrl, isPostgresUrl } from '../db/client.js';
import { getPostgresDatabase } from '../db/postgres.js';
import { documents, processingQueue } from '../db/schema/index.js';
import { extractionQueue } from '../queues/index.js';
import { createMemoryService } from './memory.service.js';
import { createSearchService } from './search.service.js';
import { ProfileService } from './profile.service.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('ingestion-service');

export interface EnqueueDocumentInput {
  documentId: string;
  content: string;
  containerTag: string;
  sourceType: 'text' | 'url' | 'file';
  sourceUrl?: string;
  filePath?: string;
}

export interface EnqueueDocumentResult {
  mode: 'queue' | 'inline';
  queued: boolean;
  queueJobId?: string;
  queueRecordId?: string;
  memoriesIndexed?: number;
  error?: string;
}

function getPostgresDbOrNull() {
  const url = getDatabaseUrl();
  if (!isPostgresUrl(url)) {
    return null;
  }
  return getPostgresDatabase(url);
}

async function processInline(input: EnqueueDocumentInput): Promise<EnqueueDocumentResult> {
  const db = getPostgresDbOrNull();

  try {
    const memoryService = createMemoryService();
    const searchService = createSearchService();
    const profileService = new ProfileService();

    const processed = await memoryService.processAndStoreMemories(input.content, {
      containerTag: input.containerTag,
      sourceId: input.documentId,
    });

    for (const memory of processed.memories) {
      await searchService.indexMemory(memory);
    }

    await profileService.ingestContent(input.containerTag, input.content, input.documentId);

    if (db) {
      await db
        .update(documents)
        .set({ status: 'processed', updatedAt: new Date() })
        .where(eq(documents.id, input.documentId));
    }

    return {
      mode: 'inline',
      queued: false,
      memoriesIndexed: processed.memories.length,
    };
  } catch (error) {
    if (db) {
      try {
        await db
          .update(documents)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(documents.id, input.documentId));
      } catch (updateError) {
        logger.warn(
          'Failed to update document status after inline ingestion failure',
          { documentId: input.documentId },
          updateError instanceof Error ? updateError : undefined
        );
      }
    }

    const message = error instanceof Error ? error.message : 'Unknown ingestion error';
    return {
      mode: 'inline',
      queued: false,
      error: message,
    };
  }
}

export async function enqueueDocumentForProcessing(
  input: EnqueueDocumentInput
): Promise<EnqueueDocumentResult> {
  const db = getPostgresDbOrNull();

  if (process.env.NODE_ENV === 'test' || !db) {
    return processInline(input);
  }

  let queueRecordId: string | undefined;

  try {
    const queueRecords = await db
      .insert(processingQueue)
      .values({
        documentId: input.documentId,
        stage: 'extraction',
        status: 'pending',
        priority: 0,
        metadata: {
          sourceType: input.sourceType,
          sourceUrl: input.sourceUrl,
          filePath: input.filePath,
        },
      })
      .returning({ id: processingQueue.id });

    queueRecordId = queueRecords[0]?.id;

    const queueJob = await extractionQueue.add(
      'extract-document',
      {
        documentId: input.documentId,
        containerTag: input.containerTag,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        filePath: input.filePath,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );

    await db
      .update(documents)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(documents.id, input.documentId));

    return {
      mode: 'queue',
      queued: true,
      queueJobId: queueJob.id?.toString(),
      queueRecordId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown queue ingestion error';

    logger.warn(
      'Queue ingestion unavailable, falling back to inline ingestion',
      { documentId: input.documentId, error: message },
      error instanceof Error ? error : undefined
    );

    if (queueRecordId) {
      try {
        await db
          .update(processingQueue)
          .set({
            status: 'failed',
            error: message,
            completedAt: new Date(),
          })
          .where(eq(processingQueue.id, queueRecordId));
      } catch {
        // Best effort only.
      }
    }

    return processInline(input);
  }
}
