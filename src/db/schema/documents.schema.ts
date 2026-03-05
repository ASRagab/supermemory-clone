import { pgTable, uuid, varchar, text, jsonb, timestamp, index, check, integer } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const documents = pgTable(
  'documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    customId: varchar('custom_id', { length: 255 }),
    content: text('content').notNull(),
    contentType: varchar('content_type', { length: 50 }).notNull().default('text/plain'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    containerTag: varchar('container_tag', { length: 255 }).notNull(),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    contentHash: varchar('content_hash', { length: 64 })
      .generatedAlwaysAs(sql`encode(sha256(content::bytea), 'hex')`)
      .notNull(),
    wordCount: integer('word_count')
      .generatedAlwaysAs(sql`array_length(regexp_split_to_array(content, '\\s+'), 1)`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_documents_container_tag').on(table.containerTag),
    index('idx_documents_status')
      .on(table.status)
      .where(sql`${table.status} != 'processed'`),
    index('idx_documents_custom_id')
      .on(table.customId)
      .where(sql`${table.customId} IS NOT NULL`),
    index('idx_documents_content_hash').on(table.contentHash),
    index('idx_documents_created_at').on(table.createdAt.desc()),
    index('idx_documents_metadata').using('gin', sql`${table.metadata} jsonb_path_ops`),
    index('idx_documents_container_status').on(table.containerTag, table.status, table.createdAt),
    check(
      'documents_status_check',
      sql`${table.status} IN ('pending', 'processing', 'processed', 'failed', 'archived')`
    ),
    check(
      'documents_content_type_check',
      sql`${table.contentType} IN ('text/plain', 'text/markdown', 'text/html', 'application/pdf', 'application/json', 'image/png', 'image/jpeg', 'audio/mp3', 'video/mp4')`
    ),
  ]
)

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
