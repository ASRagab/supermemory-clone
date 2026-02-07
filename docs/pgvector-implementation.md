# PgVectorStore Implementation

## Overview

Production-ready PostgreSQL vector store implementation using the pgvector extension with HNSW indexing for fast approximate nearest neighbor search.

## Features

- **HNSW Indexing**: O(log n) search performance with configurable parameters
- **Connection Pooling**: Production-ready pool settings (min: 10, max: 100)
- **Batch Operations**: Optimized bulk inserts with transaction support (100 items per batch)
- **Metadata Filtering**: Advanced filtering with JSONB queries
- **Threshold Search**: Score-based result filtering
- **Migration Support**: Built-in utilities to migrate from InMemoryVectorStore

## Installation

```bash
npm install pg
```

Ensure PostgreSQL with pgvector extension is installed:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Usage

### Basic Setup

```typescript
import { createPgVectorStore } from './services/vectorstore';

const store = createPgVectorStore(
  'postgresql://user:password@localhost:5432/database',
  1536, // dimensions
  {
    tableName: 'vector_embeddings', // optional, default: 'vector_embeddings'
    batchSize: 100, // optional, default: 100
    hnswConfig: {
      M: 16, // max connections per node
      efConstruction: 64, // size of dynamic candidate list during construction
    },
  }
);

await store.initialize();
```

### Adding Vectors

```typescript
// Single insert
await store.add({
  id: 'doc-1',
  embedding: [0.1, 0.2, ...], // 1536-dimensional vector
  metadata: { title: 'My Document', category: 'research' },
});

// Batch insert (optimized with transactions)
const entries = [
  { id: 'doc-1', embedding: [...], metadata: {...} },
  { id: 'doc-2', embedding: [...], metadata: {...} },
  // ... up to 100 items per batch
];

const result = await store.addBatch(entries);
console.log(`Successful: ${result.successful}, Failed: ${result.failed}`);
```

### Searching

```typescript
// Basic similarity search
const queryEmbedding = [0.1, 0.2, ...];
const results = await store.search(queryEmbedding, {
  limit: 10,
  threshold: 0.7, // minimum similarity score
});

// Search with metadata filtering
const results = await store.search(queryEmbedding, {
  limit: 10,
  threshold: 0.7,
  filters: [
    { key: 'category', operator: 'eq', value: 'research' },
    { key: 'year', operator: 'gte', value: 2020 },
  ],
});

// Include vectors and metadata in results
const results = await store.search(queryEmbedding, {
  limit: 10,
  includeVectors: true,
  includeMetadata: true,
});
```

### Updating and Deleting

```typescript
// Update embedding
await store.update('doc-1', {
  embedding: newEmbedding,
});

// Update metadata
await store.update('doc-1', {
  metadata: { status: 'published' },
});

// Delete by IDs
await store.delete({ ids: ['doc-1', 'doc-2'] });

// Delete by metadata filter
await store.delete({
  filter: { key: 'category', operator: 'eq', value: 'draft' },
});

// Delete all in namespace
await store.delete({
  deleteAll: true,
  namespace: 'default',
});
```

## Migration from InMemoryVectorStore

```typescript
import {
  createInMemoryVectorStore,
  createPgVectorStore,
  migrateMemoryToPgVector,
  verifyMigration,
  createProgressReporter,
} from './services/vectorstore';

// Setup stores
const memoryStore = createInMemoryVectorStore(1536);
await memoryStore.initialize();

const pgStore = createPgVectorStore('postgresql://...', 1536);
await pgStore.initialize();

// Migrate with progress tracking
const result = await migrateMemoryToPgVector(memoryStore, pgStore, {
  batchSize: 100,
  onProgress: createProgressReporter((message) => {
    console.log(message);
  }),
});

console.log(`Migration complete: ${result.successful} successful, ${result.failed} failed`);

// Verify migration integrity
const verification = await verifyMigration(memoryStore, pgStore, 20);
if (verification.success) {
  console.log('Migration verified successfully!');
  console.log(`Source: ${verification.sourceCount}, Target: ${verification.targetCount}`);
  console.log(`Samples: ${verification.samplesMatch} matched, ${verification.samplesMismatch} mismatched`);
} else {
  console.error('Migration verification failed:');
  verification.issues.forEach((issue) => console.error(`- ${issue}`));
}
```

## Configuration

### Environment Variables

```bash
# Vector store configuration
VECTOR_STORE_PROVIDER=pgvector
VECTOR_DIMENSIONS=1536

# PostgreSQL connection
DATABASE_URL=postgresql://user:password@localhost:5432/database

# HNSW index parameters (optional)
PGVECTOR_HNSW_M=16
PGVECTOR_HNSW_EF_CONSTRUCTION=64
```

### HNSW Index Parameters

- **M** (default: 16): Maximum number of connections per node
  - Higher values = better recall, slower build time
  - Recommended: 12-48

- **efConstruction** (default: 64): Size of dynamic candidate list during construction
  - Higher values = better index quality, slower build time
  - Recommended: 64-512

- **efSearch** (runtime): Size of dynamic candidate list during search
  - Higher values = better recall, slower search
  - Not configurable in this implementation (uses PostgreSQL defaults)

## Database Schema

The PgVectorStore creates the following table structure:

```sql
CREATE TABLE vector_embeddings (
  id VARCHAR(255) PRIMARY KEY,
  embedding vector(1536) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  namespace VARCHAR(255) NOT NULL DEFAULT 'default',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- HNSW index for fast similarity search
CREATE INDEX vector_embeddings_hnsw_idx
  ON vector_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

## Performance Characteristics

| Operation | Time Complexity | Notes |
|-----------|----------------|-------|
| Insert (single) | O(log n) | With HNSW index |
| Insert (batch) | O(b log n) | b = batch size, uses transactions |
| Search | O(log n) | HNSW approximate search |
| Update | O(log n) | Reindexes vector |
| Delete | O(k) | k = number of items to delete |
| Get by ID | O(1) | Primary key lookup |

## Connection Pool Settings

The PostgreSQL connection pool is configured with production-ready settings:

- **min**: 10 connections (always available)
- **max**: 100 connections (scales with load)
- **idleTimeoutMillis**: 30000 (30 seconds)
- **connectionTimeoutMillis**: 2000 (2 seconds)

## Error Handling

The implementation includes comprehensive error handling:

```typescript
try {
  await store.add(entry);
} catch (error) {
  if (error.message.includes('already exists')) {
    // Handle duplicate ID
  } else if (error.message.includes('dimension mismatch')) {
    // Handle invalid vector dimensions
  } else {
    // Handle other errors
  }
}
```

## Testing

Run the comprehensive test suite:

```bash
# Set test database URL
export TEST_POSTGRES_URL="postgresql://postgres:postgres@localhost:5432/supermemory_test"

# Run tests
npm test tests/services/vectorstore/pgvector.test.ts
```

Test coverage includes:
- Initialization and HNSW index creation
- Single and batch insert operations
- Update operations (embedding and metadata)
- Delete operations (by ID, filter, namespace)
- Search with HNSW index
- Threshold filtering
- Metadata filtering
- Connection pool concurrency
- Migration utilities
- Verification utilities

## Best Practices

1. **Use batch operations** for inserting multiple vectors (100 items per batch is optimal)
2. **Enable HNSW indexing** for production deployments with >10k vectors
3. **Configure connection pool** based on your application's concurrency needs
4. **Use namespaces** to organize vectors by category or tenant
5. **Set appropriate thresholds** for search to balance recall and precision
6. **Monitor pool usage** and adjust min/max connections as needed
7. **Use metadata filters** to narrow search space before vector similarity
8. **Verify migrations** using the verification utility before switching stores

## Troubleshooting

### pgvector extension not found
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Slow search performance
- Check if HNSW index exists
- Increase `efSearch` parameter (requires reindexing)
- Consider reducing `threshold` to limit results

### Connection pool exhaustion
- Increase `max` connections in pool config
- Check for connection leaks (always call `close()`)
- Monitor active connections with PostgreSQL stats

### Migration failures
- Check disk space for large datasets
- Verify source and target dimensions match
- Use smaller batch sizes for memory-constrained environments
- Check error messages in `BatchResult.errors`

## Integration with Existing Code

The PgVectorStore follows the same interface as other vector stores:

```typescript
import { createVectorStore } from './services/vectorstore';

// Automatically selects PgVectorStore if available
const store = await createVectorStore({
  provider: 'pgvector',
  dimensions: 1536,
  connectionString: process.env.DATABASE_URL,
  hnswConfig: { M: 16, efConstruction: 64 },
});

await store.initialize();
```

## References

- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [HNSW Algorithm Paper](https://arxiv.org/abs/1603.09320)
- [PostgreSQL Connection Pooling](https://node-postgres.com/features/pooling)
- [TASK-004 Requirements](../BACKLOG.md#task-004)
