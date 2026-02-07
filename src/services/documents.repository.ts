/**
 * Document Repository - Database operations for documents (PostgreSQL)
 */

import { desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getPostgresDatabase } from '../db/postgres.js';
import { getDatabaseUrl, isPostgresUrl } from '../db/client.js';
import { documents, type Document, type NewDocument } from '../db/schema/documents.schema.js';
import { DatabaseError } from '../utils/errors.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('DocumentRepository');

let _db: ReturnType<typeof getPostgresDatabase> | null = null;

function getDb(): ReturnType<typeof getPostgresDatabase> {
  if (_db) return _db;
  const databaseUrl = getDatabaseUrl();
  if (!isPostgresUrl(databaseUrl)) {
    throw new Error(
      'DocumentRepository requires a PostgreSQL DATABASE_URL. SQLite is only supported in tests and is not compatible with document persistence.'
    );
  }
  _db = getPostgresDatabase(databaseUrl);
  return _db;
}

const db = new Proxy({} as ReturnType<typeof getPostgresDatabase>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof getPostgresDatabase>];
  },
});

export interface DocumentListOptions {
  containerTag?: string;
  limit?: number;
  offset?: number;
}

export class DocumentRepository {
  private readonly database: typeof db;

  constructor(database: typeof db = db) {
    this.database = database;
  }

  async create(input: {
    id?: string;
    content: string;
    containerTag: string;
    metadata?: Record<string, unknown> | null;
    customId?: string | null;
    contentType?: string | null;
    status?: string | null;
  }): Promise<Document> {
    try {
      const [record] = await this.database
        .insert(documents)
        .values({
          id: input.id,
          content: input.content,
          containerTag: input.containerTag,
          metadata: input.metadata ?? null,
          customId: input.customId ?? null,
          contentType: input.contentType ?? 'text/plain',
          status: input.status ?? 'pending',
        } as NewDocument)
        .returning();

      if (!record) {
        throw new DatabaseError('Failed to create document', 'insert', {
          containerTag: input.containerTag,
        });
      }

      return record;
    } catch (error) {
      logger.errorWithException('Failed to create document', error, {
        containerTag: input.containerTag,
      });
      if (error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError('Failed to create document', 'insert', { originalError: error });
    }
  }

  async findById(id: string): Promise<Document | null> {
    const [record] = await this.database
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    return record ?? null;
  }

  async findByCustomId(customId: string): Promise<Document | null> {
    const [record] = await this.database
      .select()
      .from(documents)
      .where(eq(documents.customId, customId))
      .limit(1);
    return record ?? null;
  }

  async findByIdOrCustomId(idOrCustomId: string): Promise<Document | null> {
    const byId = await this.findById(idOrCustomId);
    if (byId) return byId;
    return this.findByCustomId(idOrCustomId);
  }

  async list(options: DocumentListOptions = {}): Promise<{ documents: Document[]; total: number }> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const whereClause = options.containerTag
      ? eq(documents.containerTag, options.containerTag)
      : undefined;

    const countResult = await this.database
      .select({ count: sql<number>`count(*)` })
      .from(documents)
      .where(whereClause);

    const records = await this.database
      .select()
      .from(documents)
      .where(whereClause)
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      documents: records,
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  async update(
    id: string,
    updates: {
      content?: string;
      containerTag?: string;
      metadata?: Record<string, unknown> | null;
    }
  ): Promise<Document | null> {
    try {
      const updatePayload: Partial<NewDocument> = {
        updatedAt: new Date(),
      };

      if (updates.content !== undefined) {
        updatePayload.content = updates.content;
      }

      if (updates.containerTag !== undefined) {
        updatePayload.containerTag = updates.containerTag;
      }

      if (updates.metadata !== undefined) {
        updatePayload.metadata = updates.metadata ?? null;
      }

      const [record] = await this.database
        .update(documents)
        .set(updatePayload)
        .where(eq(documents.id, id))
        .returning();

      return record ?? null;
    } catch (error) {
      logger.errorWithException('Failed to update document', error, { id });
      throw new DatabaseError('Failed to update document', 'update', { originalError: error, id });
    }
  }

  async deleteById(id: string): Promise<boolean> {
    const [deleted] = await this.database
      .delete(documents)
      .where(eq(documents.id, id))
      .returning({ id: documents.id });
    return Boolean(deleted);
  }

  async findByIdsOrCustomIds(ids: string[]): Promise<Document[]> {
    if (ids.length === 0) return [];
    return this.database
      .select()
      .from(documents)
      .where(or(inArray(documents.id, ids), inArray(documents.customId, ids)));
  }

  async deleteByIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const deleted = await this.database
      .delete(documents)
      .where(inArray(documents.id, ids))
      .returning({ id: documents.id });
    return deleted.map((row) => row.id);
  }

  async deleteByContainerTags(containerTags: string[]): Promise<string[]> {
    if (containerTags.length === 0) return [];
    const deleted = await this.database
      .delete(documents)
      .where(inArray(documents.containerTag, containerTags))
      .returning({ id: documents.id });
    return deleted.map((row) => row.id);
  }
}

// ==========================================================================
// Singleton Factory (lazy)
// ==========================================================================

let _repositoryInstance: DocumentRepository | null = null;

export function getDocumentRepository(): DocumentRepository {
  if (!_repositoryInstance) {
    _repositoryInstance = new DocumentRepository();
  }
  return _repositoryInstance;
}

export function resetDocumentRepository(): void {
  _repositoryInstance = null;
}

export function createDocumentRepository(database?: typeof db): DocumentRepository {
  return new DocumentRepository(database ?? db);
}

export const documentRepository = new Proxy({} as DocumentRepository, {
  get(_, prop) {
    return getDocumentRepository()[prop as keyof DocumentRepository];
  },
});
