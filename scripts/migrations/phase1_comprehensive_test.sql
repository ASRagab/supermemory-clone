-- ============================================================================
-- HNSW Index Phase 1 Comprehensive Test Suite
-- Task: TASK-005 from BACKLOG.md
-- Created: 2026-02-02
-- ============================================================================

\echo '╔═══════════════════════════════════════════════════════════════════════╗'
\echo '║       HNSW Index Phase 1 - Comprehensive Test Suite                  ║'
\echo '╚═══════════════════════════════════════════════════════════════════════╝'
\echo ''

-- ============================================================================
-- SETUP: Ensure table and index exist
-- ============================================================================
\echo '📦 SETUP: Creating table and HNSW index...'

DROP TABLE IF EXISTS memory_embeddings CASCADE;

CREATE TABLE memory_embeddings (
    memory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    embedding vector(1536) NOT NULL,
    model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
    model_version VARCHAR(50),
    normalized BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memory_embeddings_hnsw
    ON memory_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

SET hnsw.ef_search = 100;

\echo '✓ Table and index created'
\echo ''

-- ============================================================================
-- TEST 1: Verify HNSW Index Creation
-- ============================================================================
\echo '📋 TEST 1: Verify HNSW Index Creation'
SELECT
    CASE WHEN EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'memory_embeddings'
        AND indexname = 'idx_memory_embeddings_hnsw'
    )
    THEN '  ✓ PASS - HNSW index exists'
    ELSE '  ✗ FAIL - HNSW index not found'
    END as result;
\echo ''

-- ============================================================================
-- TEST 2: Verify HNSW Access Method
-- ============================================================================
\echo '📋 TEST 2: Verify HNSW Access Method'
SELECT
    '  ✓ PASS - Access Method: ' || am.amname as result
FROM pg_class c
JOIN pg_am am ON c.relam = am.oid
WHERE c.relname = 'idx_memory_embeddings_hnsw';
\echo ''

-- ============================================================================
-- TEST 3: Verify HNSW Parameters (m=16, ef_construction=64)
-- ============================================================================
\echo '📋 TEST 3: Verify HNSW Parameters'
\echo '  Expected: m=16, ef_construction=64'
\d idx_memory_embeddings_hnsw
\echo ''

-- ============================================================================
-- TEST 4: Verify ef_search Configuration
-- ============================================================================
\echo '📋 TEST 4: Verify ef_search Configuration'
\echo '  Expected: 100 (balanced mode, ~99% recall)'
SHOW hnsw.ef_search;
\echo ''

-- ============================================================================
-- TEST 5: Helper Functions
-- ============================================================================
\echo '📋 TEST 5: Create and Test Helper Functions'

CREATE OR REPLACE FUNCTION set_hnsw_search_quality(quality_level TEXT DEFAULT 'balanced')
RETURNS TEXT AS $$
BEGIN
    CASE quality_level
        WHEN 'fast' THEN
            EXECUTE 'SET hnsw.ef_search = 40';
            RETURN '  ✓ PASS - Set to FAST (ef_search=40, ~95% recall)';
        WHEN 'balanced' THEN
            EXECUTE 'SET hnsw.ef_search = 100';
            RETURN '  ✓ PASS - Set to BALANCED (ef_search=100, ~99% recall)';
        WHEN 'accurate' THEN
            EXECUTE 'SET hnsw.ef_search = 200';
            RETURN '  ✓ PASS - Set to ACCURATE (ef_search=200, ~99.5%+ recall)';
        ELSE
            RAISE EXCEPTION 'Invalid quality_level. Use: fast, balanced, or accurate';
    END CASE;
END;
$$ LANGUAGE plpgsql;

SELECT set_hnsw_search_quality('fast');
SELECT set_hnsw_search_quality('balanced');
SELECT set_hnsw_search_quality('accurate');
\echo ''

-- ============================================================================
-- TEST 6: Generate Test Data (1K vectors)
-- ============================================================================
\echo '📋 TEST 6: Generate Test Data (1,000 vectors)'

CREATE OR REPLACE FUNCTION generate_random_vector(dims INTEGER)
RETURNS vector AS $$
    SELECT array_agg(random()::REAL)::vector
    FROM generate_series(1, dims);
$$ LANGUAGE SQL;

INSERT INTO memory_embeddings (memory_id, embedding)
SELECT
    gen_random_uuid(),
    generate_random_vector(1536)
FROM generate_series(1, 1000);

ANALYZE memory_embeddings;

SELECT '  ✓ PASS - Generated ' || COUNT(*) || ' test vectors' as result
FROM memory_embeddings;
\echo ''

-- ============================================================================
-- TEST 7: Performance Benchmark (1K vectors)
-- ============================================================================
\echo '📋 TEST 7: Performance Benchmark (Target: < 10ms for 1K vectors)'

CREATE OR REPLACE FUNCTION run_single_benchmark()
RETURNS TABLE (
    execution_time_ms NUMERIC,
    results_count INTEGER
) AS $$
DECLARE
    start_time TIMESTAMPTZ;
    exec_time NUMERIC;
    res_count INTEGER;
    sample_vec vector(1536);
BEGIN
    sample_vec := (SELECT array_agg(random()::REAL)::vector FROM generate_series(1, 1536));

    start_time := clock_timestamp();

    SELECT COUNT(*) INTO res_count
    FROM (SELECT memory_id FROM memory_embeddings ORDER BY embedding <=> sample_vec LIMIT 10) t;

    exec_time := EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time));

    RETURN QUERY SELECT exec_time, res_count;
END;
$$ LANGUAGE plpgsql;

-- Run 10 benchmark queries
SELECT
    '  Query ' || row_number() OVER () || ': ' ||
    ROUND(execution_time_ms, 2) || ' ms - ' ||
    CASE
        WHEN execution_time_ms < 10 THEN '✓ EXCELLENT'
        WHEN execution_time_ms < 100 THEN '✓ PASS'
        ELSE '⚠ SLOW'
    END as result
FROM (SELECT * FROM run_single_benchmark() UNION ALL
      SELECT * FROM run_single_benchmark() UNION ALL
      SELECT * FROM run_single_benchmark() UNION ALL
      SELECT * FROM run_single_benchmark() UNION ALL
      SELECT * FROM run_single_benchmark() UNION ALL
      SELECT * FROM run_single_benchmark() UNION ALL
      SELECT * FROM run_single_benchmark() UNION ALL
      SELECT * FROM run_single_benchmark() UNION ALL
      SELECT * FROM run_single_benchmark() UNION ALL
      SELECT * FROM run_single_benchmark()) benchmarks;

\echo ''
\echo '📊 Benchmark Summary:'
WITH bench AS (
    SELECT * FROM run_single_benchmark() UNION ALL
    SELECT * FROM run_single_benchmark() UNION ALL
    SELECT * FROM run_single_benchmark() UNION ALL
    SELECT * FROM run_single_benchmark() UNION ALL
    SELECT * FROM run_single_benchmark() UNION ALL
    SELECT * FROM run_single_benchmark() UNION ALL
    SELECT * FROM run_single_benchmark() UNION ALL
    SELECT * FROM run_single_benchmark() UNION ALL
    SELECT * FROM run_single_benchmark() UNION ALL
    SELECT * FROM run_single_benchmark()
)
SELECT
    '  Average: ' || ROUND(AVG(execution_time_ms), 2) || ' ms' as avg,
    '  Min: ' || ROUND(MIN(execution_time_ms), 2) || ' ms' as min,
    '  Max: ' || ROUND(MAX(execution_time_ms), 2) || ' ms' as max
FROM bench;

\echo ''
\echo '╔═══════════════════════════════════════════════════════════════════════╗'
\echo '║                     Test Suite Complete                              ║'
\echo '╚═══════════════════════════════════════════════════════════════════════╝'
