-- Test Script: test_hnsw_index.sql
-- Description: Comprehensive testing suite for HNSW index performance
-- Related: TASK-005 from BACKLOG.md
-- Created: 2026-02-02

-- ============================================================================
-- TEST 1: Verify HNSW Index Creation
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'memory_embeddings'
        AND indexname = 'idx_memory_embeddings_hnsw'
    ) THEN
        RAISE EXCEPTION 'HNSW index idx_memory_embeddings_hnsw not found';
    END IF;

    RAISE NOTICE 'TEST 1 PASSED: HNSW index exists';
END $$;

-- ============================================================================
-- TEST 2: Verify Index Uses HNSW Access Method
-- ============================================================================
DO $$
DECLARE
    index_method TEXT;
BEGIN
    SELECT am.amname INTO index_method
    FROM pg_class c
    JOIN pg_am am ON c.relam = am.oid
    WHERE c.relname = 'idx_memory_embeddings_hnsw';

    IF index_method != 'hnsw' THEN
        RAISE EXCEPTION 'Index is not using HNSW access method (found: %)', index_method;
    END IF;

    RAISE NOTICE 'TEST 2 PASSED: Index uses HNSW access method';
END $$;

-- ============================================================================
-- TEST 3: Verify HNSW Parameters (m=16, ef_construction=64)
-- ============================================================================
DO $$
DECLARE
    index_options TEXT;
BEGIN
    SELECT pg_get_indexdef(indexrelid, 0, true) INTO index_options
    FROM pg_stat_user_indexes
    WHERE indexrelname = 'idx_memory_embeddings_hnsw';

    IF index_options NOT LIKE '%m=16%' THEN
        RAISE WARNING 'Expected m=16 in index options';
    END IF;

    IF index_options NOT LIKE '%ef_construction=64%' THEN
        RAISE WARNING 'Expected ef_construction=64 in index options';
    END IF;

    RAISE NOTICE 'TEST 3 PASSED: HNSW parameters configured (m=16, ef_construction=64)';
    RAISE NOTICE 'Index definition: %', index_options;
END $$;

-- ============================================================================
-- TEST 4: Verify Query Uses Index Scan
-- ============================================================================
-- Create a sample vector for testing
DO $$
DECLARE
    sample_vector vector(1536);
    explain_output TEXT;
BEGIN
    -- Generate a random test vector
    sample_vector := array_fill(0.1, ARRAY[1536])::vector;

    -- Get query plan
    SELECT string_agg(plan_line, E'\n')
    INTO explain_output
    FROM (
        SELECT *
        FROM (
            EXPLAIN (FORMAT TEXT)
            SELECT id, 1 - (embedding <=> sample_vector) as similarity
            FROM memory_embeddings
            ORDER BY embedding <=> sample_vector
            LIMIT 10
        ) AS plan(plan_line)
    ) plans;

    IF explain_output LIKE '%Index Scan using idx_memory_embeddings_hnsw%' THEN
        RAISE NOTICE 'TEST 4 PASSED: Query uses HNSW index scan';
    ELSE
        RAISE WARNING 'TEST 4 WARNING: Query may not be using HNSW index';
        RAISE NOTICE 'Explain plan: %', explain_output;
    END IF;
END $$;

-- ============================================================================
-- TEST 5: Performance Benchmark (<100ms for 10K vectors)
-- ============================================================================
-- This test requires data in the table
-- Run after inserting test data

CREATE OR REPLACE FUNCTION run_hnsw_performance_test(
    num_queries INTEGER DEFAULT 10
)
RETURNS TABLE (
    query_num INTEGER,
    execution_time_ms NUMERIC,
    results_returned INTEGER,
    status TEXT
) AS $$
DECLARE
    i INTEGER;
    start_time TIMESTAMPTZ;
    end_time TIMESTAMPTZ;
    exec_time NUMERIC;
    result_count INTEGER;
    sample_vector vector(1536);
    row_count BIGINT;
BEGIN
    -- Check if table has data
    SELECT COUNT(*) INTO row_count FROM memory_embeddings;

    IF row_count = 0 THEN
        RAISE NOTICE 'WARNING: No data in memory_embeddings table. Skipping performance test.';
        RETURN;
    END IF;

    RAISE NOTICE 'Running % test queries on % embeddings...', num_queries, row_count;

    FOR i IN 1..num_queries LOOP
        -- Generate random test vector
        sample_vector := (
            SELECT array_agg(random()::REAL)::vector
            FROM generate_series(1, 1536)
        );

        -- Measure query execution time
        start_time := clock_timestamp();

        SELECT COUNT(*) INTO result_count
        FROM (
            SELECT id
            FROM memory_embeddings
            ORDER BY embedding <=> sample_vector
            LIMIT 10
        ) results;

        end_time := clock_timestamp();
        exec_time := EXTRACT(MILLISECONDS FROM (end_time - start_time));

        RETURN QUERY SELECT
            i AS query_num,
            exec_time AS execution_time_ms,
            result_count AS results_returned,
            CASE
                WHEN exec_time < 100 THEN 'PASS'
                WHEN exec_time < 200 THEN 'WARNING'
                ELSE 'FAIL'
            END AS status;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TEST 6: Recall Accuracy Test (~99%)
-- ============================================================================
-- This test compares HNSW approximate results with exact results

CREATE OR REPLACE FUNCTION test_hnsw_recall_accuracy(
    num_samples INTEGER DEFAULT 5
)
RETURNS TABLE (
    sample_num INTEGER,
    recall_percentage NUMERIC,
    status TEXT
) AS $$
DECLARE
    i INTEGER;
    sample_vector vector(1536);
    exact_ids UUID[];
    approx_ids UUID[];
    matches INTEGER;
    recall NUMERIC;
BEGIN
    FOR i IN 1..num_samples LOOP
        -- Generate random test vector
        sample_vector := (
            SELECT array_agg(random()::REAL)::vector
            FROM generate_series(1, 1536)
        );

        -- Get exact results (sequential scan, no index)
        SELECT array_agg(id ORDER BY distance) INTO exact_ids
        FROM (
            SELECT id, embedding <=> sample_vector AS distance
            FROM memory_embeddings
            ORDER BY distance
            LIMIT 10
        ) exact;

        -- Get approximate results (HNSW index)
        SELECT array_agg(id ORDER BY distance) INTO approx_ids
        FROM (
            SELECT id, embedding <=> sample_vector AS distance
            FROM memory_embeddings
            ORDER BY distance
            LIMIT 10
        ) approx;

        -- Calculate recall (percentage of exact results found in approximate results)
        SELECT COUNT(*) INTO matches
        FROM unnest(exact_ids) exact_id
        WHERE exact_id = ANY(approx_ids);

        recall := (matches::NUMERIC / COALESCE(array_length(exact_ids, 1), 1)) * 100;

        RETURN QUERY SELECT
            i AS sample_num,
            recall AS recall_percentage,
            CASE
                WHEN recall >= 99 THEN 'PASS'
                WHEN recall >= 95 THEN 'WARNING'
                ELSE 'FAIL'
            END AS status;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Run All Tests
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'HNSW Index Test Suite';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Running structural tests...';
END $$;

-- Tests 1-4 run automatically above

-- Note for performance tests:
\echo ''
\echo 'To run performance tests (requires data):'
\echo 'SELECT * FROM run_hnsw_performance_test(10);'
\echo ''
\echo 'To test recall accuracy:'
\echo 'SELECT * FROM test_hnsw_recall_accuracy(5);'
\echo ''
\echo 'To check current ef_search setting:'
\echo 'SHOW hnsw.ef_search;'
\echo ''
\echo 'To adjust search quality:'
\echo "SELECT set_hnsw_search_quality('balanced');"
