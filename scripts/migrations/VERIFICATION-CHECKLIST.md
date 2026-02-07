# TASK-005 Verification Checklist

This checklist should be used to verify the HNSW index implementation is working correctly.

## Pre-Deployment Verification

### ✅ File Structure

- [x] `scripts/migrations/001_create_pgvector_extension.sql` exists
- [x] `scripts/migrations/002_create_memory_embeddings_table.sql` exists
- [x] `scripts/migrations/003_create_hnsw_index.sql` exists
- [x] `scripts/migrations/test_hnsw_index.sql` exists
- [x] `scripts/migrations/run_migrations.sh` exists and is executable
- [x] `scripts/migrations/README.md` exists
- [x] `docs/database-performance.md` exists
- [x] `docs/database-quickstart.md` exists
- [x] `docs/TASK-005-IMPLEMENTATION-SUMMARY.md` exists

### ✅ Docker Configuration

- [x] `docker-compose.yml` has PostgreSQL service with pgvector
- [x] PostgreSQL service mounts `/migrations` directory
- [x] PostgreSQL service has health check configured
- [x] Volume persistence configured for `postgres_data`

### ✅ SQL Syntax

```bash
# Verify SQL files have no syntax errors (dry run)
docker compose --profile postgres up -d postgres
docker compose exec postgres psql -U supermemory -d supermemory --dry-run -f /migrations/001_create_pgvector_extension.sql
docker compose exec postgres psql -U supermemory -d supermemory --dry-run -f /migrations/002_create_memory_embeddings_table.sql
docker compose exec postgres psql -U supermemory -d supermemory --dry-run -f /migrations/003_create_hnsw_index.sql
```

## Deployment Verification

### Step 1: Start PostgreSQL

```bash
docker compose --profile postgres up -d postgres
docker compose ps postgres
# Expected: Status "Up (healthy)"
```

- [ ] PostgreSQL container started successfully
- [ ] Health check passing (status: healthy)
- [ ] Container logs show no errors

### Step 2: Run Migrations

```bash
docker compose exec postgres bash -c "cd /migrations && ./run_migrations.sh"
# Or manually:
# docker compose exec postgres psql -U supermemory -d supermemory -f /migrations/001_create_pgvector_extension.sql
# docker compose exec postgres psql -U supermemory -d supermemory -f /migrations/002_create_memory_embeddings_table.sql
# docker compose exec postgres psql -U supermemory -d supermemory -f /migrations/003_create_hnsw_index.sql
```

- [ ] Migration 001 (pgvector) completed successfully
- [ ] Migration 002 (memory_embeddings table) completed successfully
- [ ] Migration 003 (HNSW index) completed successfully
- [ ] No errors in output

### Step 3: Verify pgvector Extension

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

Expected output:
```
 extname | extowner | extnamespace | extrelocatable | extversion
---------+----------+--------------+----------------+------------
 vector  |      ... |          ... | t              | 0.5.1
```

- [ ] Extension exists
- [ ] Version is 0.5.0 or higher

### Step 4: Verify memory_embeddings Table

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "\d memory_embeddings"
```

Expected columns:
- [ ] `id` (uuid, primary key)
- [ ] `chunk_id` (uuid, foreign key)
- [ ] `memory_id` (uuid, foreign key)
- [ ] `embedding` (vector(1536))
- [ ] `model` (varchar)
- [ ] `dimensions` (integer)
- [ ] `created_at` (timestamptz)
- [ ] `updated_at` (timestamptz)

### Step 5: Verify HNSW Index

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'idx_memory_embeddings_hnsw';"
```

Expected output should include:
```
CREATE INDEX idx_memory_embeddings_hnsw ON public.memory_embeddings 
  USING hnsw (embedding vector_cosine_ops) 
  WITH (m='16', ef_construction='64')
```

- [ ] Index exists
- [ ] Uses HNSW access method
- [ ] Parameters: m=16, ef_construction=64
- [ ] Operator class: vector_cosine_ops

### Step 6: Verify Helper Functions

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "\df set_hnsw_search_quality"
docker compose exec postgres psql -U supermemory -d supermemory -c "\df validate_hnsw_performance"
docker compose exec postgres psql -U supermemory -d supermemory -c "\df update_updated_at_column"
```

- [ ] `set_hnsw_search_quality(TEXT)` exists
- [ ] `validate_hnsw_performance(vector, INTEGER)` exists
- [ ] `update_updated_at_column()` exists

### Step 7: Verify Triggers

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'memory_embeddings';"
```

Expected:
- [ ] `trg_memory_embeddings_updated_at` trigger exists

### Step 8: Verify ef_search Setting

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "SHOW hnsw.ef_search;"
```

Expected:
- [ ] Returns "100" (or configured value)

### Step 9: Run Test Suite

```bash
docker compose exec postgres psql -U supermemory -d supermemory -f /migrations/test_hnsw_index.sql
```

Expected test results:
- [ ] Test 1 PASSED: HNSW index exists
- [ ] Test 2 PASSED: Index uses HNSW access method
- [ ] Test 3 PASSED: HNSW parameters configured
- [ ] Test 4 PASSED or WARNING: Query uses index scan (may warn without data)

### Step 10: Test Vector Operations

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT '[1,2,3]'::vector <=> '[4,5,6]'::vector AS cosine_distance;"
```

Expected:
- [ ] Returns a numeric value (e.g., 0.025368...)
- [ ] No errors

### Step 11: Test Search Quality Function

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT set_hnsw_search_quality('balanced');"
```

Expected output:
```
HNSW search quality set to BALANCED (ef_search=100, ~99% recall)
```

- [ ] Returns success message
- [ ] No errors

### Step 12: Insert Test Data (Optional)

```bash
# Generate 100 test embeddings
docker compose exec postgres psql -U supermemory -d supermemory << 'SQL'
DO $$
DECLARE
    i INTEGER;
    test_embedding vector(1536);
BEGIN
    FOR i IN 1..100 LOOP
        -- Generate random embedding
        test_embedding := (
            SELECT array_agg(random()::REAL)::vector
            FROM generate_series(1, 1536)
        );

        -- Insert test data
        INSERT INTO memory_embeddings (
            id, chunk_id, memory_id, embedding, model, dimensions
        ) VALUES (
            gen_random_uuid(),
            gen_random_uuid(),
            gen_random_uuid(),
            test_embedding,
            'text-embedding-3-small',
            1536
        );
    END LOOP;

    RAISE NOTICE 'Inserted 100 test embeddings';
END $$;
SQL
```

- [ ] Test data inserted successfully
- [ ] No constraint violations

### Step 13: Test Query Performance (With Data)

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT * FROM run_hnsw_performance_test(10);"
```

Expected (with test data):
- [ ] All queries complete successfully
- [ ] Most queries have status 'PASS' (< 100ms)
- [ ] Average execution time is reasonable

### Step 14: Test Recall Accuracy (With Data)

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT * FROM test_hnsw_recall_accuracy(5);"
```

Expected (with test data):
- [ ] Recall percentage ≥ 95%
- [ ] Most samples have status 'PASS' (≥ 99%)

### Step 15: Verify Query Plan Uses Index

```bash
docker compose exec postgres psql -U supermemory -d supermemory << 'SQL'
EXPLAIN ANALYZE
SELECT id, 1 - (embedding <=> (
    SELECT array_agg(random()::REAL)::vector
    FROM generate_series(1, 1536)
)) as similarity
FROM memory_embeddings
ORDER BY embedding <=> (
    SELECT array_agg(random()::REAL)::vector
    FROM generate_series(1, 1536)
)
LIMIT 10;
SQL
```

Expected plan:
- [ ] Shows "Index Scan using idx_memory_embeddings_hnsw"
- [ ] No sequential scan (unless no data)

## Post-Deployment Verification

### Monitor Index Usage

```bash
docker compose exec postgres psql -U supermemory -d supermemory << 'SQL'
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE indexrelname = 'idx_memory_embeddings_hnsw';
SQL
```

- [ ] Index is being scanned (idx_scan > 0 after queries)

### Check Index Size

```bash
docker compose exec postgres psql -U supermemory -d supermemory << 'SQL'
SELECT
    pg_size_pretty(pg_relation_size('idx_memory_embeddings_hnsw')) as index_size,
    pg_size_pretty(pg_relation_size('memory_embeddings')) as table_size;
SQL
```

- [ ] Index size is reasonable (typically 1.2-2x table size for HNSW)

### Check Table Statistics

```bash
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT COUNT(*) FROM memory_embeddings;"
```

- [ ] Row count matches expected

## Documentation Verification

### README Accuracy

- [ ] Migration README.md has accurate instructions
- [ ] All commands in README work as documented
- [ ] Troubleshooting section addresses common issues

### Performance Documentation

- [ ] database-performance.md has correct benchmarking procedures
- [ ] Optimization tips are accurate
- [ ] Monitoring queries work correctly

### Quick Start Guide

- [ ] database-quickstart.md instructions are accurate
- [ ] Docker commands work correctly
- [ ] Local PostgreSQL setup instructions are complete

## Rollback Verification (Optional)

### Test Rollback Procedure

```bash
# Rollback HNSW index
docker compose exec postgres psql -U supermemory -d supermemory -c "DROP INDEX IF EXISTS idx_memory_embeddings_hnsw;"

# Verify index is gone
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT indexname FROM pg_indexes WHERE indexname = 'idx_memory_embeddings_hnsw';"
# Expected: No rows

# Re-run migration 003 to restore
docker compose exec postgres psql -U supermemory -d supermemory -f /migrations/003_create_hnsw_index.sql
```

- [ ] Rollback executes successfully
- [ ] Re-migration restores index correctly

## Final Checklist

### Functionality
- [ ] All migrations execute successfully
- [ ] All indexes created correctly
- [ ] All helper functions work
- [ ] All triggers fire correctly
- [ ] Vector operations work
- [ ] HNSW index is used in queries

### Performance
- [ ] Query latency meets targets (< 100ms for 10K vectors)
- [ ] Recall accuracy meets targets (~99%)
- [ ] Index size is reasonable

### Documentation
- [ ] All documentation is accurate
- [ ] All examples work
- [ ] Troubleshooting guide is helpful

### Production Readiness
- [ ] Docker Compose setup works
- [ ] Migration runner is robust
- [ ] Monitoring queries available
- [ ] Rollback procedures tested

## Notes

Use this space to record any issues or observations during verification:

```
Date: _______________
Tester: _____________

Issues Found:
- 

Resolution:
- 

Additional Notes:
- 

```

## Sign-off

- [ ] All critical tests pass
- [ ] Documentation is complete and accurate
- [ ] Ready for production use (with proper data validation)

**Verified by**: _______________
**Date**: _______________
**Status**: ☐ Approved ☐ Needs Revision ☐ Blocked
