# Database Performance Benchmarks

**Last Updated**: 2026-02-02
**Related Tasks**: TASK-005 (HNSW Index), TASK-002 (PostgreSQL Schema)

## Overview

This document tracks database performance metrics for the Supermemory PostgreSQL implementation with pgvector and HNSW indexing.

## HNSW Index Configuration

### Index Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| **m** | 16 | Number of bi-directional links per node (production default) |
| **ef_construction** | 64 | Size of dynamic candidate list during index construction |
| **ef_search** | 100 | Size of dynamic candidate list during search (configurable) |
| **Distance Metric** | Cosine | `vector_cosine_ops` for cosine similarity |

### Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| Query Latency (10K vectors) | < 100ms | ⏳ Pending |
| Recall Accuracy | ~99% | ⏳ Pending |
| Index Build Time (10K vectors) | < 60s | ⏳ Pending |
| Memory Overhead | < 500MB for 100K vectors | ⏳ Pending |

## Benchmark Results

### Test Environment

**Pending initial deployment**

Configuration:
- PostgreSQL Version: 15+ (required)
- pgvector Version: 0.5.0+ (required)
- Hardware: TBD
- Dataset Size: TBD
- Vector Dimensions: 1536 (text-embedding-3-small)

### Query Performance

**Test**: Top-10 nearest neighbor search

| Dataset Size | Avg Query Time | p50 | p95 | p99 | Status |
|--------------|----------------|-----|-----|-----|--------|
| 1K vectors | TBD | TBD | TBD | TBD | ⏳ |
| 10K vectors | TBD | TBD | TBD | TBD | ⏳ |
| 100K vectors | TBD | TBD | TBD | TBD | ⏳ |
| 1M vectors | TBD | TBD | TBD | TBD | ⏳ |

### Recall Accuracy

**Test**: Percentage of true nearest neighbors found (k=10)

| ef_search | Recall | Avg Query Time | Trade-off |
|-----------|--------|----------------|-----------|
| 40 (fast) | ~95% | TBD | Fast, lower accuracy |
| 100 (balanced) | ~99% | TBD | **Recommended** |
| 200 (accurate) | ~99.5%+ | TBD | Highest accuracy, slower |

### Index Build Performance

| Dataset Size | Build Time | Memory Usage | Status |
|--------------|------------|--------------|--------|
| 1K vectors | TBD | TBD | ⏳ |
| 10K vectors | TBD | TBD | ⏳ |
| 100K vectors | TBD | TBD | ⏳ |
| 1M vectors | TBD | TBD | ⏳ |

## Performance Tuning

### Search Quality Adjustment

Use the helper function to adjust search quality dynamically:

```sql
-- Fast mode (~95% recall)
SELECT set_hnsw_search_quality('fast');

-- Balanced mode (~99% recall) - Recommended
SELECT set_hnsw_search_quality('balanced');

-- Accurate mode (~99.5%+ recall)
SELECT set_hnsw_search_quality('accurate');
```

### Session-Level Tuning

For specific queries requiring different performance characteristics:

```sql
-- Temporarily set higher ef_search for critical queries
SET LOCAL hnsw.ef_search = 200;

-- Run critical query
SELECT id, 1 - (embedding <=> $1::vector) as similarity
FROM memory_embeddings
ORDER BY embedding <=> $1::vector
LIMIT 10;

-- Setting reverts after transaction
```

### Index Maintenance

```sql
-- Update statistics after bulk inserts
ANALYZE memory_embeddings;

-- Rebuild index if performance degrades (rare)
REINDEX INDEX CONCURRENTLY idx_memory_embeddings_hnsw;
```

## Query Optimization

### Optimal Query Pattern

```sql
-- Best performance: Use index scan with cosine distance
EXPLAIN ANALYZE
SELECT
    id,
    1 - (embedding <=> $1::vector) as similarity,
    memory_id,
    model
FROM memory_embeddings
WHERE 1 - (embedding <=> $1::vector) > 0.7  -- Optional threshold
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

**Expected Plan**:
```
Limit  (cost=X..Y rows=10)
  ->  Index Scan using idx_memory_embeddings_hnsw on memory_embeddings
        Order By: (embedding <=> $1)
        Filter: ((1 - (embedding <=> $1)) > 0.7)
```

### Anti-Patterns to Avoid

❌ **Don't use dot product for normalized vectors** (use cosine)
```sql
-- Bad: Forces sequential scan
SELECT id FROM memory_embeddings
ORDER BY embedding <#> $1::vector;
```

❌ **Don't use complex expressions in ORDER BY**
```sql
-- Bad: May not use index
SELECT id FROM memory_embeddings
ORDER BY (1 - (embedding <=> $1::vector)) DESC;

-- Good: Simple distance operator
SELECT id FROM memory_embeddings
ORDER BY embedding <=> $1::vector;
```

❌ **Don't combine with OR conditions**
```sql
-- Bad: May prevent index usage
SELECT id FROM memory_embeddings
WHERE memory_id = 'xyz' OR embedding <=> $1::vector < 0.3;
```

## Monitoring Queries

### Index Usage Statistics

```sql
-- Check index usage
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE indexrelname = 'idx_memory_embeddings_hnsw';
```

### Query Performance Analysis

```sql
-- Find slow vector queries in pg_stat_statements
SELECT
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    stddev_exec_time,
    min_exec_time,
    max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%memory_embeddings%'
  AND query LIKE '%<=>%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Index Size and Health

```sql
-- Check index size
SELECT
    pg_size_pretty(pg_relation_size('idx_memory_embeddings_hnsw')) as index_size,
    pg_size_pretty(pg_relation_size('memory_embeddings')) as table_size,
    (pg_relation_size('idx_memory_embeddings_hnsw')::FLOAT /
     NULLIF(pg_relation_size('memory_embeddings'), 0)) * 100 as overhead_pct;
```

## Running Benchmarks

### Automated Test Suite

Run the comprehensive test suite:

```bash
# Run structural tests (no data required)
psql $DATABASE_URL -f scripts/migrations/test_hnsw_index.sql

# Run performance tests (requires data)
psql $DATABASE_URL -c "SELECT * FROM run_hnsw_performance_test(100);"

# Run recall accuracy tests
psql $DATABASE_URL -c "SELECT * FROM test_hnsw_recall_accuracy(10);"
```

### Manual Performance Test

```sql
-- Create test function
CREATE OR REPLACE FUNCTION benchmark_vector_search(iterations INT DEFAULT 100)
RETURNS TABLE (
    avg_time_ms NUMERIC,
    min_time_ms NUMERIC,
    max_time_ms NUMERIC,
    p50_time_ms NUMERIC,
    p95_time_ms NUMERIC,
    p99_time_ms NUMERIC
) AS $$
DECLARE
    times NUMERIC[];
    i INTEGER;
    start_time TIMESTAMPTZ;
    end_time TIMESTAMPTZ;
    sample_vector vector(1536);
BEGIN
    FOR i IN 1..iterations LOOP
        -- Generate random vector
        sample_vector := (
            SELECT array_agg(random()::REAL)::vector
            FROM generate_series(1, 1536)
        );

        -- Measure query time
        start_time := clock_timestamp();

        PERFORM id
        FROM memory_embeddings
        ORDER BY embedding <=> sample_vector
        LIMIT 10;

        end_time := clock_timestamp();

        times := array_append(times,
            EXTRACT(MILLISECONDS FROM (end_time - start_time)));
    END LOOP;

    -- Calculate statistics
    RETURN QUERY
    SELECT
        (SELECT AVG(t) FROM unnest(times) t) as avg_time_ms,
        (SELECT MIN(t) FROM unnest(times) t) as min_time_ms,
        (SELECT MAX(t) FROM unnest(times) t) as max_time_ms,
        (SELECT percentile_cont(0.50) WITHIN GROUP (ORDER BY t) FROM unnest(times) t) as p50_time_ms,
        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY t) FROM unnest(times) t) as p95_time_ms,
        (SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY t) FROM unnest(times) t) as p99_time_ms;
END;
$$ LANGUAGE plpgsql;

-- Run benchmark
SELECT * FROM benchmark_vector_search(100);
```

## Troubleshooting

### Slow Queries

1. **Check if index is being used**:
   ```sql
   EXPLAIN ANALYZE
   SELECT id FROM memory_embeddings
   ORDER BY embedding <=> $1::vector
   LIMIT 10;
   ```

   Look for `Index Scan using idx_memory_embeddings_hnsw`

2. **Increase ef_search** if recall is low:
   ```sql
   SET hnsw.ef_search = 200;
   ```

3. **Update statistics** if data distribution changed:
   ```sql
   ANALYZE memory_embeddings;
   ```

### Index Not Being Used

1. **Check index exists and is valid**:
   ```sql
   SELECT indexname, indexdef
   FROM pg_indexes
   WHERE tablename = 'memory_embeddings';
   ```

2. **Ensure vector dimensions match**:
   ```sql
   SELECT DISTINCT vector_dims(embedding)
   FROM memory_embeddings;
   ```

3. **Check for expression mismatches**:
   - Index uses `<=>` (cosine distance)
   - Query must also use `<=>` operator

## References

- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [HNSW Algorithm Paper](https://arxiv.org/abs/1603.09320)
- [PostgreSQL Index Tuning](https://www.postgresql.org/docs/current/indexes.html)
- BACKLOG.md TASK-005: HNSW Index Implementation

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-02 | 1.0.0 | Initial benchmark documentation created |

---

**Note**: This document will be updated with actual benchmark results after PostgreSQL deployment and data population.
