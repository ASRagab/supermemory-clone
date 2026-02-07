# Database Schema Design - Supermemory Clone

## Architecture Overview

This document defines the database schema for a supermemory.ai clone, implementing a knowledge management system with vector embeddings, memory graphs, and hierarchical organization.

### Technology Stack

- **Database**: PostgreSQL 15+
- **Vector Extension**: pgvector (for similarity search)
- **Indexing**: GIN indexes for JSONB, HNSW/IVFFlat for vectors
- **Connection Pooling**: PgBouncer recommended for production

### Design Principles

1. **Immutable Memory Trail**: Memories are versioned, never deleted
2. **Graph-First Relationships**: Memory connections form a knowledge graph
3. **Container Isolation**: Multi-tenant via container_tag partitioning
4. **Async Processing**: Decoupled ingestion via processing queue

---

## Entity Relationship Diagram

```
+------------------+       +-------------------+       +----------------------+
|   documents      |       |     memories      |       |  memory_embeddings   |
+------------------+       +-------------------+       +----------------------+
| id (PK)          |<----->| id (PK)           |<----->| memory_id (FK, PK)   |
| custom_id        |   1:N | document_id (FK)  |   1:1 | embedding (vector)   |
| content          |       | content           |       | model                |
| content_type     |       | memory_type       |       | created_at           |
| status           |       | is_latest         |       +----------------------+
| container_tag    |       | similarity_hash   |
| metadata (JSONB) |       | metadata (JSONB)  |
| created_at       |       | created_at        |       +----------------------+
| updated_at       |       | updated_at        |       | memory_relationships |
+------------------+       +-------------------+       +----------------------+
        |                         ^    ^               | id (PK)              |
        |                         |    +-------------->| source_memory_id (FK)|
        v                         |                    | target_memory_id (FK)|
+------------------+              |                    | relationship_type    |
| processing_queue |              |                    | weight               |
+------------------+              |                    | metadata (JSONB)     |
| id (PK)          |              |                    | created_at           |
| document_id (FK) |              |                    +----------------------+
| stage            |              |
| status           |              |
| error            |              +-------------------+
| attempts         |                                  |
| created_at       |              +-------------------+
| started_at       |              |   user_profiles   |
| completed_at     |              +-------------------+
+------------------+              | id (PK)           |
                                  | container_tag (FK)|
+------------------+              | static_facts      |
|  container_tags  |<------------>| dynamic_facts     |
+------------------+       1:1    | preferences       |
| id (PK)          |              | updated_at        |
| tag (UNIQUE)     |              +-------------------+
| parent_tag (FK)  |
| metadata (JSONB) |
| created_at       |
+------------------+
```

---

## Table Definitions

### 1. documents

Stores raw uploaded content before processing into memories.

```sql
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    custom_id VARCHAR(255),
    content TEXT NOT NULL,
    content_type VARCHAR(50) NOT NULL DEFAULT 'text/plain',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    container_tag VARCHAR(255) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    content_hash VARCHAR(64) GENERATED ALWAYS AS (encode(sha256(content::bytea), 'hex')) STORED,
    word_count INTEGER GENERATED ALWAYS AS (array_length(regexp_split_to_array(content, '\s+'), 1)) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT documents_status_check CHECK (
        status IN ('pending', 'processing', 'processed', 'failed', 'archived')
    ),
    CONSTRAINT documents_content_type_check CHECK (
        content_type IN ('text/plain', 'text/markdown', 'text/html',
                         'application/pdf', 'application/json', 'image/png',
                         'image/jpeg', 'audio/mp3', 'video/mp4')
    )
);

-- Indexes
CREATE INDEX idx_documents_container_tag ON documents(container_tag);
CREATE INDEX idx_documents_status ON documents(status) WHERE status != 'processed';
CREATE INDEX idx_documents_custom_id ON documents(custom_id) WHERE custom_id IS NOT NULL;
CREATE INDEX idx_documents_content_hash ON documents(content_hash);
CREATE INDEX idx_documents_created_at ON documents(created_at DESC);
CREATE INDEX idx_documents_metadata ON documents USING GIN(metadata jsonb_path_ops);

-- Composite index for common query patterns
CREATE INDEX idx_documents_container_status ON documents(container_tag, status, created_at DESC);

COMMENT ON TABLE documents IS 'Raw uploaded content before extraction into memories';
COMMENT ON COLUMN documents.custom_id IS 'User-provided identifier for external system integration';
COMMENT ON COLUMN documents.content_hash IS 'SHA-256 hash for deduplication';
COMMENT ON COLUMN documents.metadata IS 'Flexible storage: source_url, author, tags, etc.';
```

### 2. memories

Extracted facts, preferences, and episodic knowledge from documents.

```sql
CREATE TABLE memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    memory_type VARCHAR(20) NOT NULL DEFAULT 'fact',
    is_latest BOOLEAN NOT NULL DEFAULT TRUE,
    similarity_hash VARCHAR(64) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    supersedes_id UUID REFERENCES memories(id) ON DELETE SET NULL,
    container_tag VARCHAR(255) NOT NULL,
    confidence_score DECIMAL(4,3) DEFAULT 1.000,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT memories_type_check CHECK (
        memory_type IN ('fact', 'preference', 'episode', 'belief', 'skill', 'context')
    ),
    CONSTRAINT memories_confidence_check CHECK (
        confidence_score >= 0 AND confidence_score <= 1
    )
);

-- Indexes
CREATE INDEX idx_memories_document_id ON memories(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX idx_memories_container_tag ON memories(container_tag);
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_is_latest ON memories(is_latest) WHERE is_latest = TRUE;
CREATE INDEX idx_memories_similarity_hash ON memories(similarity_hash);
CREATE INDEX idx_memories_supersedes ON memories(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX idx_memories_metadata ON memories USING GIN(metadata jsonb_path_ops);
CREATE INDEX idx_memories_created_at ON memories(created_at DESC);

-- Composite indexes for common access patterns
CREATE INDEX idx_memories_container_latest ON memories(container_tag, is_latest, created_at DESC)
    WHERE is_latest = TRUE;
CREATE INDEX idx_memories_container_type_latest ON memories(container_tag, memory_type, is_latest)
    WHERE is_latest = TRUE;

-- Partial index for version chain traversal
CREATE INDEX idx_memories_version_chain ON memories(supersedes_id, version)
    WHERE supersedes_id IS NOT NULL;

COMMENT ON TABLE memories IS 'Extracted knowledge units from documents';
COMMENT ON COLUMN memories.similarity_hash IS 'Locality-sensitive hash for near-duplicate detection';
COMMENT ON COLUMN memories.is_latest IS 'FALSE when superseded by newer version';
COMMENT ON COLUMN memories.supersedes_id IS 'Points to previous version of this memory';
COMMENT ON COLUMN memories.confidence_score IS 'Extraction confidence: 0.0-1.0';
```

### 3. memory_relationships

Graph edges connecting memories with typed relationships.

```sql
CREATE TABLE memory_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    target_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    relationship_type VARCHAR(30) NOT NULL,
    weight DECIMAL(4,3) DEFAULT 1.000,
    bidirectional BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT memory_relationships_type_check CHECK (
        relationship_type IN (
            'updates',      -- Target updates/corrects source
            'extends',      -- Target adds detail to source
            'derives',      -- Target is derived from source
            'contradicts',  -- Target contradicts source
            'supports',     -- Target provides evidence for source
            'relates',      -- General semantic relationship
            'temporal',     -- Temporal ordering (before/after)
            'causal',       -- Cause-effect relationship
            'part_of',      -- Hierarchical containment
            'similar'       -- Semantic similarity link
        )
    ),
    CONSTRAINT memory_relationships_weight_check CHECK (
        weight >= 0 AND weight <= 1
    ),
    CONSTRAINT memory_relationships_no_self_loop CHECK (
        source_memory_id != target_memory_id
    ),
    CONSTRAINT memory_relationships_unique_edge UNIQUE (
        source_memory_id, target_memory_id, relationship_type
    )
);

-- Indexes
CREATE INDEX idx_memory_rel_source ON memory_relationships(source_memory_id);
CREATE INDEX idx_memory_rel_target ON memory_relationships(target_memory_id);
CREATE INDEX idx_memory_rel_type ON memory_relationships(relationship_type);
CREATE INDEX idx_memory_rel_bidirectional ON memory_relationships(source_memory_id, target_memory_id)
    WHERE bidirectional = TRUE;

-- Covering index for graph traversal
CREATE INDEX idx_memory_rel_graph ON memory_relationships(
    source_memory_id, target_memory_id, relationship_type, weight
);

COMMENT ON TABLE memory_relationships IS 'Knowledge graph edges between memories';
COMMENT ON COLUMN memory_relationships.weight IS 'Relationship strength: 0.0-1.0';
COMMENT ON COLUMN memory_relationships.bidirectional IS 'TRUE if relationship applies both directions';
```

### 4. memory_embeddings

Vector storage for semantic similarity search.

```sql
-- Ensure pgvector extension is installed
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE memory_embeddings (
    memory_id UUID PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,  -- OpenAI text-embedding-3-small dimension
    model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
    model_version VARCHAR(50),
    normalized BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT memory_embeddings_model_check CHECK (
        model IN (
            'text-embedding-3-small',   -- 1536 dimensions
            'text-embedding-3-large',   -- 3072 dimensions
            'text-embedding-ada-002',   -- 1536 dimensions (legacy)
            'voyage-large-2',           -- 1024 dimensions
            'voyage-code-2',            -- 1536 dimensions
            'cohere-embed-v3',          -- 1024 dimensions
            'bge-large-en-v1.5',        -- 1024 dimensions
            'custom'                    -- Custom models
        )
    )
);

-- HNSW index for approximate nearest neighbor search (faster, ~99% recall)
CREATE INDEX idx_memory_embeddings_hnsw ON memory_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Alternative: IVFFlat index (slower build, faster at scale)
-- CREATE INDEX idx_memory_embeddings_ivfflat ON memory_embeddings
--     USING ivfflat (embedding vector_cosine_ops)
--     WITH (lists = 100);

-- Index for model-specific queries
CREATE INDEX idx_memory_embeddings_model ON memory_embeddings(model);

COMMENT ON TABLE memory_embeddings IS 'Vector embeddings for semantic search';
COMMENT ON COLUMN memory_embeddings.embedding IS '1536-dim vector (adjust dimension for other models)';
COMMENT ON COLUMN memory_embeddings.normalized IS 'TRUE if L2-normalized for cosine similarity';
```

### 5. user_profiles

Aggregated user knowledge organized as static and dynamic facts.

```sql
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_tag VARCHAR(255) NOT NULL UNIQUE REFERENCES container_tags(tag) ON DELETE CASCADE,
    static_facts JSONB DEFAULT '[]'::jsonb,
    dynamic_facts JSONB DEFAULT '[]'::jsonb,
    preferences JSONB DEFAULT '{}'::jsonb,
    computed_traits JSONB DEFAULT '{}'::jsonb,
    last_interaction_at TIMESTAMPTZ,
    memory_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_user_profiles_container ON user_profiles(container_tag);
CREATE INDEX idx_user_profiles_static_facts ON user_profiles USING GIN(static_facts);
CREATE INDEX idx_user_profiles_dynamic_facts ON user_profiles USING GIN(dynamic_facts);
CREATE INDEX idx_user_profiles_preferences ON user_profiles USING GIN(preferences);
CREATE INDEX idx_user_profiles_updated ON user_profiles(updated_at DESC);

COMMENT ON TABLE user_profiles IS 'Aggregated user knowledge and preferences';
COMMENT ON COLUMN user_profiles.static_facts IS 'Stable facts: name, birthdate, location';
COMMENT ON COLUMN user_profiles.dynamic_facts IS 'Changing facts: current_project, mood, goals';
COMMENT ON COLUMN user_profiles.preferences IS 'User preferences: communication_style, topics';
COMMENT ON COLUMN user_profiles.computed_traits IS 'ML-derived traits: expertise_areas, interests';
```

**Static Facts Schema:**
```json
[
  {
    "key": "name",
    "value": "John Doe",
    "confidence": 0.99,
    "source_memory_id": "uuid",
    "updated_at": "2024-01-15T10:30:00Z"
  },
  {
    "key": "occupation",
    "value": "Software Engineer",
    "confidence": 0.95,
    "source_memory_id": "uuid",
    "updated_at": "2024-01-15T10:30:00Z"
  }
]
```

**Dynamic Facts Schema:**
```json
[
  {
    "key": "current_project",
    "value": "Building AI assistant",
    "confidence": 0.85,
    "source_memory_id": "uuid",
    "valid_from": "2024-01-10T00:00:00Z",
    "valid_until": null,
    "updated_at": "2024-01-15T10:30:00Z"
  }
]
```

### 6. container_tags

Hierarchical organization for multi-tenant isolation.

```sql
CREATE TABLE container_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag VARCHAR(255) NOT NULL UNIQUE,
    parent_tag VARCHAR(255) REFERENCES container_tags(tag) ON DELETE SET NULL,
    display_name VARCHAR(255),
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT container_tags_no_self_parent CHECK (tag != parent_tag),
    CONSTRAINT container_tags_tag_format CHECK (tag ~ '^[a-zA-Z0-9_-]+$')
);

-- Indexes
CREATE INDEX idx_container_tags_parent ON container_tags(parent_tag) WHERE parent_tag IS NOT NULL;
CREATE INDEX idx_container_tags_active ON container_tags(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_container_tags_metadata ON container_tags USING GIN(metadata);

-- Recursive CTE index support
CREATE INDEX idx_container_tags_hierarchy ON container_tags(tag, parent_tag);

COMMENT ON TABLE container_tags IS 'Hierarchical organization for isolation';
COMMENT ON COLUMN container_tags.tag IS 'Unique identifier: user_123, org_456, project_789';
COMMENT ON COLUMN container_tags.parent_tag IS 'Parent for hierarchy: project -> org -> root';
COMMENT ON COLUMN container_tags.settings IS 'Container-specific settings: retention_days, max_memories';
```

**Settings Schema:**
```json
{
  "retention_days": 365,
  "max_memories": 100000,
  "embedding_model": "text-embedding-3-small",
  "auto_extract": true,
  "dedup_threshold": 0.95
}
```

### 7. processing_queue

Async job management for document processing pipeline.

```sql
CREATE TABLE processing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    stage VARCHAR(30) NOT NULL DEFAULT 'extraction',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    error TEXT,
    error_code VARCHAR(50),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    worker_id VARCHAR(100),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT processing_queue_stage_check CHECK (
        stage IN (
            'extraction',      -- Extract memories from document
            'embedding',       -- Generate vector embeddings
            'deduplication',   -- Find and link similar memories
            'relationship',    -- Build memory graph edges
            'profile_update',  -- Update user profile
            'cleanup'          -- Archive or delete old data
        )
    ),
    CONSTRAINT processing_queue_status_check CHECK (
        status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'retry')
    ),
    CONSTRAINT processing_queue_attempts_check CHECK (attempts <= max_attempts)
);

-- Indexes
CREATE INDEX idx_processing_queue_document ON processing_queue(document_id);
CREATE INDEX idx_processing_queue_status ON processing_queue(status) WHERE status IN ('pending', 'retry');
CREATE INDEX idx_processing_queue_stage ON processing_queue(stage);
CREATE INDEX idx_processing_queue_worker ON processing_queue(worker_id) WHERE worker_id IS NOT NULL;

-- Priority queue index for job fetching
CREATE INDEX idx_processing_queue_priority ON processing_queue(priority DESC, scheduled_at ASC)
    WHERE status IN ('pending', 'retry');

-- Index for monitoring stale jobs
CREATE INDEX idx_processing_queue_stale ON processing_queue(started_at)
    WHERE status = 'processing';

-- Composite index for worker job selection
CREATE INDEX idx_processing_queue_worker_select ON processing_queue(
    status, stage, priority DESC, scheduled_at ASC
) WHERE status IN ('pending', 'retry');

COMMENT ON TABLE processing_queue IS 'Async job queue for document processing';
COMMENT ON COLUMN processing_queue.stage IS 'Current processing stage';
COMMENT ON COLUMN processing_queue.worker_id IS 'ID of worker processing this job';
COMMENT ON COLUMN processing_queue.scheduled_at IS 'When job should be processed (for delays)';
```

---

## Materialized Views

### Memory Search View

Combines memories with embeddings for efficient search.

```sql
CREATE MATERIALIZED VIEW mv_searchable_memories AS
SELECT
    m.id,
    m.content,
    m.memory_type,
    m.container_tag,
    m.confidence_score,
    m.metadata,
    m.created_at,
    e.embedding,
    e.model
FROM memories m
JOIN memory_embeddings e ON m.id = e.memory_id
WHERE m.is_latest = TRUE;

-- Refresh strategy: concurrent refresh every 5 minutes
CREATE UNIQUE INDEX idx_mv_searchable_memories_id ON mv_searchable_memories(id);
CREATE INDEX idx_mv_searchable_memories_container ON mv_searchable_memories(container_tag);
CREATE INDEX idx_mv_searchable_memories_hnsw ON mv_searchable_memories
    USING hnsw (embedding vector_cosine_ops);

-- Refresh command (run via cron or pg_cron)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_searchable_memories;
```

### Container Statistics View

```sql
CREATE MATERIALIZED VIEW mv_container_stats AS
SELECT
    c.tag,
    c.parent_tag,
    COUNT(DISTINCT d.id) AS document_count,
    COUNT(DISTINCT m.id) AS memory_count,
    COUNT(DISTINCT m.id) FILTER (WHERE m.is_latest) AS active_memory_count,
    MAX(d.created_at) AS last_document_at,
    MAX(m.created_at) AS last_memory_at
FROM container_tags c
LEFT JOIN documents d ON c.tag = d.container_tag
LEFT JOIN memories m ON c.tag = m.container_tag
GROUP BY c.tag, c.parent_tag;

CREATE UNIQUE INDEX idx_mv_container_stats_tag ON mv_container_stats(tag);

-- Refresh less frequently (hourly)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_container_stats;
```

---

## Functions and Triggers

### Updated Timestamp Trigger

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_memories_updated_at
    BEFORE UPDATE ON memories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_container_tags_updated_at
    BEFORE UPDATE ON container_tags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Memory Versioning Trigger

```sql
CREATE OR REPLACE FUNCTION handle_memory_supersession()
RETURNS TRIGGER AS $$
BEGIN
    -- When a new memory supersedes an old one, mark the old one as not latest
    IF NEW.supersedes_id IS NOT NULL THEN
        UPDATE memories
        SET is_latest = FALSE, updated_at = NOW()
        WHERE id = NEW.supersedes_id AND is_latest = TRUE;

        -- Inherit version number
        NEW.version := (
            SELECT COALESCE(MAX(version), 0) + 1
            FROM memories
            WHERE id = NEW.supersedes_id OR supersedes_id = NEW.supersedes_id
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_memory_versioning
    BEFORE INSERT ON memories
    FOR EACH ROW EXECUTE FUNCTION handle_memory_supersession();
```

### Similarity Search Function

```sql
CREATE OR REPLACE FUNCTION search_memories(
    query_embedding vector(1536),
    container_filter VARCHAR(255) DEFAULT NULL,
    memory_type_filter VARCHAR(20) DEFAULT NULL,
    limit_count INTEGER DEFAULT 10,
    similarity_threshold DECIMAL DEFAULT 0.7
)
RETURNS TABLE (
    memory_id UUID,
    content TEXT,
    memory_type VARCHAR(20),
    container_tag VARCHAR(255),
    similarity DECIMAL,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.content,
        m.memory_type,
        m.container_tag,
        (1 - (e.embedding <=> query_embedding))::DECIMAL AS similarity,
        m.metadata
    FROM memories m
    JOIN memory_embeddings e ON m.id = e.memory_id
    WHERE m.is_latest = TRUE
        AND (container_filter IS NULL OR m.container_tag = container_filter)
        AND (memory_type_filter IS NULL OR m.memory_type = memory_type_filter)
        AND (1 - (e.embedding <=> query_embedding)) >= similarity_threshold
    ORDER BY e.embedding <=> query_embedding
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql STABLE;
```

### Graph Traversal Function

```sql
CREATE OR REPLACE FUNCTION get_memory_graph(
    start_memory_id UUID,
    max_depth INTEGER DEFAULT 3,
    relationship_types VARCHAR[] DEFAULT NULL
)
RETURNS TABLE (
    memory_id UUID,
    content TEXT,
    depth INTEGER,
    path UUID[],
    relationship_type VARCHAR(30)
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE memory_graph AS (
        -- Base case: start node
        SELECT
            m.id,
            m.content,
            0 AS depth,
            ARRAY[m.id] AS path,
            NULL::VARCHAR(30) AS rel_type
        FROM memories m
        WHERE m.id = start_memory_id

        UNION ALL

        -- Recursive case: traverse relationships
        SELECT
            m.id,
            m.content,
            mg.depth + 1,
            mg.path || m.id,
            r.relationship_type
        FROM memory_graph mg
        JOIN memory_relationships r ON mg.memory_id = r.source_memory_id
        JOIN memories m ON r.target_memory_id = m.id
        WHERE mg.depth < max_depth
            AND NOT m.id = ANY(mg.path)  -- Prevent cycles
            AND (relationship_types IS NULL OR r.relationship_type = ANY(relationship_types))
    )
    SELECT * FROM memory_graph
    ORDER BY depth, memory_id;
END;
$$ LANGUAGE plpgsql STABLE;
```

### Queue Job Acquisition Function

```sql
CREATE OR REPLACE FUNCTION acquire_processing_job(
    worker_identifier VARCHAR(100),
    target_stage VARCHAR(30) DEFAULT NULL
)
RETURNS TABLE (
    job_id UUID,
    doc_id UUID,
    stage VARCHAR(30),
    doc_content TEXT,
    doc_metadata JSONB
) AS $$
DECLARE
    acquired_job_id UUID;
BEGIN
    -- Atomically acquire a job
    UPDATE processing_queue pq
    SET
        status = 'processing',
        worker_id = worker_identifier,
        started_at = NOW(),
        attempts = attempts + 1
    WHERE pq.id = (
        SELECT id
        FROM processing_queue
        WHERE status IN ('pending', 'retry')
            AND scheduled_at <= NOW()
            AND (target_stage IS NULL OR stage = target_stage)
        ORDER BY priority DESC, scheduled_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING pq.id INTO acquired_job_id;

    IF acquired_job_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        pq.id,
        pq.document_id,
        pq.stage,
        d.content,
        d.metadata
    FROM processing_queue pq
    JOIN documents d ON pq.document_id = d.id
    WHERE pq.id = acquired_job_id;
END;
$$ LANGUAGE plpgsql;
```

---

## Migration Strategy

### Initial Migration (V1)

```sql
-- Migration: 001_initial_schema.sql
-- Description: Create initial database schema for supermemory clone
-- Created: 2024-01-31

BEGIN;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Create tables in dependency order
-- 1. container_tags (no dependencies)
-- 2. documents (depends on container_tags)
-- 3. memories (depends on documents, container_tags)
-- 4. memory_embeddings (depends on memories)
-- 5. memory_relationships (depends on memories)
-- 6. user_profiles (depends on container_tags)
-- 7. processing_queue (depends on documents)

-- [Include all CREATE TABLE statements from above]

-- Create triggers
-- [Include all trigger definitions]

-- Create functions
-- [Include all function definitions]

-- Create materialized views
-- [Include materialized view definitions]

COMMIT;
```

### Migration Rollback

```sql
-- Rollback: 001_initial_schema.sql
BEGIN;

DROP MATERIALIZED VIEW IF EXISTS mv_container_stats;
DROP MATERIALIZED VIEW IF EXISTS mv_searchable_memories;

DROP FUNCTION IF EXISTS acquire_processing_job;
DROP FUNCTION IF EXISTS get_memory_graph;
DROP FUNCTION IF EXISTS search_memories;
DROP FUNCTION IF EXISTS handle_memory_supersession;
DROP FUNCTION IF EXISTS update_updated_at;

DROP TABLE IF EXISTS processing_queue;
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS memory_relationships;
DROP TABLE IF EXISTS memory_embeddings;
DROP TABLE IF EXISTS memories;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS container_tags;

DROP EXTENSION IF EXISTS vector;

COMMIT;
```

### Incremental Migrations

```sql
-- Migration: 002_add_memory_search_cache.sql
-- Add caching layer for frequent searches

BEGIN;

CREATE TABLE memory_search_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_hash VARCHAR(64) NOT NULL,
    container_tag VARCHAR(255) NOT NULL,
    results JSONB NOT NULL,
    hit_count INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour'
);

CREATE INDEX idx_search_cache_lookup ON memory_search_cache(query_hash, container_tag, expires_at);
CREATE INDEX idx_search_cache_expiry ON memory_search_cache(expires_at);

COMMIT;
```

```sql
-- Migration: 003_add_audit_log.sql
-- Add audit logging for compliance

BEGIN;

CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(10) NOT NULL, -- INSERT, UPDATE, DELETE
    old_data JSONB,
    new_data JSONB,
    user_id VARCHAR(255),
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);

-- Partition by month for large-scale deployments
-- CREATE TABLE audit_log_2024_01 PARTITION OF audit_log
--     FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

COMMIT;
```

---

## Performance Considerations

### Index Tuning

```sql
-- Analyze query patterns and adjust indexes
ANALYZE documents;
ANALYZE memories;
ANALYZE memory_embeddings;

-- Check index usage
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- Find unused indexes
SELECT
    schemaname || '.' || tablename AS table,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Vector Index Configuration

```sql
-- HNSW parameters tuning
-- m: Number of connections per layer (16-64, higher = better recall, more memory)
-- ef_construction: Build-time search depth (64-200, higher = better quality, slower build)

-- For high recall (99%+), production use:
DROP INDEX IF EXISTS idx_memory_embeddings_hnsw;
CREATE INDEX idx_memory_embeddings_hnsw ON memory_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 24, ef_construction = 100);

-- Set search-time ef parameter (higher = better recall, slower search)
SET hnsw.ef_search = 100;  -- Default is 40

-- For IVFFlat (alternative for very large datasets):
-- lists: sqrt(n) to n/1000 where n is row count
-- probes: lists/10 to lists/2 for search accuracy
CREATE INDEX idx_memory_embeddings_ivfflat ON memory_embeddings
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 1000);  -- Adjust based on data size

SET ivfflat.probes = 10;  -- Adjust for accuracy/speed tradeoff
```

### Partitioning Strategy

```sql
-- For large-scale deployments, partition memories by container_tag
CREATE TABLE memories_partitioned (
    LIKE memories INCLUDING ALL
) PARTITION BY LIST (container_tag);

-- Create partitions per major container
CREATE TABLE memories_user_default PARTITION OF memories_partitioned DEFAULT;
CREATE TABLE memories_org_123 PARTITION OF memories_partitioned
    FOR VALUES IN ('org_123');

-- Or partition by time for time-series access patterns
CREATE TABLE memories_by_time (
    LIKE memories INCLUDING ALL
) PARTITION BY RANGE (created_at);

CREATE TABLE memories_2024_q1 PARTITION OF memories_by_time
    FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');
```

---

## Security Considerations

### Row-Level Security (RLS)

```sql
-- Enable RLS on sensitive tables
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for container isolation
CREATE POLICY documents_container_isolation ON documents
    USING (container_tag = current_setting('app.current_container')::VARCHAR);

CREATE POLICY memories_container_isolation ON memories
    USING (container_tag = current_setting('app.current_container')::VARCHAR);

-- Usage: SET app.current_container = 'user_123';
```

### Encryption

```sql
-- Encrypt sensitive content at rest using pgcrypto
-- Note: Impacts search functionality, use selectively

ALTER TABLE documents
    ADD COLUMN content_encrypted BYTEA;

-- Encrypt on insert
CREATE OR REPLACE FUNCTION encrypt_document_content()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.content IS NOT NULL THEN
        NEW.content_encrypted := pgp_sym_encrypt(
            NEW.content,
            current_setting('app.encryption_key')
        );
        NEW.content := '[ENCRYPTED]';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## Monitoring Queries

### Queue Health

```sql
-- Processing queue status
SELECT
    stage,
    status,
    COUNT(*) as count,
    AVG(attempts) as avg_attempts,
    MIN(created_at) as oldest_job,
    MAX(completed_at) as latest_completion
FROM processing_queue
GROUP BY stage, status
ORDER BY stage, status;

-- Stale jobs (processing > 5 minutes)
SELECT * FROM processing_queue
WHERE status = 'processing'
    AND started_at < NOW() - INTERVAL '5 minutes';
```

### Memory Statistics

```sql
-- Memory distribution by type
SELECT
    container_tag,
    memory_type,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE is_latest) as active_count,
    AVG(confidence_score) as avg_confidence
FROM memories
GROUP BY container_tag, memory_type
ORDER BY container_tag, count DESC;

-- Relationship graph density
SELECT
    relationship_type,
    COUNT(*) as edge_count,
    AVG(weight) as avg_weight
FROM memory_relationships
GROUP BY relationship_type
ORDER BY edge_count DESC;
```

---

## Appendix: Complete DDL Script

```sql
-- Complete DDL for supermemory clone database
-- PostgreSQL 15+ with pgvector

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Table: container_tags
CREATE TABLE container_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag VARCHAR(255) NOT NULL UNIQUE,
    parent_tag VARCHAR(255) REFERENCES container_tags(tag) ON DELETE SET NULL,
    display_name VARCHAR(255),
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT container_tags_no_self_parent CHECK (tag != parent_tag),
    CONSTRAINT container_tags_tag_format CHECK (tag ~ '^[a-zA-Z0-9_-]+$')
);

CREATE INDEX idx_container_tags_parent ON container_tags(parent_tag) WHERE parent_tag IS NOT NULL;
CREATE INDEX idx_container_tags_active ON container_tags(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_container_tags_metadata ON container_tags USING GIN(metadata);
CREATE INDEX idx_container_tags_hierarchy ON container_tags(tag, parent_tag);

-- Table: documents
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    custom_id VARCHAR(255),
    content TEXT NOT NULL,
    content_type VARCHAR(50) NOT NULL DEFAULT 'text/plain',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    container_tag VARCHAR(255) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    content_hash VARCHAR(64) GENERATED ALWAYS AS (encode(sha256(content::bytea), 'hex')) STORED,
    word_count INTEGER GENERATED ALWAYS AS (array_length(regexp_split_to_array(content, '\s+'), 1)) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT documents_status_check CHECK (
        status IN ('pending', 'processing', 'processed', 'failed', 'archived')
    ),
    CONSTRAINT documents_content_type_check CHECK (
        content_type IN ('text/plain', 'text/markdown', 'text/html',
                         'application/pdf', 'application/json', 'image/png',
                         'image/jpeg', 'audio/mp3', 'video/mp4')
    )
);

CREATE INDEX idx_documents_container_tag ON documents(container_tag);
CREATE INDEX idx_documents_status ON documents(status) WHERE status != 'processed';
CREATE INDEX idx_documents_custom_id ON documents(custom_id) WHERE custom_id IS NOT NULL;
CREATE INDEX idx_documents_content_hash ON documents(content_hash);
CREATE INDEX idx_documents_created_at ON documents(created_at DESC);
CREATE INDEX idx_documents_metadata ON documents USING GIN(metadata jsonb_path_ops);
CREATE INDEX idx_documents_container_status ON documents(container_tag, status, created_at DESC);

-- Table: memories
CREATE TABLE memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    memory_type VARCHAR(20) NOT NULL DEFAULT 'fact',
    is_latest BOOLEAN NOT NULL DEFAULT TRUE,
    similarity_hash VARCHAR(64) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    supersedes_id UUID REFERENCES memories(id) ON DELETE SET NULL,
    container_tag VARCHAR(255) NOT NULL,
    confidence_score DECIMAL(4,3) DEFAULT 1.000,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memories_type_check CHECK (
        memory_type IN ('fact', 'preference', 'episode', 'belief', 'skill', 'context')
    ),
    CONSTRAINT memories_confidence_check CHECK (
        confidence_score >= 0 AND confidence_score <= 1
    )
);

CREATE INDEX idx_memories_document_id ON memories(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX idx_memories_container_tag ON memories(container_tag);
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_is_latest ON memories(is_latest) WHERE is_latest = TRUE;
CREATE INDEX idx_memories_similarity_hash ON memories(similarity_hash);
CREATE INDEX idx_memories_supersedes ON memories(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX idx_memories_metadata ON memories USING GIN(metadata jsonb_path_ops);
CREATE INDEX idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX idx_memories_container_latest ON memories(container_tag, is_latest, created_at DESC) WHERE is_latest = TRUE;
CREATE INDEX idx_memories_container_type_latest ON memories(container_tag, memory_type, is_latest) WHERE is_latest = TRUE;
CREATE INDEX idx_memories_version_chain ON memories(supersedes_id, version) WHERE supersedes_id IS NOT NULL;

-- Table: memory_embeddings
CREATE TABLE memory_embeddings (
    memory_id UUID PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
    embedding vector(1536) NOT NULL,
    model VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
    model_version VARCHAR(50),
    normalized BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_embeddings_model_check CHECK (
        model IN (
            'text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002',
            'voyage-large-2', 'voyage-code-2', 'cohere-embed-v3', 'bge-large-en-v1.5', 'custom'
        )
    )
);

CREATE INDEX idx_memory_embeddings_hnsw ON memory_embeddings
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_memory_embeddings_model ON memory_embeddings(model);

-- Table: memory_relationships
CREATE TABLE memory_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    target_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    relationship_type VARCHAR(30) NOT NULL,
    weight DECIMAL(4,3) DEFAULT 1.000,
    bidirectional BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_relationships_type_check CHECK (
        relationship_type IN ('updates', 'extends', 'derives', 'contradicts', 'supports',
                              'relates', 'temporal', 'causal', 'part_of', 'similar')
    ),
    CONSTRAINT memory_relationships_weight_check CHECK (weight >= 0 AND weight <= 1),
    CONSTRAINT memory_relationships_no_self_loop CHECK (source_memory_id != target_memory_id),
    CONSTRAINT memory_relationships_unique_edge UNIQUE (source_memory_id, target_memory_id, relationship_type)
);

CREATE INDEX idx_memory_rel_source ON memory_relationships(source_memory_id);
CREATE INDEX idx_memory_rel_target ON memory_relationships(target_memory_id);
CREATE INDEX idx_memory_rel_type ON memory_relationships(relationship_type);
CREATE INDEX idx_memory_rel_bidirectional ON memory_relationships(source_memory_id, target_memory_id) WHERE bidirectional = TRUE;
CREATE INDEX idx_memory_rel_graph ON memory_relationships(source_memory_id, target_memory_id, relationship_type, weight);

-- Table: user_profiles
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_tag VARCHAR(255) NOT NULL UNIQUE REFERENCES container_tags(tag) ON DELETE CASCADE,
    static_facts JSONB DEFAULT '[]'::jsonb,
    dynamic_facts JSONB DEFAULT '[]'::jsonb,
    preferences JSONB DEFAULT '{}'::jsonb,
    computed_traits JSONB DEFAULT '{}'::jsonb,
    last_interaction_at TIMESTAMPTZ,
    memory_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_container ON user_profiles(container_tag);
CREATE INDEX idx_user_profiles_static_facts ON user_profiles USING GIN(static_facts);
CREATE INDEX idx_user_profiles_dynamic_facts ON user_profiles USING GIN(dynamic_facts);
CREATE INDEX idx_user_profiles_preferences ON user_profiles USING GIN(preferences);
CREATE INDEX idx_user_profiles_updated ON user_profiles(updated_at DESC);

-- Table: processing_queue
CREATE TABLE processing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    stage VARCHAR(30) NOT NULL DEFAULT 'extraction',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    error TEXT,
    error_code VARCHAR(50),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    worker_id VARCHAR(100),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT processing_queue_stage_check CHECK (
        stage IN ('extraction', 'embedding', 'deduplication', 'relationship', 'profile_update', 'cleanup')
    ),
    CONSTRAINT processing_queue_status_check CHECK (
        status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'retry')
    ),
    CONSTRAINT processing_queue_attempts_check CHECK (attempts <= max_attempts)
);

CREATE INDEX idx_processing_queue_document ON processing_queue(document_id);
CREATE INDEX idx_processing_queue_status ON processing_queue(status) WHERE status IN ('pending', 'retry');
CREATE INDEX idx_processing_queue_stage ON processing_queue(stage);
CREATE INDEX idx_processing_queue_worker ON processing_queue(worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX idx_processing_queue_priority ON processing_queue(priority DESC, scheduled_at ASC) WHERE status IN ('pending', 'retry');
CREATE INDEX idx_processing_queue_stale ON processing_queue(started_at) WHERE status = 'processing';
CREATE INDEX idx_processing_queue_worker_select ON processing_queue(status, stage, priority DESC, scheduled_at ASC) WHERE status IN ('pending', 'retry');

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_memories_updated_at BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_container_tags_updated_at BEFORE UPDATE ON container_tags FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION handle_memory_supersession() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.supersedes_id IS NOT NULL THEN
        UPDATE memories SET is_latest = FALSE, updated_at = NOW() WHERE id = NEW.supersedes_id AND is_latest = TRUE;
        NEW.version := (SELECT COALESCE(MAX(version), 0) + 1 FROM memories WHERE id = NEW.supersedes_id OR supersedes_id = NEW.supersedes_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_memory_versioning BEFORE INSERT ON memories FOR EACH ROW EXECUTE FUNCTION handle_memory_supersession();
```

---

## Architecture Decision Records (ADRs)

### ADR-001: PostgreSQL with pgvector

**Status**: Accepted

**Context**: Need vector similarity search for semantic memory retrieval.

**Decision**: Use PostgreSQL with pgvector extension instead of dedicated vector databases (Pinecone, Weaviate).

**Rationale**:
- Single database for all data (simpler ops)
- ACID transactions across vectors and metadata
- pgvector HNSW provides ~99% recall with good performance
- Easier joins between vectors and relational data
- Cost-effective for moderate scale (< 10M vectors)

**Consequences**:
- (+) Simplified architecture
- (+) Transactional consistency
- (-) May need migration to dedicated vector DB at extreme scale
- (-) Slightly lower query performance vs specialized solutions

### ADR-002: Immutable Memory Versioning

**Status**: Accepted

**Context**: Memories may be updated, corrected, or superseded over time.

**Decision**: Never delete memories; mark as `is_latest = FALSE` and link via `supersedes_id`.

**Rationale**:
- Full audit trail of knowledge evolution
- Ability to trace how understanding changed
- No data loss from accidental updates
- Supports temporal queries ("what did I know in January?")

**Consequences**:
- (+) Complete history preservation
- (+) Supports contradiction detection
- (-) Increased storage requirements
- (-) More complex queries for "current" state

### ADR-003: Container-Based Multi-Tenancy

**Status**: Accepted

**Context**: Support multiple users/organizations with data isolation.

**Decision**: Use `container_tag` column for logical isolation with optional RLS.

**Rationale**:
- Simpler than separate schemas/databases
- Flexible hierarchy (user -> org -> project)
- Works with connection pooling
- Can enable RLS for strict isolation

**Consequences**:
- (+) Single database, simpler operations
- (+) Easy cross-container queries when authorized
- (-) Relies on application layer for basic isolation
- (-) Must carefully audit all queries for container filtering
