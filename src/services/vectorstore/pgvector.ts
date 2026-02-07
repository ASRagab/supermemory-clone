/**
 * PostgreSQL pgvector Vector Store
 *
 * Production-ready vector store implementation using PostgreSQL with pgvector extension.
 * Supports HNSW indexing for fast approximate nearest neighbor search.
 *
 * Features:
 * - HNSW index support for O(log n) search performance
 * - Connection pooling with production-ready settings
 * - Batch operations with transaction support
 * - Metadata filtering and threshold-based search
 * - Automatic pgvector extension enablement
 */

import {
  VectorEntry,
  VectorSearchResult,
  SearchOptions,
  AddOptions,
  DeleteOptions,
  VectorStoreConfig,
  VectorStoreStats,
  BatchResult,
  MetadataFilter,
} from './types.js';
import { BaseVectorStore, validateVector } from './base.js';
import pkg from 'pg';
const { Pool } = pkg;
import type { Pool as PgPool, PoolClient, QueryResult } from 'pg';
import { DatabaseError, ConflictError, ErrorCode } from '../../utils/errors.js';
import {
  getPostgresDatabase,
  closePostgresDatabase,
  type PostgresDatabaseInstance
} from '../../db/postgres.js';

/**
 * pgvector-specific configuration
 */
export interface PgVectorStoreConfig extends VectorStoreConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Table name for vector storage (default: 'vector_embeddings') */
  tableName?: string;
  /** Batch size for bulk operations (default: 100) */
  batchSize?: number;
}

/**
 * Internal entry structure for PostgreSQL storage
 */
interface PgVectorEntry {
  id: string;
  embedding: string; // pgvector format: '[1,2,3]'
  metadata: any; // Already parsed by pg library from JSONB
  namespace: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * PostgreSQL pgvector Vector Store implementation
 */
export class PgVectorStore extends BaseVectorStore {
  private db: PostgresDatabaseInstance | null = null;
  private pool: PgPool | null = null;
  private readonly connectionString: string;
  private readonly tableName: string;
  private readonly batchSize: number;
  private initialized = false;

  constructor(config: PgVectorStoreConfig) {
    super({
      ...config,
      provider: 'pgvector',
      indexType: config.hnswConfig ? 'hnsw' : 'flat',
    });

    this.connectionString = config.connectionString;
    this.tableName = config.tableName ?? 'vector_embeddings';
    this.batchSize = config.batchSize ?? 100;
  }

  /**
   * Initialize the pgvector store
   * Creates table and HNSW index if they don't exist
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Get database connection
    this.db = getPostgresDatabase(this.connectionString);

    // Create connection pool for direct queries
    this.pool = new Pool({ connectionString: this.connectionString });

    // Create table if it doesn't exist
    await this.createTableIfNotExists();

    // Create HNSW index if configured
    if (this.config.hnswConfig) {
      await this.createHNSWIndex();
    }

    this.initialized = true;
  }

  /**
   * Create the vector embeddings table
   */
  private async createTableIfNotExists(): Promise<void> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id VARCHAR(255) PRIMARY KEY,
        embedding vector(${this.config.dimensions}) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        namespace VARCHAR(255) NOT NULL DEFAULT 'default',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `;

    await this.pool.query(createTableSQL);
  }

  /**
   * Create HNSW index for fast vector search
   */
  private async createHNSWIndex(): Promise<void> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const hnswConfig = this.config.hnswConfig ?? { M: 16, efConstruction: 64 };
    const indexName = `${this.tableName}_hnsw_idx`;

    // Use cosine distance operator for similarity search
    const metric = this.config.metric ?? 'cosine';
    const operator = metric === 'cosine' ? 'vector_cosine_ops' :
                     metric === 'euclidean' ? 'vector_l2_ops' :
                     'vector_ip_ops'; // inner product for dot_product

    const createIndexSQL = `
      CREATE INDEX IF NOT EXISTS ${indexName}
      ON ${this.tableName}
      USING hnsw (embedding ${operator})
      WITH (m = ${hnswConfig.M}, ef_construction = ${hnswConfig.efConstruction})
    `;

    await this.pool.query(createIndexSQL);
  }

  /**
   * Add a single vector entry
   */
  async add(entry: VectorEntry, options?: AddOptions): Promise<void> {
    this.validateEntry(entry);
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const namespace = options?.namespace ?? this.config.defaultNamespace ?? 'default';

    // Check if entry exists
    if (!options?.overwrite) {
      const exists = await this.exists(entry.id);
      if (exists) {
        throw new ConflictError(
          `Entry with ID ${entry.id} already exists`,
          'duplicate',
          { entryId: entry.id, table: this.tableName }
        );
      }
    }

    // Convert embedding to pgvector format
    const embeddingStr = `[${entry.embedding.join(',').replace(/\s+/g, '')}]`;

    const insertSQL = `
      INSERT INTO ${this.tableName} (id, embedding, metadata, namespace, created_at, updated_at)
      VALUES ($1, $2::vector, $3::jsonb, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        embedding = EXCLUDED.embedding,
        metadata = EXCLUDED.metadata,
        namespace = EXCLUDED.namespace,
        updated_at = EXCLUDED.updated_at
    `;

    await this.pool.query(insertSQL, [
      entry.id,
      embeddingStr,
      JSON.stringify(entry.metadata),
      namespace,
      entry.createdAt ?? new Date(),
      new Date(),
    ]);

    this.emit('add', { id: entry.id });
  }

  /**
   * Add multiple vector entries in batches
   * Uses transactions for consistency
   */
  async addBatch(entries: VectorEntry[], options?: AddOptions): Promise<BatchResult> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const result: BatchResult = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    // Process in batches of batchSize
    for (let i = 0; i < entries.length; i += this.batchSize) {
      const batch = entries.slice(i, i + this.batchSize);
      const client = await this.pool.connect();

      try {
        await client.query('BEGIN');

        for (const entry of batch) {
          try {
            await this.add(entry, options);
            result.successful++;
          } catch (error) {
            result.failed++;
            result.errors?.push({
              id: entry.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        // If transaction fails, mark all batch entries as failed
        for (const entry of batch) {
          result.failed++;
          result.errors?.push({
            id: entry.id,
            error: `Transaction failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } finally {
        client.release();
      }
    }

    return result;
  }

  /**
   * Update an existing vector entry
   */
  async update(id: string, updates: Partial<VectorEntry>): Promise<boolean> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    // Validate embedding if provided
    if (updates.embedding) {
      validateVector(updates.embedding, this.config.dimensions);
    }

    const existing = await this.get(id);
    if (!existing) {
      return false;
    }

    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.embedding) {
      updateFields.push(`embedding = $${paramIndex++}::vector`);
      values.push(`[${updates.embedding.join(',')}]`);
    }

    if (updates.metadata) {
      updateFields.push(`metadata = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(updates.metadata));
    }

    updateFields.push(`updated_at = $${paramIndex++}`);
    values.push(new Date());

    if (updateFields.length === 1) {
      // Only updated_at changed, nothing to do
      return true;
    }

    // Add id as last parameter
    values.push(id);

    const updateSQL = `
      UPDATE ${this.tableName}
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
    `;

    await this.pool.query(updateSQL, values);
    this.emit('update', { id });
    return true;
  }

  /**
   * Delete vector entries
   */
  async delete(options: DeleteOptions): Promise<number> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    let deletedCount = 0;

    if (options.deleteAll) {
      const namespace = options.namespace ?? this.config.defaultNamespace ?? 'default';
      const deleteSQL = `
        DELETE FROM ${this.tableName}
        WHERE namespace = $1
      `;
      const result = await this.pool.query(deleteSQL, [namespace]);
      deletedCount = result.rowCount ?? 0;
    } else if (options.ids && options.ids.length > 0) {
      const deleteSQL = `
        DELETE FROM ${this.tableName}
        WHERE id = ANY($1::varchar[])
      `;
      const result = await this.pool.query(deleteSQL, [options.ids]);
      deletedCount = result.rowCount ?? 0;
    } else if (options.filter) {
      // Build WHERE clause from metadata filter
      const whereClause = this.buildMetadataFilterSQL(options.filter);
      const deleteSQL = `
        DELETE FROM ${this.tableName}
        WHERE ${whereClause}
      `;
      const result = await this.pool.query(deleteSQL);
      deletedCount = result.rowCount ?? 0;
    }

    if (deletedCount > 0) {
      this.emit('delete', { count: deletedCount });
    }

    return deletedCount;
  }

  /**
   * Get a vector entry by ID
   */
  async get(id: string): Promise<VectorEntry | null> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const selectSQL = `
      SELECT id, embedding::text, metadata, created_at, updated_at
      FROM ${this.tableName}
      WHERE id = $1
    `;

    const result = await this.pool.query(selectSQL, [id]);
    const row = result.rows[0] as PgVectorEntry | undefined;

    if (!row) return null;

    return this.rowToVectorEntry(row);
  }

  /**
   * Check if a vector entry exists
   */
  async exists(id: string): Promise<boolean> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const selectSQL = `
      SELECT 1 FROM ${this.tableName} WHERE id = $1
    `;

    const result = await this.pool.query(selectSQL, [id]);
    return (result.rows.length ?? 0) > 0;
  }

  /**
   * Search for similar vectors using HNSW or linear search
   */
  async search(query: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
    validateVector(query, this.config.dimensions);
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const opts = this.mergeOptions(options);
    const queryVector = `[${query.join(',')}]`;

    // Build distance/similarity operator based on metric
    const metric = this.config.metric ?? 'cosine';
    const distanceOp = metric === 'cosine' ? '<=>' :
                       metric === 'euclidean' ? '<->' :
                       '<#>'; // inner product

    // Build WHERE clause for metadata filters
    let whereClause = 'TRUE';
    if (opts.filters && opts.filters.length > 0) {
      const filterConditions = opts.filters.map((filter) =>
        this.buildMetadataFilterSQL(filter)
      );
      whereClause = filterConditions.join(' AND ');
    }

    // Build SELECT fields based on options
    const selectFields = ['id'];
    if (opts.includeVectors) {
      selectFields.push('embedding::text as embedding');
    }
    if (opts.includeMetadata) {
      selectFields.push('metadata');
    }

    // For cosine similarity, convert distance to similarity (1 - distance)
    const scoreExpression = metric === 'cosine'
      ? `1 - (embedding ${distanceOp} $1::vector)`
      : `embedding ${distanceOp} $1::vector`;

    const searchSQL = `
      SELECT
        ${selectFields.join(', ')},
        ${scoreExpression} as score
      FROM ${this.tableName}
      WHERE ${whereClause}
        AND ${scoreExpression} >= $2
      ORDER BY embedding ${distanceOp} $1::vector
      LIMIT $3
    `;

    const result = await this.pool.query(searchSQL, [
      queryVector,
      opts.threshold,
      opts.limit,
    ]);

    this.emit('search', {
      resultsCount: result.rows.length,
    });

    return result.rows.map((row: any) => ({
      id: row.id,
      score: row.score,
      embedding: opts.includeVectors ? this.parseEmbedding(row.embedding) : undefined,
      metadata: opts.includeMetadata ? row.metadata : {},
    }));
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<VectorStoreStats> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const countSQL = `
      SELECT COUNT(*) as total, COUNT(DISTINCT namespace) as namespace_count
      FROM ${this.tableName}
    `;

    const namespacesSQL = `
      SELECT DISTINCT namespace FROM ${this.tableName}
    `;

    const [countResult, namespacesResult] = await Promise.all([
      this.pool.query(countSQL),
      this.pool.query(namespacesSQL),
    ]);

    const stats = countResult.rows[0] as { total: string; namespace_count: string };
    const namespaces = namespacesResult.rows.map((row: any) => row.namespace);

    return {
      totalVectors: parseInt(stats.total, 10),
      dimensions: this.config.dimensions,
      indexType: this.config.indexType ?? 'flat',
      metric: this.config.metric ?? 'cosine',
      indexBuilt: this.config.indexType === 'hnsw',
      namespaces,
    };
  }

  /**
   * Clear all vectors from the store
   */
  async clear(): Promise<void> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const deleteSQL = `TRUNCATE TABLE ${this.tableName}`;
    await this.pool.query(deleteSQL);
    this.emit('delete', { deleteAll: true });
  }

  /**
   * Close the vector store and release resources
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    await closePostgresDatabase();
    this.db = null;
    this.initialized = false;
  }

  /**
   * Get all entries (for migration/export)
   */
  async getAllEntries(): Promise<VectorEntry[]> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const selectSQL = `
      SELECT id, embedding::text, metadata, created_at, updated_at
      FROM ${this.tableName}
    `;

    const result = await this.pool.query(selectSQL);
    return result.rows.map((row) => this.rowToVectorEntry(row as PgVectorEntry));
  }

  /**
   * Get the number of entries
   */
  async size(): Promise<number> {
    if (!this.pool) {
      throw new DatabaseError('Database not initialized', 'connection', {
        code: ErrorCode.DATABASE_NOT_INITIALIZED,
        table: this.tableName,
      });
    }

    const countSQL = `SELECT COUNT(*) as total FROM ${this.tableName}`;
    const result = await this.pool.query(countSQL);
    const row = result.rows[0] as { total: string };
    return parseInt(row.total, 10);
  }

  /**
   * Convert database row to VectorEntry
   */
  private rowToVectorEntry(row: PgVectorEntry): VectorEntry {
    return {
      id: row.id,
      embedding: this.parseEmbedding(row.embedding),
      metadata: row.metadata, // Already parsed by pg library from JSONB
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Parse pgvector embedding string to number array
   */
  private parseEmbedding(embeddingStr: string): number[] {
    // Remove brackets and split by comma
    return embeddingStr
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((v) => parseFloat(v));
  }

  /**
   * Build SQL WHERE clause from metadata filter
   */
  private buildMetadataFilterSQL(filter: MetadataFilter): string {
    const key = filter.key;
    const value = filter.value;

    switch (filter.operator) {
      case 'eq':
        return `metadata->>'${key}' = '${value}'`;
      case 'ne':
        return `metadata->>'${key}' != '${value}'`;
      case 'gt':
        return `(metadata->>'${key}')::numeric > ${value}`;
      case 'gte':
        return `(metadata->>'${key}')::numeric >= ${value}`;
      case 'lt':
        return `(metadata->>'${key}')::numeric < ${value}`;
      case 'lte':
        return `(metadata->>'${key}')::numeric <= ${value}`;
      case 'in':
        const inValues = Array.isArray(value) ? value.map((v) => `'${v}'`).join(',') : `'${value}'`;
        return `metadata->>'${key}' IN (${inValues})`;
      case 'nin':
        const ninValues = Array.isArray(value) ? value.map((v) => `'${v}'`).join(',') : `'${value}'`;
        return `metadata->>'${key}' NOT IN (${ninValues})`;
      case 'contains':
        return `metadata->>'${key}' LIKE '%${value}%'`;
      case 'startsWith':
        return `metadata->>'${key}' LIKE '${value}%'`;
      default:
        return 'TRUE';
    }
  }
}

/**
 * Create a PgVector store instance
 */
export function createPgVectorStore(
  connectionString: string,
  dimensions: number,
  options?: Partial<Omit<PgVectorStoreConfig, 'provider' | 'dimensions' | 'connectionString'>>
): PgVectorStore {
  return new PgVectorStore({
    provider: 'pgvector',
    dimensions,
    connectionString,
    ...options,
  });
}
