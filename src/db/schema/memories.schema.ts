import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  decimal,
  jsonb,
  timestamp,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { documents } from './documents.schema.js'

export const memories = pgTable(
  'memories',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    memoryType: varchar('memory_type', { length: 20 }).notNull().default('fact'),
    isLatest: boolean('is_latest').notNull().default(true),
    similarityHash: varchar('similarity_hash', { length: 64 }).notNull(),
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => memories.id, {
      onDelete: 'set null',
    }),
    containerTag: varchar('container_tag', { length: 255 }).notNull(),
    confidenceScore: decimal('confidence_score', { precision: 4, scale: 3 }).default('1.000'),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memories_document_id')
      .on(table.documentId)
      .where(sql`${table.documentId} IS NOT NULL`),
    index('idx_memories_container_tag').on(table.containerTag),
    index('idx_memories_type').on(table.memoryType),
    index('idx_memories_is_latest')
      .on(table.isLatest)
      .where(sql`${table.isLatest} = TRUE`),
    index('idx_memories_similarity_hash').on(table.similarityHash),
    index('idx_memories_supersedes')
      .on(table.supersedesId)
      .where(sql`${table.supersedesId} IS NOT NULL`),
    index('idx_memories_metadata').using('gin', sql`${table.metadata} jsonb_path_ops`),
    index('idx_memories_created_at').on(table.createdAt.desc()),
    index('idx_memories_container_latest')
      .on(table.containerTag, table.isLatest, table.createdAt)
      .where(sql`${table.isLatest} = TRUE`),
    index('idx_memories_container_type_latest')
      .on(table.containerTag, table.memoryType, table.isLatest)
      .where(sql`${table.isLatest} = TRUE`),
    index('idx_memories_version_chain')
      .on(table.supersedesId, table.version)
      .where(sql`${table.supersedesId} IS NOT NULL`),
    check(
      'memories_type_check',
      sql`${table.memoryType} IN ('fact', 'preference', 'episode', 'belief', 'skill', 'context')`
    ),
    check('memories_confidence_check', sql`${table.confidenceScore} >= 0 AND ${table.confidenceScore} <= 1`),
  ]
)

export type Memory = typeof memories.$inferSelect
export type NewMemory = typeof memories.$inferInsert
