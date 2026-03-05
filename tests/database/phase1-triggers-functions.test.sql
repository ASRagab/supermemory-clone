-- Phase 1: Database Triggers & Functions Test Suite
-- TASK-003 Test Implementation
-- Created: 2026-02-02
-- Purpose: Comprehensive testing of PostgreSQL triggers and functions

-- Test Setup
-- ==========================================================================

-- 1. Create test schema (isolated from main schema)
CREATE SCHEMA IF NOT EXISTS test_phase1;
SET search_path TO test_phase1;

-- 2. Create minimal test tables matching production schema
CREATE TABLE IF NOT EXISTS container_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    container_tag VARCHAR(255) NOT NULL,
    supersedes_id UUID REFERENCES memories(id) ON DELETE SET NULL,
    is_latest BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_container_tag FOREIGN KEY (container_tag)
        REFERENCES container_tags(tag) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_embeddings (
    memory_id UUID PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,
    model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
    model_version VARCHAR(50),
    normalized BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memory_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL,
    strength FLOAT NOT NULL CHECK (strength >= 0 AND strength <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    priority INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- ==========================================================================
-- Test 1: update_updated_at() Trigger
-- ==========================================================================

-- Create the trigger function (if not exists from migration)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER trg_memories_updated_at
    BEFORE UPDATE ON memories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_processing_queue_updated_at
    BEFORE UPDATE ON processing_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Test 1.1: Verify trigger updates timestamp on memories table
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-trigger-1';
    test_memory_id UUID;
    initial_updated_at TIMESTAMPTZ;
    new_updated_at TIMESTAMPTZ;
BEGIN
    -- Setup
    INSERT INTO container_tags (tag) VALUES (test_container_tag);
    INSERT INTO memories (content, container_tag)
    VALUES ('Initial content', test_container_tag)
    RETURNING id INTO test_memory_id;

    SELECT updated_at INTO initial_updated_at
    FROM memories WHERE id = test_memory_id;

    -- Wait to ensure timestamp difference
    PERFORM pg_sleep(0.1);

    -- Act
    UPDATE memories SET content = 'Updated content'
    WHERE id = test_memory_id;

    SELECT updated_at INTO new_updated_at
    FROM memories WHERE id = test_memory_id;

    -- Assert
    IF new_updated_at <= initial_updated_at THEN
        RAISE EXCEPTION 'TEST FAILED: Trigger did not update updated_at timestamp';
    END IF;

    RAISE NOTICE 'TEST PASSED: update_updated_at() trigger on memories';
END $$;

-- Test 1.2: Verify memory_embeddings uses memory_id as PK and supports insert/update
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-trigger-2';
    test_memory_id UUID;
    test_vector vector(1536);
    result_model VARCHAR(100);
BEGIN
    -- Setup
    INSERT INTO container_tags (tag) VALUES (test_container_tag);
    INSERT INTO memories (content, container_tag)
    VALUES ('Test content', test_container_tag)
    RETURNING id INTO test_memory_id;

    -- Create a test vector (all zeros for simplicity)
    test_vector := array_fill(0, ARRAY[1536])::vector(1536);

    -- Insert using memory_id as PK
    INSERT INTO memory_embeddings (memory_id, embedding, model)
    VALUES (test_memory_id, test_vector, 'text-embedding-3-small');

    -- Act: Update model field
    UPDATE memory_embeddings SET model = 'text-embedding-3-large'
    WHERE memory_id = test_memory_id;

    SELECT model INTO result_model
    FROM memory_embeddings WHERE memory_id = test_memory_id;

    -- Assert
    IF result_model != 'text-embedding-3-large' THEN
        RAISE EXCEPTION 'TEST FAILED: Update on memory_embeddings by memory_id did not work';
    END IF;

    RAISE NOTICE 'TEST PASSED: memory_embeddings uses memory_id as PK correctly';
END $$;

-- ==========================================================================
-- Test 2: handle_memory_supersession() Trigger
-- ==========================================================================

-- Create the memory supersession trigger function
CREATE OR REPLACE FUNCTION handle_memory_supersession()
RETURNS TRIGGER AS $$
BEGIN
    -- If this memory supersedes another, mark the old one as not latest
    IF NEW.supersedes_id IS NOT NULL THEN
        UPDATE memories
        SET is_latest = FALSE
        WHERE id = NEW.supersedes_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to memories table
CREATE TRIGGER trg_memory_supersession
    AFTER INSERT ON memories
    FOR EACH ROW
    EXECUTE FUNCTION handle_memory_supersession();

-- Test 2.1: Verify supersession marks old memory as not latest
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-supersession-1';
    old_memory_id UUID;
    new_memory_id UUID;
    old_is_latest BOOLEAN;
    new_is_latest BOOLEAN;
BEGIN
    -- Setup
    INSERT INTO container_tags (tag) VALUES (test_container_tag);

    -- Create original memory
    INSERT INTO memories (content, container_tag)
    VALUES ('Original version', test_container_tag)
    RETURNING id INTO old_memory_id;

    -- Act: Create new memory that supersedes the old one
    INSERT INTO memories (content, supersedes_id, container_tag)
    VALUES ('New version', old_memory_id, test_container_tag)
    RETURNING id INTO new_memory_id;

    -- Assert
    SELECT is_latest INTO old_is_latest
    FROM memories WHERE id = old_memory_id;

    SELECT is_latest INTO new_is_latest
    FROM memories WHERE id = new_memory_id;

    IF old_is_latest = TRUE THEN
        RAISE EXCEPTION 'TEST FAILED: Old memory should be marked as is_latest=FALSE';
    END IF;

    IF new_is_latest = FALSE THEN
        RAISE EXCEPTION 'TEST FAILED: New memory should be marked as is_latest=TRUE';
    END IF;

    RAISE NOTICE 'TEST PASSED: handle_memory_supersession() trigger';
END $$;

-- Test 2.2: Verify supersession chain (multiple versions)
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-supersession-chain';
    v1_id UUID;
    v2_id UUID;
    v3_id UUID;
    v1_is_latest BOOLEAN;
    v2_is_latest BOOLEAN;
    v3_is_latest BOOLEAN;
BEGIN
    -- Setup
    INSERT INTO container_tags (tag) VALUES (test_container_tag);

    -- Create version chain: v1 -> v2 -> v3
    INSERT INTO memories (content, container_tag)
    VALUES ('Version 1', test_container_tag)
    RETURNING id INTO v1_id;

    INSERT INTO memories (content, supersedes_id, container_tag)
    VALUES ('Version 2', v1_id, test_container_tag)
    RETURNING id INTO v2_id;

    INSERT INTO memories (content, supersedes_id, container_tag)
    VALUES ('Version 3', v2_id, test_container_tag)
    RETURNING id INTO v3_id;

    -- Assert
    SELECT is_latest INTO v1_is_latest FROM memories WHERE id = v1_id;
    SELECT is_latest INTO v2_is_latest FROM memories WHERE id = v2_id;
    SELECT is_latest INTO v3_is_latest FROM memories WHERE id = v3_id;

    IF v1_is_latest = TRUE OR v2_is_latest = TRUE THEN
        RAISE EXCEPTION 'TEST FAILED: Only latest version should have is_latest=TRUE';
    END IF;

    IF v3_is_latest = FALSE THEN
        RAISE EXCEPTION 'TEST FAILED: Latest version should have is_latest=TRUE';
    END IF;

    RAISE NOTICE 'TEST PASSED: Memory supersession chain handles multiple versions';
END $$;

-- ==========================================================================
-- Test 3: search_memories() Function
-- ==========================================================================

-- Create the search_memories function with vector similarity and filters
CREATE OR REPLACE FUNCTION search_memories(
    query_embedding vector(1536),
    similarity_threshold FLOAT DEFAULT 0.7,
    result_limit INTEGER DEFAULT 10,
    filter_container_tag VARCHAR(255) DEFAULT NULL
)
RETURNS TABLE (
    memory_id UUID,
    content TEXT,
    similarity_score FLOAT,
    container_tag VARCHAR(255),
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id AS memory_id,
        m.content,
        1 - (e.embedding <=> query_embedding) AS similarity_score,
        m.container_tag,
        m.created_at
    FROM memories m
    JOIN memory_embeddings e ON m.id = e.memory_id
    WHERE m.is_latest = TRUE
        AND (filter_container_tag IS NULL OR m.container_tag = filter_container_tag)
        AND (1 - (e.embedding <=> query_embedding)) >= similarity_threshold
    ORDER BY e.embedding <=> query_embedding
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Test 3.1: Verify search_memories returns results with similarity scores
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-search-1';
    test_memory_id UUID;
    query_vector vector(1536);
    embedding_vector vector(1536);
    result_count INTEGER;
    result_similarity FLOAT;
BEGIN
    -- Setup
    INSERT INTO container_tags (tag) VALUES (test_container_tag);

    -- Create test vectors (similar but not identical)
    query_vector := array_fill(0.5, ARRAY[1536])::vector(1536);
    embedding_vector := array_fill(0.5, ARRAY[1536])::vector(1536);

    -- Insert test memory with embedding
    INSERT INTO memories (content, container_tag)
    VALUES ('Test memory for search', test_container_tag)
    RETURNING id INTO test_memory_id;

    INSERT INTO memory_embeddings (memory_id, embedding, model)
    VALUES (test_memory_id, embedding_vector, 'text-embedding-3-small');

    -- Act
    SELECT COUNT(*), MAX(similarity_score) INTO result_count, result_similarity
    FROM search_memories(query_vector, 0.5, 10, NULL);

    -- Assert
    IF result_count = 0 THEN
        RAISE EXCEPTION 'TEST FAILED: search_memories should return at least one result';
    END IF;

    IF result_similarity < 0.5 THEN
        RAISE EXCEPTION 'TEST FAILED: Similarity score should meet threshold';
    END IF;

    RAISE NOTICE 'TEST PASSED: search_memories() returns results with similarity scores';
END $$;

-- Test 3.2: Verify search_memories respects container tag filter
DO $$
DECLARE
    tag1 VARCHAR(255) := 'test-search-filter-1';
    tag2 VARCHAR(255) := 'test-search-filter-2';
    memory1_id UUID;
    memory2_id UUID;
    test_vector vector(1536);
    filtered_count INTEGER;
BEGIN
    -- Setup
    INSERT INTO container_tags (tag) VALUES (tag1), (tag2);

    test_vector := array_fill(0.5, ARRAY[1536])::vector(1536);

    -- Insert memories in different containers
    INSERT INTO memories (content, container_tag)
    VALUES ('Memory in tag1', tag1)
    RETURNING id INTO memory1_id;

    INSERT INTO memories (content, container_tag)
    VALUES ('Memory in tag2', tag2)
    RETURNING id INTO memory2_id;

    INSERT INTO memory_embeddings (memory_id, embedding, model)
    VALUES
        (memory1_id, test_vector, 'text-embedding-3-small'),
        (memory2_id, test_vector, 'text-embedding-3-small');

    -- Act: Search with container tag filter
    SELECT COUNT(*) INTO filtered_count
    FROM search_memories(test_vector, 0.5, 10, tag1);

    -- Assert: Should only find memory1
    IF filtered_count != 1 THEN
        RAISE EXCEPTION 'TEST FAILED: search_memories should filter by container tag (expected 1, got %)', filtered_count;
    END IF;

    RAISE NOTICE 'TEST PASSED: search_memories() respects container tag filter';
END $$;

-- ==========================================================================
-- Test 4: get_memory_graph() Function
-- ==========================================================================

-- Create the get_memory_graph function with recursive CTE
CREATE OR REPLACE FUNCTION get_memory_graph(
    root_memory_id UUID,
    max_depth INTEGER DEFAULT 5
)
RETURNS TABLE (
    memory_id UUID,
    content TEXT,
    depth INTEGER,
    path UUID[],
    relationship_type VARCHAR(50)
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE memory_graph AS (
        -- Base case: start with root memory
        SELECT
            m.id AS memory_id,
            m.content,
            0 AS depth,
            ARRAY[m.id] AS path,
            NULL::VARCHAR(50) AS relationship_type
        FROM memories m
        WHERE m.id = root_memory_id

        UNION ALL

        -- Recursive case: follow relationships
        SELECT
            m.id AS memory_id,
            m.content,
            mg.depth + 1,
            mg.path || m.id,
            mr.relationship_type
        FROM memory_graph mg
        JOIN memory_relationships mr ON mg.memory_id = mr.source_id
        JOIN memories m ON mr.target_id = m.id
        WHERE mg.depth < max_depth
            AND NOT (m.id = ANY(mg.path))  -- Prevent cycles
    )
    SELECT * FROM memory_graph
    ORDER BY depth, memory_id;
END;
$$ LANGUAGE plpgsql;

-- Test 4.1: Verify get_memory_graph traverses relationships
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-graph-1';
    root_id UUID;
    child1_id UUID;
    child2_id UUID;
    result_count INTEGER;
    max_depth_found INTEGER;
BEGIN
    -- Setup
    INSERT INTO container_tags (tag) VALUES (test_container_tag);

    -- Create memory hierarchy: root -> child1 -> child2
    INSERT INTO memories (content, container_tag)
    VALUES ('Root memory', test_container_tag)
    RETURNING id INTO root_id;

    INSERT INTO memories (content, container_tag)
    VALUES ('Child 1 memory', test_container_tag)
    RETURNING id INTO child1_id;

    INSERT INTO memories (content, container_tag)
    VALUES ('Child 2 memory', test_container_tag)
    RETURNING id INTO child2_id;

    -- Create relationships
    INSERT INTO memory_relationships (source_id, target_id, relationship_type, strength)
    VALUES
        (root_id, child1_id, 'references', 0.9),
        (child1_id, child2_id, 'references', 0.8);

    -- Act
    SELECT COUNT(*), MAX(depth) INTO result_count, max_depth_found
    FROM get_memory_graph(root_id, 5);

    -- Assert
    IF result_count != 3 THEN
        RAISE EXCEPTION 'TEST FAILED: get_memory_graph should return 3 memories (expected 3, got %)', result_count;
    END IF;

    IF max_depth_found != 2 THEN
        RAISE EXCEPTION 'TEST FAILED: Max depth should be 2 (got %)', max_depth_found;
    END IF;

    RAISE NOTICE 'TEST PASSED: get_memory_graph() traverses relationships correctly';
END $$;

-- Test 4.2: Verify get_memory_graph prevents infinite loops
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-graph-cycle';
    mem1_id UUID;
    mem2_id UUID;
    result_count INTEGER;
BEGIN
    -- Setup: Create circular reference
    INSERT INTO container_tags (tag) VALUES (test_container_tag);

    INSERT INTO memories (content, container_tag)
    VALUES ('Memory 1', test_container_tag)
    RETURNING id INTO mem1_id;

    INSERT INTO memories (content, container_tag)
    VALUES ('Memory 2', test_container_tag)
    RETURNING id INTO mem2_id;

    -- Create circular relationships: mem1 -> mem2 -> mem1
    INSERT INTO memory_relationships (source_id, target_id, relationship_type, strength)
    VALUES
        (mem1_id, mem2_id, 'references', 0.9),
        (mem2_id, mem1_id, 'references', 0.9);

    -- Act
    SELECT COUNT(*) INTO result_count
    FROM get_memory_graph(mem1_id, 5);

    -- Assert: Should only return 2 memories (no infinite loop)
    IF result_count != 2 THEN
        RAISE EXCEPTION 'TEST FAILED: Circular reference should be prevented (expected 2, got %)', result_count;
    END IF;

    RAISE NOTICE 'TEST PASSED: get_memory_graph() prevents circular references';
END $$;

-- ==========================================================================
-- Test 5: acquire_processing_job() Function
-- ==========================================================================

-- Create the acquire_processing_job function with locking
CREATE OR REPLACE FUNCTION acquire_processing_job(
    worker_id VARCHAR(255),
    job_types VARCHAR(50)[] DEFAULT NULL
)
RETURNS TABLE (
    job_id UUID,
    task_type VARCHAR(50),
    payload JSONB,
    retry_count INTEGER
) AS $$
DECLARE
    acquired_job processing_queue%ROWTYPE;
BEGIN
    -- Use FOR UPDATE SKIP LOCKED for lock-free concurrency
    SELECT * INTO acquired_job
    FROM processing_queue
    WHERE status = 'pending'
        AND (job_types IS NULL OR task_type = ANY(job_types))
        AND retry_count < max_retries
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    -- If no job found, return empty result
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Update job status to processing
    UPDATE processing_queue
    SET
        status = 'processing',
        started_at = NOW(),
        updated_at = NOW()
    WHERE id = acquired_job.id;

    -- Return the acquired job
    RETURN QUERY
    SELECT
        acquired_job.id,
        acquired_job.task_type,
        acquired_job.payload,
        acquired_job.retry_count;
END;
$$ LANGUAGE plpgsql;

-- Test 5.1: Verify acquire_processing_job acquires pending jobs
DO $$
DECLARE
    test_job_id UUID;
    acquired_job_id UUID;
    acquired_status VARCHAR(20);
BEGIN
    -- Setup: Create a pending job
    INSERT INTO processing_queue (task_type, payload, status, priority)
    VALUES ('test_task', '{"data": "test"}', 'pending', 0)
    RETURNING id INTO test_job_id;

    -- Act
    SELECT job_id INTO acquired_job_id
    FROM acquire_processing_job('worker-1', NULL);

    -- Assert
    IF acquired_job_id IS NULL THEN
        RAISE EXCEPTION 'TEST FAILED: Should acquire pending job';
    END IF;

    IF acquired_job_id != test_job_id THEN
        RAISE EXCEPTION 'TEST FAILED: Should acquire the correct job';
    END IF;

    -- Verify status changed to processing
    SELECT status INTO acquired_status
    FROM processing_queue WHERE id = acquired_job_id;

    IF acquired_status != 'processing' THEN
        RAISE EXCEPTION 'TEST FAILED: Job status should be processing (got %)', acquired_status;
    END IF;

    RAISE NOTICE 'TEST PASSED: acquire_processing_job() acquires and locks jobs';
END $$;

-- Test 5.2: Verify acquire_processing_job respects priority
DO $$
DECLARE
    low_priority_id UUID;
    high_priority_id UUID;
    acquired_job_id UUID;
BEGIN
    -- Setup: Create jobs with different priorities
    INSERT INTO processing_queue (task_type, payload, status, priority)
    VALUES ('test_task', '{"priority": "low"}', 'pending', 0)
    RETURNING id INTO low_priority_id;

    INSERT INTO processing_queue (task_type, payload, status, priority)
    VALUES ('test_task', '{"priority": "high"}', 'pending', 10)
    RETURNING id INTO high_priority_id;

    -- Act
    SELECT job_id INTO acquired_job_id
    FROM acquire_processing_job('worker-1', NULL);

    -- Assert: Should acquire high priority job first
    IF acquired_job_id != high_priority_id THEN
        RAISE EXCEPTION 'TEST FAILED: Should acquire high priority job first';
    END IF;

    RAISE NOTICE 'TEST PASSED: acquire_processing_job() respects job priority';
END $$;

-- Test 5.3: Verify acquire_processing_job with concurrent workers (SKIP LOCKED)
DO $$
DECLARE
    job1_id UUID;
    job2_id UUID;
    worker1_job_id UUID;
    worker2_job_id UUID;
BEGIN
    -- Setup: Create two jobs
    INSERT INTO processing_queue (task_type, payload, status, priority)
    VALUES
        ('test_task', '{"job": 1}', 'pending', 0),
        ('test_task', '{"job": 2}', 'pending', 0)
    RETURNING id INTO job1_id;

    -- Act: Simulate two concurrent workers
    -- Worker 1 acquires first job
    SELECT job_id INTO worker1_job_id
    FROM acquire_processing_job('worker-1', NULL);

    -- Worker 2 should acquire second job (SKIP LOCKED prevents blocking)
    SELECT job_id INTO worker2_job_id
    FROM acquire_processing_job('worker-2', NULL);

    -- Assert: Workers should acquire different jobs
    IF worker1_job_id IS NULL OR worker2_job_id IS NULL THEN
        RAISE EXCEPTION 'TEST FAILED: Both workers should acquire jobs';
    END IF;

    IF worker1_job_id = worker2_job_id THEN
        RAISE EXCEPTION 'TEST FAILED: Workers should acquire different jobs (no locking conflict)';
    END IF;

    RAISE NOTICE 'TEST PASSED: acquire_processing_job() handles concurrent workers with SKIP LOCKED';
END $$;

-- ==========================================================================
-- Edge Case Tests
-- ==========================================================================

-- Edge Case 1: Trigger handles NULL values correctly
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-edge-null';
    test_memory_id UUID;
BEGIN
    INSERT INTO container_tags (tag) VALUES (test_container_tag);

    -- Insert memory without supersedes_id (NULL)
    INSERT INTO memories (content, container_tag, supersedes_id)
    VALUES ('Memory without supersession', test_container_tag, NULL)
    RETURNING id INTO test_memory_id;

    -- Should not raise error
    RAISE NOTICE 'TEST PASSED: Triggers handle NULL values correctly';
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'TEST FAILED: Trigger failed on NULL value: %', SQLERRM;
END $$;

-- Edge Case 2: Search with no results returns empty set
DO $$
DECLARE
    result_count INTEGER;
    impossible_vector vector(1536);
BEGIN
    -- Create vector that won't match any existing embeddings
    impossible_vector := array_fill(-1, ARRAY[1536])::vector(1536);

    SELECT COUNT(*) INTO result_count
    FROM search_memories(impossible_vector, 0.99, 10, NULL);

    -- Should return 0 results, not error
    IF result_count > 0 THEN
        RAISE EXCEPTION 'TEST FAILED: Search should return 0 results for impossible vector';
    END IF;

    RAISE NOTICE 'TEST PASSED: Search with no results returns empty set';
END $$;

-- Edge Case 3: Graph traversal with max_depth = 0
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-edge-depth';
    root_id UUID;
    result_count INTEGER;
BEGIN
    INSERT INTO container_tags (tag) VALUES (test_container_tag);

    INSERT INTO memories (content, container_tag)
    VALUES ('Root memory', test_container_tag)
    RETURNING id INTO root_id;

    SELECT COUNT(*) INTO result_count
    FROM get_memory_graph(root_id, 0);

    -- Should return only root node
    IF result_count != 1 THEN
        RAISE EXCEPTION 'TEST FAILED: Graph with depth=0 should return only root (got %)', result_count;
    END IF;

    RAISE NOTICE 'TEST PASSED: Graph traversal with max_depth=0 returns only root';
END $$;

-- Edge Case 4: Job acquisition with retry limit exceeded
DO $$
DECLARE
    test_job_id UUID;
    acquired_job_id UUID;
BEGIN
    -- Create job that exceeded retry limit
    INSERT INTO processing_queue (task_type, payload, status, retry_count, max_retries)
    VALUES ('test_task', '{"data": "test"}', 'pending', 3, 3)
    RETURNING id INTO test_job_id;

    SELECT job_id INTO acquired_job_id
    FROM acquire_processing_job('worker-1', NULL);

    -- Should not acquire job that exceeded retries
    IF acquired_job_id = test_job_id THEN
        RAISE EXCEPTION 'TEST FAILED: Should not acquire job that exceeded retry limit';
    END IF;

    RAISE NOTICE 'TEST PASSED: Job acquisition respects retry limit';
END $$;

-- ==========================================================================
-- Performance Tests
-- ==========================================================================

-- Performance Test 1: Trigger overhead is minimal
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-perf-trigger';
    start_time TIMESTAMPTZ;
    end_time TIMESTAMPTZ;
    duration_ms NUMERIC;
    i INTEGER;
BEGIN
    INSERT INTO container_tags (tag) VALUES (test_container_tag);

    start_time := clock_timestamp();

    -- Insert 100 records to measure trigger overhead
    FOR i IN 1..100 LOOP
        INSERT INTO memories (content, container_tag)
        VALUES ('Performance test memory ' || i, test_container_tag);
    END LOOP;

    end_time := clock_timestamp();
    duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time));

    -- Trigger should add minimal overhead (< 10ms per insert on average)
    IF duration_ms / 100 > 10 THEN
        RAISE WARNING 'PERFORMANCE WARNING: Trigger overhead is %.2f ms per insert', duration_ms / 100;
    END IF;

    RAISE NOTICE 'PERFORMANCE: Trigger overhead is %.2f ms per insert (100 inserts in %.2f ms)',
        duration_ms / 100, duration_ms;
END $$;

-- Performance Test 2: Vector search with HNSW index
-- Note: This test requires actual HNSW index from migration 003
DO $$
DECLARE
    test_container_tag VARCHAR(255) := 'test-perf-search';
    test_vector vector(1536);
    start_time TIMESTAMPTZ;
    end_time TIMESTAMPTZ;
    duration_ms NUMERIC;
BEGIN
    -- This test is informational only
    -- Actual performance depends on HNSW index being created

    test_vector := array_fill(0.5, ARRAY[1536])::vector(1536);

    start_time := clock_timestamp();

    PERFORM * FROM search_memories(test_vector, 0.7, 10, NULL);

    end_time := clock_timestamp();
    duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time));

    RAISE NOTICE 'PERFORMANCE: Vector search executed in %.2f ms (target: <100ms for 10K vectors)', duration_ms;
END $$;

-- ==========================================================================
-- Cleanup
-- ==========================================================================

RAISE NOTICE '==========================================================================';
RAISE NOTICE 'Phase 1 Database Triggers & Functions Test Suite Complete';
RAISE NOTICE '==========================================================================';
RAISE NOTICE 'All tests executed. Check output for PASSED/FAILED status.';
RAISE NOTICE 'To clean up test data: DROP SCHEMA test_phase1 CASCADE;';
