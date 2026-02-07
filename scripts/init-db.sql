-- =============================================================================
-- SuperMemory Clone - PostgreSQL Database Initialization
-- =============================================================================
-- This script is automatically executed when the PostgreSQL container starts
-- It ensures the pgvector extension is enabled and ready for vector operations
-- =============================================================================

-- Enable pgvector extension for vector similarity search
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

-- Test vector operations to ensure pgvector is working correctly
SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector AS test_distance;

-- =============================================================================
-- Additional PostgreSQL Optimization
-- =============================================================================

-- Enable essential extensions
CREATE EXTENSION IF NOT EXISTS plpgsql;

-- =============================================================================
-- Database ready for migration
-- =============================================================================
