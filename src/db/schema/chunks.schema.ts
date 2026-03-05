import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { memories } from './memories.schema.js'

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    tokenCount: integer('token_count'),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_chunks_memory_id').on(table.memoryId),
    index('idx_chunks_chunk_index').on(table.memoryId, table.chunkIndex),
    index('idx_chunks_token_count').on(table.tokenCount),
    index('idx_chunks_metadata').using('gin', sql`${table.metadata} jsonb_path_ops`),
  ]
)

export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert
