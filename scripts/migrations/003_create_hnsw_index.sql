-- Migration: 003_create_hnsw_index.sql
-- Description: Create HNSW index for fast vector similarity search
-- Dependencies: 002_create_memory_embeddings_table.sql
-- Created: 2026-02-02
-- Related: TASK-005 from BACKLOG.md

-- HNSW (Hierarchical Navigable Small World) Index Configuration
-- Performance targets from BACKLOG.md:
-- - Query performance < 100ms for 10K vectors
-- - ~99% recall accuracy
-- - Sub-100ms approximate nearest neighbor search

-- Create HNSW index with optimized parameters
-- m=16: Number of bi-directional links per node (higher = better recall, more memory)
-- ef_construction=64: Size of dynamic candidate list during construction (higher = better quality, slower build)
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_hnsw
    ON memory_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (
        m = 16,
        ef_construction = 64
    );

-- Set search-time tuning parameter
-- ef_search controls the size of the dynamic candidate list during search
-- Higher values = better recall but slower search
-- Default: 40, Recommended for 99% recall: 100
-- This can be adjusted per-session based on performance requirements

-- Global setting (applies to all sessions)
ALTER DATABASE CURRENT SET hnsw.ef_search = 100;

-- Session-level setting (can be adjusted dynamically)
-- SET hnsw.ef_search = 100;

-- Add statistics for query planning
ANALYZE memory_embeddings;

-- Create a helper function for optimal search configuration
CREATE OR REPLACE FUNCTION set_hnsw_search_quality(quality_level TEXT DEFAULT 'balanced')
RETURNS TEXT AS $$
BEGIN
    CASE quality_level
        WHEN 'fast' THEN
            -- Fast but lower recall (~95%)
            EXECUTE 'SET hnsw.ef_search = 40';
            RETURN 'HNSW search quality set to FAST (ef_search=40, ~95% recall)';
        WHEN 'balanced' THEN
            -- Balanced performance and recall (~99%)
            EXECUTE 'SET hnsw.ef_search = 100';
            RETURN 'HNSW search quality set to BALANCED (ef_search=100, ~99% recall)';
        WHEN 'accurate' THEN
            -- Highest recall (~99.5%+) but slower
            EXECUTE 'SET hnsw.ef_search = 200';
            RETURN 'HNSW search quality set to ACCURATE (ef_search=200, ~99.5%+ recall)';
        ELSE
            RAISE EXCEPTION 'Invalid quality_level. Use: fast, balanced, or accurate';
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON INDEX idx_memory_embeddings_hnsw IS 'HNSW index for fast approximate nearest neighbor search using cosine similarity';
COMMENT ON FUNCTION set_hnsw_search_quality IS 'Helper function to adjust HNSW search quality (fast/balanced/accurate)';

-- Performance validation query
-- This query should use the HNSW index for sub-100ms performance
CREATE OR REPLACE FUNCTION validate_hnsw_performance(
    query_embedding vector(1536),
    result_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    memory_id UUID,
    similarity FLOAT,
    execution_time_ms NUMERIC
) AS $$
DECLARE
    start_time TIMESTAMPTZ;
    end_time TIMESTAMPTZ;
BEGIN
    start_time := clock_timestamp();

    RETURN QUERY
    SELECT
        me.memory_id,
        1 - (me.embedding <=> query_embedding) AS similarity,
        EXTRACT(MILLISECONDS FROM (clock_timestamp() - start_time)) AS execution_time_ms
    FROM memory_embeddings me
    ORDER BY me.embedding <=> query_embedding
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_hnsw_performance IS 'Validation function to measure HNSW index performance (target: <100ms for 10K vectors)';
