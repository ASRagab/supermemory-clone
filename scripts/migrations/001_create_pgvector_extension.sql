-- Migration: 001_create_pgvector_extension.sql
-- Description: Enable pgvector extension for PostgreSQL
-- Dependencies: None (requires PostgreSQL 12+ with pgvector installed)
-- Created: 2026-02-02

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify installation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
    ) THEN
        RAISE EXCEPTION 'pgvector extension failed to install';
    END IF;
END $$;

-- Test basic vector operations
DO $$
DECLARE
    test_distance FLOAT;
BEGIN
    -- Test euclidean distance
    SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector INTO test_distance;

    -- Test cosine distance
    SELECT '[1,2,3]'::vector <=> '[4,5,6]'::vector INTO test_distance;

    RAISE NOTICE 'pgvector extension verified successfully';
END $$;
