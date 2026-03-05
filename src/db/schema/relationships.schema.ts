import { pgTable, uuid, varchar, decimal, boolean, jsonb, timestamp, index, check, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { memories } from './memories.schema.js'

export const memoryRelationships = pgTable(
  'memory_relationships',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sourceMemoryId: uuid('source_memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    targetMemoryId: uuid('target_memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    relationshipType: varchar('relationship_type', { length: 30 }).notNull(),
    weight: decimal('weight', { precision: 4, scale: 3 }).default('1.000'),
    bidirectional: boolean('bidirectional').default(false),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_rel_source').on(table.sourceMemoryId),
    index('idx_memory_rel_target').on(table.targetMemoryId),
    index('idx_memory_rel_type').on(table.relationshipType),
    index('idx_memory_rel_bidirectional')
      .on(table.sourceMemoryId, table.targetMemoryId)
      .where(sql`${table.bidirectional} = TRUE`),
    index('idx_memory_rel_graph').on(table.sourceMemoryId, table.targetMemoryId, table.relationshipType, table.weight),
    check(
      'memory_relationships_type_check',
      sql`${table.relationshipType} IN ('updates', 'extends', 'derives', 'contradicts', 'supports', 'relates', 'temporal', 'causal', 'part_of', 'similar')`
    ),
    check('memory_relationships_weight_check', sql`${table.weight} >= 0 AND ${table.weight} <= 1`),
    check('memory_relationships_no_self_loop', sql`${table.sourceMemoryId} != ${table.targetMemoryId}`),
    unique('memory_relationships_unique_edge').on(table.sourceMemoryId, table.targetMemoryId, table.relationshipType),
  ]
)

export type MemoryRelationship = typeof memoryRelationships.$inferSelect
export type NewMemoryRelationship = typeof memoryRelationships.$inferInsert
