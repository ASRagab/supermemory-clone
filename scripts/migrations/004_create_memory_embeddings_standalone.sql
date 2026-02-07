-- Migration: 004_create_memory_embeddings_standalone.sql
-- Description: Standalone memory_embeddings table for HNSW testing (no FK dependencies)
-- Created: 2026-02-02
-- Purpose: TASK-005 HNSW Phase 1 Testing

-- Drop existing table if it has FK constraints
DROP TABLE IF EXISTS memory_embeddings CASCADE;

-- Create memory_embeddings table WITHOUT foreign key dependencies
CREATE TABLE memory_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL,
    memory_id UUID NOT NULL,

    -- Vector embedding (1536 dimensions for text-embedding-3-small)
    embedding vector(1536) NOT NULL,

    -- Metadata
    model VARCHAR(255) NOT NULL DEFAULT 'text-embedding-3-small',
    dimensions INTEGER NOT NULL DEFAULT 1536 CHECK (dimensions > 0),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Dimension validation
    CONSTRAINT check_dimensions_match
        CHECK (dimensions = vector_dims(embedding))
);

-- Create standard indexes
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_chunk_id
    ON memory_embeddings(chunk_id);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory_id
    ON memory_embeddings(memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model
    ON memory_embeddings(model);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_created_at
    ON memory_embeddings(created_at DESC);

-- Create HNSW index with optimized parameters
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_hnsw
    ON memory_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (
        m = 16,
        ef_construction = 64
    );

-- Set search-time tuning parameter
ALTER DATABASE supermemory SET hnsw.ef_search = 100;

-- Add statistics for query planning
ANALYZE memory_embeddings;

-- Add comments
COMMENT ON TABLE memory_embeddings IS 'Stores vector embeddings for semantic search with pgvector HNSW support';
COMMENT ON COLUMN memory_embeddings.embedding IS 'Vector embedding for cosine similarity search (1536 dimensions)';
COMMENT ON INDEX idx_memory_embeddings_hnsw IS 'HNSW index for fast approximate nearest neighbor search';

-- Confirm creation
\echo 'Memory embeddings table and HNSW index created successfully'
