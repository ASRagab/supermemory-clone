# PostgreSQL Migrations

Migration scripts for pgvector setup and HNSW indexing.

## Migration files

| File                                     | Description                                 | Dependencies |
| ---------------------------------------- | ------------------------------------------- | ------------ |
| `001_create_pgvector_extension.sql`      | Enable pgvector extension                   | None         |
| `002_create_memory_embeddings_table.sql` | Create embeddings table with vector support | 001          |
| `003_create_hnsw_index.sql`              | Create HNSW index for fast search           | 002          |
| `test_hnsw_index.sql`                    | Test suite for index and performance        | 001–003      |

## Quick start (recommended)

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/supermemory"
./scripts/migrations/run_migrations.sh

# Optional: validate HNSW index
psql $DATABASE_URL -f scripts/migrations/test_hnsw_index.sql
```

## Manual (psql)

```bash
psql $DATABASE_URL -f scripts/migrations/001_create_pgvector_extension.sql
psql $DATABASE_URL -f scripts/migrations/002_create_memory_embeddings_table.sql
psql $DATABASE_URL -f scripts/migrations/003_create_hnsw_index.sql
```

## Configuration

Required:

```bash
DATABASE_URL=postgresql://user:password@host:port/database
```

Optional (pooling):

```bash
DATABASE_POOL_MIN=10
DATABASE_POOL_MAX=100
DATABASE_IDLE_TIMEOUT=30000
```

## Rollback (common)

```sql
-- Drop the HNSW index
DROP INDEX IF EXISTS idx_memory_embeddings_hnsw;

-- Drop the embeddings table
DROP TABLE IF EXISTS memory_embeddings CASCADE;

-- Drop pgvector extension
DROP EXTENSION IF EXISTS vector CASCADE;
```

## Related documentation

- Database setup: [`docs/database-setup.md`](../../docs/database-setup.md)
- Performance tuning: [`docs/database-performance.md`](../../docs/database-performance.md)
- Database tests: [`tests/database/README.md`](../../tests/database/README.md)
