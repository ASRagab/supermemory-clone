-- Migration: 002_create_memory_embeddings_table.sql
-- Description: Create memory_embeddings table with vector support
-- Dependencies: 001_create_pgvector_extension.sql
-- Created: 2026-02-02
-- Related: TASK-002 from BACKLOG.md

-- Create memory_embeddings table
-- This table stores vector embeddings for semantic search
-- Based on the architecture research and SQLite schema

CREATE TABLE IF NOT EXISTS memory_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL,
    memory_id UUID NOT NULL,

    -- Vector embedding (default dimensions: 1536 for text-embedding-3-small)
    -- Adjust dimensions based on your embedding model
    embedding vector(1536) NOT NULL,

    -- Metadata
    model VARCHAR(255) NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT fk_chunk FOREIGN KEY (chunk_id)
        REFERENCES chunks(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_memory FOREIGN KEY (memory_id)
        REFERENCES memories(id)
        ON DELETE CASCADE,
    CONSTRAINT check_dimensions_match
        CHECK (dimensions = vector_dims(embedding))
);

-- Create standard indexes for foreign keys and lookups
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_chunk_id
    ON memory_embeddings(chunk_id);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory_id
    ON memory_embeddings(memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model
    ON memory_embeddings(model);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_created_at
    ON memory_embeddings(created_at DESC);

-- Add trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_memory_embeddings_updated_at
    BEFORE UPDATE ON memory_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comment for documentation
COMMENT ON TABLE memory_embeddings IS 'Stores vector embeddings for semantic search with pgvector support';
COMMENT ON COLUMN memory_embeddings.embedding IS 'Vector embedding for cosine similarity search (default: 1536 dimensions for text-embedding-3-small)';
COMMENT ON COLUMN memory_embeddings.dimensions IS 'Number of dimensions in the embedding vector';
COMMENT ON COLUMN memory_embeddings.model IS 'Embedding model used (e.g., text-embedding-3-small, text-embedding-ada-002)';
