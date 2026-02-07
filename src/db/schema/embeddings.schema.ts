import { pgTable, uuid, varchar, boolean, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { vector } from 'drizzle-orm/pg-core';
import { memories } from './memories.schema.js';

export const memoryEmbeddings = pgTable(
  'memory_embeddings',
  {
    memoryId: uuid('memory_id')
      .primaryKey()
      .references(() => memories.id, { onDelete: 'cascade' }),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    model: varchar('model', { length: 100 }).notNull().default('text-embedding-3-small'),
    modelVersion: varchar('model_version', { length: 50 }),
    normalized: boolean('normalized').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // HNSW index for approximate nearest neighbor search with cosine similarity
    index('idx_memory_embeddings_hnsw')
      .using('hnsw', table.embedding.op('vector_cosine_ops'))
      .with({ m: 16, ef_construction: 64 }),
    index('idx_memory_embeddings_model').on(table.model),
    check(
      'memory_embeddings_model_check',
      sql`${table.model} IN ('text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002', 'voyage-large-2', 'voyage-code-2', 'cohere-embed-v3', 'bge-large-en-v1.5', 'custom')`
    ),
  ]
);

export type MemoryEmbedding = typeof memoryEmbeddings.$inferSelect;
export type NewMemoryEmbedding = typeof memoryEmbeddings.$inferInsert;
