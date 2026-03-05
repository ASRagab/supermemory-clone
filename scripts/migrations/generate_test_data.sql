-- Generate Test Data for HNSW Performance Testing
-- Creates 1K, 10K, and 100K test vectors

\echo 'Generating test data for HNSW performance benchmarking...'
\echo ''

-- Function to generate random vector
CREATE OR REPLACE FUNCTION generate_random_vector(dims INTEGER)
RETURNS vector AS $$
    SELECT array_agg(random()::REAL)::vector
    FROM generate_series(1, dims);
$$ LANGUAGE SQL;

-- Ensure prerequisite memory rows exist for FK constraint
INSERT INTO memories (id, content, container_tag)
SELECT
    gen_random_uuid(),
    'Test memory ' || i,
    'test-data'
FROM generate_series(1, 1000) AS i
ON CONFLICT DO NOTHING;

-- Generate 1,000 vectors (1K dataset)
\echo 'Generating 1,000 test vectors (1K dataset)...'
INSERT INTO memory_embeddings (memory_id, embedding, model)
SELECT
    m.id,
    generate_random_vector(1536),
    'text-embedding-3-small'
FROM (SELECT id FROM memories ORDER BY created_at DESC LIMIT 1000) m;

\echo '✓ 1K dataset complete'

-- Get count
SELECT COUNT(*) as total_vectors FROM memory_embeddings;

-- Analyze for query planning
ANALYZE memory_embeddings;

\echo ''
\echo 'Test data generation complete!'
\echo 'Ready for performance benchmarking.'
