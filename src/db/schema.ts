import { sqliteTable, text, integer, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// Users table
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    name: text('name'),
    apiKey: text('api_key').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email), uniqueIndex('users_api_key_idx').on(table.apiKey)]
)

// Spaces (collections/folders for organizing memories)
export const spaces = sqliteTable(
  'spaces',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('spaces_user_id_idx').on(table.userId)]
)

// Content types enum values
export const contentTypes = ['note', 'url', 'pdf', 'image', 'tweet', 'document'] as const
export type ContentType = (typeof contentTypes)[number]

// Memories table (main content storage)
export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spaceId: text('space_id').references(() => spaces.id, { onDelete: 'set null' }),
    contentType: text('content_type', { enum: contentTypes }).notNull(),
    title: text('title'),
    content: text('content').notNull(),
    rawContent: text('raw_content'), // Original content before processing
    sourceUrl: text('source_url'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('memories_user_id_idx').on(table.userId),
    index('memories_space_id_idx').on(table.spaceId),
    index('memories_content_type_idx').on(table.contentType),
    index('memories_created_at_idx').on(table.createdAt),
  ]
)

// Chunks table (for RAG - split content into searchable chunks)
export const chunks = sqliteTable(
  'chunks',
  {
    id: text('id').primaryKey(),
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    tokenCount: integer('token_count'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('chunks_memory_id_idx').on(table.memoryId), index('chunks_chunk_index_idx').on(table.chunkIndex)]
)

// Embeddings table (vector storage for semantic search)
export const embeddings = sqliteTable(
  'embeddings',
  {
    id: text('id').primaryKey(),
    chunkId: text('chunk_id')
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    embedding: blob('embedding', { mode: 'buffer' }).notNull(), // Stored as binary for efficiency
    model: text('model').notNull(),
    dimensions: integer('dimensions').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [uniqueIndex('embeddings_chunk_id_idx').on(table.chunkId)]
)

// Tags table
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('tags_user_id_idx').on(table.userId),
    uniqueIndex('tags_user_name_idx').on(table.userId, table.name),
  ]
)

// Memory-Tags junction table
export const memoryTags = sqliteTable(
  'memory_tags',
  {
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('memory_tags_memory_id_idx').on(table.memoryId), index('memory_tags_tag_id_idx').on(table.tagId)]
)

// Search history for analytics and suggestions
export const searchHistory = sqliteTable(
  'search_history',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    resultCount: integer('result_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('search_history_user_id_idx').on(table.userId),
    index('search_history_created_at_idx').on(table.createdAt),
  ]
)

// API usage tracking
export const apiUsage = sqliteTable(
  'api_usage',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    method: text('method').notNull(),
    statusCode: integer('status_code').notNull(),
    responseTimeMs: integer('response_time_ms'),
    tokensUsed: integer('tokens_used'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('api_usage_user_id_idx').on(table.userId),
    index('api_usage_endpoint_idx').on(table.endpoint),
    index('api_usage_created_at_idx').on(table.createdAt),
  ]
)

// Type exports for use in application
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export type Space = typeof spaces.$inferSelect
export type NewSpace = typeof spaces.$inferInsert

export type Memory = typeof memories.$inferSelect
export type NewMemory = typeof memories.$inferInsert

export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert

export type Embedding = typeof embeddings.$inferSelect
export type NewEmbedding = typeof embeddings.$inferInsert

export type Tag = typeof tags.$inferSelect
export type NewTag = typeof tags.$inferInsert

export type MemoryTag = typeof memoryTags.$inferSelect
export type NewMemoryTag = typeof memoryTags.$inferInsert

export type SearchHistory = typeof searchHistory.$inferSelect
export type NewSearchHistory = typeof searchHistory.$inferInsert

export type ApiUsage = typeof apiUsage.$inferSelect
export type NewApiUsage = typeof apiUsage.$inferInsert
