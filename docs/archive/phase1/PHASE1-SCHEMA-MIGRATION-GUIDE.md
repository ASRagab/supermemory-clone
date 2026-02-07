# Phase 1 PostgreSQL Schema Migration Guide

## CRITICAL: Schema Import Changes

### ❌ OLD (SQLite - DO NOT USE)
```typescript
import { schema } from '../db/schema';
const { documents, memories, memoryEmbeddings, processingQueue } = schema;
```

### ✅ NEW (PostgreSQL - REQUIRED)
```typescript
// Import from modular schema files with .js extensions (ESM requirement)
import { documents } from '../db/schema/documents.schema.js';
import { memories } from '../db/schema/memories.schema.js';
import { memoryEmbeddings } from '../db/schema/embeddings.schema.js';
import { processingQueue } from '../db/schema/queue.schema.js';
import { memoryRelationships } from '../db/schema/relationships.schema.js';
import { containers } from '../db/schema/containers.schema.js';
import { profiles } from '../db/schema/profiles.schema.js';
```

## Schema Module Structure

```
src/db/schema/
├── index.ts                    # Barrel export (re-exports all schemas)
├── containers.schema.ts        # Container tags for multi-tenancy
├── documents.schema.ts         # Raw document storage
├── memories.schema.ts          # Extracted knowledge with versioning
├── embeddings.schema.ts        # Vector embeddings (pgvector)
├── relationships.schema.ts     # Knowledge graph edges
├── profiles.schema.ts          # User profile aggregation
└── queue.schema.ts             # Async job queue (BullMQ integration)
```

## Database Connection

### ❌ OLD
```typescript
import { getDb } from '../db/index.js'; // Does NOT exist
const db = getDb();
```

### ✅ NEW
```typescript
import { db } from '../db/index.js';
// db is already initialized, just use it directly
await db.select().from(documents);
```

## BullMQ Connection

### ❌ WRONG
```typescript
import { Connection } from 'bullmq'; // Does NOT exist
```

### ✅ CORRECT
```typescript
import { Queue, Worker, QueueEvents } from 'bullmq';
import type { ConnectionOptions } from 'bullmq'; // Type only
import Redis from 'ioredis'; // For Redis connection

const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null
};

const queue = new Queue('extraction-queue', { connection });
```

## PostgreSQL Schema Changes from SQLite

### Documents Table
```typescript
// NEW fields in documents.schema.ts
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  content: text('content').notNull(),
  contentType: text('content_type', {
    enum: ['note', 'url', 'pdf', 'file', 'image', 'video', 'document']
  }).notNull(),
  containerTag: text('container_tag'),
  metadata: jsonb('metadata'),
  sourceUrl: text('source_url'),
  rawContent: text('raw_content'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  // Generated columns (PostgreSQL-specific)
  contentHash: text('content_hash').generatedAlwaysAs(
    sql`encode(sha256(content::bytea), 'hex')`
  ),
  wordCount: integer('word_count').generatedAlwaysAs(
    sql`array_length(regexp_split_to_array(content, '\\s+'), 1)`
  )
});
```

### Memories Table
```typescript
// NEW fields in memories.schema.ts
export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  contentType: text('content_type', {
    enum: ['fact', 'concept', 'entity', 'relationship', 'insight']
  }).notNull().default('fact'),
  containerTag: text('container_tag'),
  confidence: real('confidence').default(1.0),
  metadata: jsonb('metadata'),

  // Versioning system
  isLatest: boolean('is_latest').default(true).notNull(),
  supersedesId: uuid('supersedes_id').references((): any => memories.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});
```

### Memory Embeddings Table
```typescript
// embeddings.schema.ts
export const memoryEmbeddings = pgTable('memory_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  memoryId: uuid('memory_id').references(() => memories.id, { onDelete: 'cascade' }).notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  model: text('model').notNull().default('text-embedding-3-small'),
  namespace: text('namespace').default('default').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  // HNSW index for fast similarity search
  embeddingIdx: index('memory_embeddings_hnsw_idx')
    .using('hnsw', table.embedding.op('vector_cosine_ops'))
    .with({ m: 16, ef_construction: 64 })
}));
```

### Processing Queue Table
```typescript
// queue.schema.ts - Integrates with BullMQ
export const processingQueue = pgTable('processing_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: text('job_id').unique().notNull(), // BullMQ job ID
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  queueName: text('queue_name', {
    enum: ['extraction', 'chunking', 'embedding', 'indexing']
  }).notNull(),
  stage: text('stage', {
    enum: ['pending', 'processing', 'completed', 'failed', 'retry', 'dead']
  }).notNull().default('pending'),
  priority: integer('priority').default(5).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(3).notNull(),
  progress: integer('progress').default(0),
  error: jsonb('error'),
  result: jsonb('result'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at')
});
```

## Key Differences: SQLite vs PostgreSQL

| Feature | SQLite | PostgreSQL |
|---------|--------|------------|
| **UUID** | `text` | `uuid` with `.defaultRandom()` |
| **JSON** | `text` | `jsonb` (binary, indexed) |
| **Vector** | Not supported | `vector(dimensions)` with HNSW |
| **Generated columns** | Limited | Full support with `generatedAlwaysAs()` |
| **Enum types** | No native support | Native enum support |
| **Timestamps** | `integer` (unix) | `timestamp` with timezone |
| **Indexes** | B-tree only | B-tree, HNSW, GIN, GiST, etc. |

## Common Migration Patterns

### 1. Insert with returning
```typescript
// PostgreSQL style
const [doc] = await db.insert(documents)
  .values({
    userId: 'user-123',
    content: 'Some content',
    contentType: 'note'
  })
  .returning();
```

### 2. JSONB queries
```typescript
// Query JSONB metadata
const results = await db.select()
  .from(documents)
  .where(sql`metadata->>'key' = 'value'`);
```

### 3. Vector similarity search
```typescript
// Using pgvector cosine distance
const similar = await db.select({
  id: memoryEmbeddings.id,
  memoryId: memoryEmbeddings.memoryId,
  distance: sql<number>`1 - (${memoryEmbeddings.embedding} <=> ${embedding}::vector)`
})
.from(memoryEmbeddings)
.orderBy(sql`${memoryEmbeddings.embedding} <=> ${embedding}::vector`)
.limit(10);
```

## Testing Changes

All tests must use PostgreSQL connection:

```typescript
import { db } from '../db/index.js';
import { documents } from '../db/schema/documents.schema.js';

describe('Document Operations', () => {
  it('should insert document', async () => {
    const [doc] = await db.insert(documents)
      .values({
        userId: 'test-user',
        content: 'Test content',
        contentType: 'note'
      })
      .returning();

    expect(doc).toBeDefined();
    expect(doc.id).toBeDefined();
  });
});
```

## Quick Reference

**Import pattern for workers:**
```typescript
// src/workers/extraction.worker.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { db } from '../db/index.js';
import { documents } from '../db/schema/documents.schema.js';
import { processingQueue } from '../db/schema/queue.schema.js';
import { extractionService } from '../services/extraction/index.js';
import Redis from 'ioredis';

// Redis connection for BullMQ
const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null
};

// Create queue
export const extractionQueue = new Queue('extraction', { connection });

// Create worker
export const extractionWorker = new Worker(
  'extraction',
  async (job) => {
    // Implementation using db and schema imports
  },
  { connection, concurrency: 5 }
);
```

## Migration Checklist

- [ ] Replace all `import { schema } from '../db/schema'` with modular imports
- [ ] Add `.js` extensions to all schema imports (ESM requirement)
- [ ] Replace `getDb()` with direct `db` import
- [ ] Update BullMQ Connection imports (use `ioredis`)
- [ ] Update type definitions to match PostgreSQL schema
- [ ] Replace SQLite-specific code with PostgreSQL equivalents
- [ ] Update tests to use PostgreSQL connection
- [ ] Verify TypeScript compilation (`npm run typecheck`)
