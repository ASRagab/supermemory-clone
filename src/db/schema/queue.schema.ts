import { pgTable, uuid, varchar, text, integer, jsonb, timestamp, index, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { documents } from './documents.schema.js'

export const processingQueue = pgTable(
  'processing_queue',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    stage: varchar('stage', { length: 30 }).notNull().default('extraction'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    priority: integer('priority').default(0),
    error: text('error'),
    errorCode: varchar('error_code', { length: 50 }),
    attempts: integer('attempts').default(0),
    maxAttempts: integer('max_attempts').default(3),
    workerId: varchar('worker_id', { length: 100 }),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_processing_queue_document').on(table.documentId),
    index('idx_processing_queue_status')
      .on(table.status)
      .where(sql`${table.status} IN ('pending', 'retry')`),
    index('idx_processing_queue_stage').on(table.stage),
    index('idx_processing_queue_worker')
      .on(table.workerId)
      .where(sql`${table.workerId} IS NOT NULL`),
    index('idx_processing_queue_priority')
      .on(table.priority.desc(), table.scheduledAt.asc())
      .where(sql`${table.status} IN ('pending', 'retry')`),
    index('idx_processing_queue_stale')
      .on(table.startedAt)
      .where(sql`${table.status} = 'processing'`),
    index('idx_processing_queue_worker_select')
      .on(table.status, table.stage, table.priority, table.scheduledAt)
      .where(sql`${table.status} IN ('pending', 'retry')`),
    check(
      'processing_queue_stage_check',
      sql`${table.stage} IN ('extraction', 'embedding', 'deduplication', 'relationship', 'profile_update', 'cleanup')`
    ),
    check(
      'processing_queue_status_check',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'retry')`
    ),
    check('processing_queue_attempts_check', sql`${table.attempts} <= ${table.maxAttempts}`),
  ]
)

export type ProcessingQueue = typeof processingQueue.$inferSelect
export type NewProcessingQueue = typeof processingQueue.$inferInsert
