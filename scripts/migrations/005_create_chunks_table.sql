-- Migration 005: Create Chunks Table
-- Purpose: Store text chunks with token tracking and metadata for embedding generation
-- Dependencies: memories table (from Phase 1 schema)
-- Created: February 2, 2026

-- Create chunks table
CREATE TABLE IF NOT EXISTS chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    start_offset INTEGER,
    end_offset INTEGER,
    token_count INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Ensure chunk_index is unique per memory
    CONSTRAINT unique_chunk_per_memory UNIQUE (memory_id, chunk_index),

    -- Ensure offsets are valid if provided
    CONSTRAINT valid_offsets CHECK (
        (start_offset IS NULL AND end_offset IS NULL) OR
        (start_offset IS NOT NULL AND end_offset IS NOT NULL AND start_offset < end_offset)
    ),

    -- Ensure chunk_index is non-negative
    CONSTRAINT non_negative_chunk_index CHECK (chunk_index >= 0),

    -- Ensure token_count is positive if provided
    CONSTRAINT positive_token_count CHECK (token_count IS NULL OR token_count > 0)
);

-- Create indexes for efficient querying

-- Index for looking up chunks by memory
CREATE INDEX IF NOT EXISTS idx_chunks_memory_id ON chunks(memory_id);

-- Composite index for ordering chunks within a memory
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_index ON chunks(memory_id, chunk_index);

-- Index for filtering by token count (useful for batch processing)
CREATE INDEX IF NOT EXISTS idx_chunks_token_count ON chunks(token_count);

-- GIN index for JSONB metadata queries
CREATE INDEX IF NOT EXISTS idx_chunks_metadata ON chunks USING gin(metadata jsonb_path_ops);

-- Add helpful comments
COMMENT ON TABLE chunks IS 'Stores text chunks with positional and token information for embedding generation';
COMMENT ON COLUMN chunks.id IS 'Unique identifier for the chunk';
COMMENT ON COLUMN chunks.memory_id IS 'Reference to the parent memory this chunk belongs to';
COMMENT ON COLUMN chunks.content IS 'The actual text content of the chunk';
COMMENT ON COLUMN chunks.chunk_index IS 'Sequential index of this chunk within its parent memory (0-based)';
COMMENT ON COLUMN chunks.start_offset IS 'Character offset where this chunk starts in the original content';
COMMENT ON COLUMN chunks.end_offset IS 'Character offset where this chunk ends in the original content';
COMMENT ON COLUMN chunks.token_count IS 'Number of tokens in this chunk (for rate limiting and cost estimation)';
COMMENT ON COLUMN chunks.metadata IS 'Additional metadata about the chunk (e.g., chunking strategy used, overlap info)';
COMMENT ON COLUMN chunks.created_at IS 'Timestamp when this chunk was created';

-- Verification queries
DO $$
BEGIN
    -- Verify table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chunks') THEN
        RAISE NOTICE 'Table chunks created successfully';
    ELSE
        RAISE EXCEPTION 'Failed to create chunks table';
    END IF;

    -- Verify indexes exist
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'chunks'
        AND indexname IN ('idx_chunks_memory_id', 'idx_chunks_chunk_index', 'idx_chunks_token_count', 'idx_chunks_metadata')
    ) THEN
        RAISE NOTICE 'All indexes created successfully';
    END IF;

    -- Count total indexes
    RAISE NOTICE 'Total indexes on chunks table: %', (
        SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'chunks'
    );
END $$;

-- Sample usage (commented out - for documentation only)
-- INSERT INTO chunks (memory_id, content, chunk_index, start_offset, end_offset, token_count, metadata)
-- VALUES (
--     'memory-uuid-here',
--     'This is a sample chunk of text.',
--     0,
--     0,
--     32,
--     8,
--     '{"strategy": "fixed-size", "overlap": 50}'::jsonb
-- );
