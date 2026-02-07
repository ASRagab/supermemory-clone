# Database Setup Guide

Complete guide for setting up and configuring PostgreSQL with pgvector and connection pooling for the Supermemory project.

**Last Updated**: 2026-02-02
**Related Tasks**: TASK-001 (Database Setup Documentation), TASK-005 (HNSW Index), TASK-002 (PostgreSQL Schema)

## Table of Contents

- [Quick Start](#quick-start)
- [PostgreSQL Setup](#postgresql-setup)
- [Connection Pooling](#connection-pooling)
- [Migration Procedures](#migration-procedures)
- [Verification Steps](#verification-steps)
- [Troubleshooting](#troubleshooting)
- [Performance Tuning](#performance-tuning)
- [Monitoring](#monitoring)
- [References](#references)

---

## Quick Start

The fastest way to get a production-ready PostgreSQL database with pgvector is using Docker Compose:

```bash
# Start PostgreSQL with pgvector
docker compose up -d postgres

# Wait for database to be ready
docker compose exec postgres pg_isready -U supermemory -d supermemory

# Run migrations
./scripts/migrations/run_migrations.sh

# Verify installation
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

For **local development** without Docker, follow the [PostgreSQL Setup](#postgresql-setup) section.

---

## PostgreSQL Setup

### Docker Compose Setup

The project includes a pre-configured Docker Compose setup that starts PostgreSQL 16 with pgvector support.

#### Prerequisites

- Docker and Docker Compose installed
- 2GB free disk space for database volume

#### Starting PostgreSQL

```bash
# Start PostgreSQL service (postgres profile)
docker compose up -d postgres

# Verify container is running
docker compose ps postgres

# Check logs if startup fails
docker compose logs postgres
```

#### Environment Configuration

The docker-compose.yml includes these PostgreSQL settings:

```yaml
environment:
  - POSTGRES_USER=supermemory
  - POSTGRES_PASSWORD=supermemory_secret
  - POSTGRES_DB=supermemory
  - POSTGRES_INITDB_ARGS=--encoding=UTF-8 --lc-collate=C --lc-ctype=C
```

To override credentials, create a `.env` file:

```bash
# .env
POSTGRES_USER=your_user
POSTGRES_PASSWORD=your_password
POSTGRES_DB=supermemory
```

#### Data Persistence

Database data is stored in a Docker volume named `supermemory_postgres_data`:

```bash
# List volumes
docker volume ls | grep supermemory

# Backup database
docker compose exec postgres pg_dump -U supermemory supermemory > backup.sql

# Restore from backup
docker compose exec -T postgres psql -U supermemory supermemory < backup.sql

# Remove volume (DESTRUCTIVE)
docker volume rm supermemory_postgres_data
```

### Local PostgreSQL Setup

If you prefer running PostgreSQL locally without Docker:

#### macOS (Homebrew)

```bash
# Install PostgreSQL
brew install postgresql@16 pgvector

# Start PostgreSQL service
brew services start postgresql@16

# Verify installation
psql --version
# Output: psql (PostgreSQL) 16.x

# Verify pgvector extension is available
psql postgres -c "SELECT installed_version FROM pg_available_extensions WHERE name = 'vector';"
```

#### Ubuntu/Debian

```bash
# Install PostgreSQL and pgvector
sudo apt update
sudo apt install postgresql-16 postgresql-16-pgvector

# Verify installation
psql --version

# Verify pgvector extension
psql postgres -c "SELECT installed_version FROM pg_available_extensions WHERE name = 'vector';"
```

#### Creating Database and User

```bash
# Connect as default PostgreSQL user
sudo -u postgres psql

# Inside psql:
CREATE DATABASE supermemory;
CREATE USER supermemory WITH PASSWORD 'your_secure_password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE supermemory TO supermemory;

-- Grant schema permissions
\c supermemory
GRANT ALL PRIVILEGES ON SCHEMA public TO supermemory;

-- Exit
\q
```

### pgvector Extension Verification

Verify pgvector extension is available and properly installed:

```bash
# Check if extension is available
psql -U supermemory -d supermemory -c "SELECT * FROM pg_available_extensions WHERE name = 'vector';"

# Expected output:
#   name  | default_version | installed_version |         comment
# --------+-----------------+-------------------+---------------------------
#  vector | 0.5.1           |                   | vector type for PostgreSQL
```

If extension is not available, install pgvector:

**macOS:**
```bash
brew install pgvector
brew services restart postgresql@16
```

**Ubuntu/Debian:**
```bash
sudo apt install postgresql-16-pgvector
sudo systemctl restart postgresql
```

### Connection Testing

Test database connectivity before running migrations:

```bash
# Using psql
psql -U supermemory -d supermemory -c "SELECT version();"

# Using environment variable
export DATABASE_URL="postgresql://supermemory:your_password@localhost:5432/supermemory"
psql $DATABASE_URL -c "SELECT version();"

# With Docker
docker compose exec postgres psql -U supermemory -d supermemory -c "SELECT version();"
```

---

## Connection Pooling

### Configuration Overview

Connection pooling improves performance by reusing database connections instead of creating new ones for each request.

### pg-pool Configuration

The application supports connection pooling via environment variables:

```bash
# .env configuration
DATABASE_URL=postgresql://supermemory:password@localhost:5432/supermemory

# Connection pool settings
DATABASE_POOL_MIN=10          # Minimum connections to maintain
DATABASE_POOL_MAX=100         # Maximum connections allowed
DATABASE_IDLE_TIMEOUT=30000   # Close idle connections after 30 seconds (ms)
DATABASE_CONNECTION_TIMEOUT=5000  # Timeout for acquiring connection (ms)
DATABASE_STATEMENT_TIMEOUT=30000  # Timeout for query execution (ms)
```

### Recommended Settings

| Setting | Development | Production |
|---------|-------------|------------|
| Min Pool Size | 5 | 10-20 |
| Max Pool Size | 20 | 50-100 |
| Idle Timeout | 30s | 30-60s |
| Connection Timeout | 5s | 5-10s |
| Statement Timeout | 30s | 60-300s |

#### Development Configuration

```bash
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20
DATABASE_IDLE_TIMEOUT=30000
DATABASE_CONNECTION_TIMEOUT=5000
DATABASE_STATEMENT_TIMEOUT=30000
```

#### Production Configuration

```bash
DATABASE_POOL_MIN=15
DATABASE_POOL_MAX=75
DATABASE_IDLE_TIMEOUT=60000
DATABASE_CONNECTION_TIMEOUT=10000
DATABASE_STATEMENT_TIMEOUT=120000
```

### Connection Parameters

Additional connection parameters for specific scenarios:

```bash
# Application name (for monitoring)
DATABASE_APP_NAME=supermemory-api

# SSL mode (required for production)
DATABASE_SSL_MODE=require          # Require SSL connection
DATABASE_SSL_MODE=prefer           # Prefer SSL but allow non-SSL fallback
DATABASE_SSL_REJECT_UNAUTHORIZED=true

# TCP keepalive (detects stale connections)
DATABASE_TCP_KEEPALIVES=1
DATABASE_TCP_KEEPALIVES_IDLE=60
DATABASE_TCP_KEEPALIVES_INTERVAL=10
```

### Connection Pool Monitoring

Monitor connection pool usage:

```sql
-- Check active connections
SELECT
    datname,
    usename,
    application_name,
    client_addr,
    state,
    query
FROM pg_stat_activity
WHERE datname = 'supermemory'
ORDER BY pid;

-- Count connections by state
SELECT
    state,
    COUNT(*) as count
FROM pg_stat_activity
WHERE datname = 'supermemory'
GROUP BY state;

-- Find idle connections consuming resources
SELECT
    pid,
    usename,
    application_name,
    state_change,
    query
FROM pg_stat_activity
WHERE datname = 'supermemory'
  AND state = 'idle'
  AND state_change < NOW() - INTERVAL '10 minutes'
ORDER BY state_change DESC;
```

---

## Migration Procedures

### Running Migrations

Migrations set up pgvector extension, create tables, and establish HNSW indexing.

#### Using Migration Runner Script

The easiest way to run migrations:

```bash
# Make script executable (one-time)
chmod +x scripts/migrations/run_migrations.sh

# Run all migrations
./scripts/migrations/run_migrations.sh

# With custom database URL
DATABASE_URL="postgresql://user:pass@host:5432/db" ./scripts/migrations/run_migrations.sh

# With verbose output
./scripts/migrations/run_migrations.sh --verbose
```

#### Manual Migration Execution

Run migrations individually for more control:

```bash
# Set database URL
export DATABASE_URL="postgresql://supermemory:password@localhost:5432/supermemory"

# Run migrations in order
psql $DATABASE_URL -f scripts/migrations/001_create_pgvector_extension.sql
psql $DATABASE_URL -f scripts/migrations/002_create_memory_embeddings_table.sql
psql $DATABASE_URL -f scripts/migrations/003_create_hnsw_index.sql
```

#### Docker Compose Migrations

```bash
# Start PostgreSQL first
docker compose up -d postgres

# Wait for database to be ready
docker compose exec postgres pg_isready -U supermemory -d supermemory

# Run migrations using Docker
docker compose exec postgres psql -U supermemory -d supermemory \
  -f /migrations/001_create_pgvector_extension.sql

docker compose exec postgres psql -U supermemory -d supermemory \
  -f /migrations/002_create_memory_embeddings_table.sql

docker compose exec postgres psql -U supermemory -d supermemory \
  -f /migrations/003_create_hnsw_index.sql
```

### Migration Details

#### Migration 001: pgvector Extension

Enables vector support in PostgreSQL:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**What it does:**
- Enables the pgvector extension for vector data types
- Enables vector distance operators (<=>, <#>, <->)
- Enables vector indexing (HNSW)

#### Migration 002: Memory Embeddings Table

Creates the main embeddings table with vector support:

```sql
CREATE TABLE memory_embeddings (
  id UUID PRIMARY KEY,
  memory_id UUID NOT NULL,
  embedding vector(1536),
  model VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

**What it does:**
- Creates table to store embeddings
- Sets up vector column with 1536 dimensions
- Adds timestamp tracking
- Creates trigger for automatic updated_at

#### Migration 003: HNSW Index

Creates optimized HNSW index for vector similarity search:

```sql
CREATE INDEX idx_memory_embeddings_hnsw
ON memory_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**Configuration:**
- m=16: Number of connections per node
- ef_construction=64: Quality during index building
- vector_cosine_ops: Uses cosine distance metric

### SQLite to PostgreSQL Migration

If migrating from SQLite (development) to PostgreSQL (production):

#### 1. Export SQLite Data

```bash
# Export schema
sqlite3 supermemory.db ".schema" > schema.sql

# Export data as SQL statements
sqlite3 supermemory.db ".mode insert" > data.sql
sqlite3 supermemory.db "SELECT * FROM memory_embeddings;" > embeddings.sql
```

#### 2. Transform for PostgreSQL

```bash
# Update SQLite SQL for PostgreSQL compatibility
sed 's/AUTOINCREMENT/SERIAL/g' schema.sql > schema_pg.sql
sed 's/"timestamp"/"TIMESTAMPTZ"/g' schema_pg.sql > schema_pg_fixed.sql
```

#### 3. Load into PostgreSQL

```bash
# Create schema
psql $DATABASE_URL < schema_pg_fixed.sql

# Load embeddings data
psql $DATABASE_URL -c "
  COPY memory_embeddings (id, memory_id, embedding, model, created_at, updated_at)
  FROM STDIN;
" < embeddings_pg.sql

# Analyze for query optimization
psql $DATABASE_URL -c "ANALYZE memory_embeddings;"
```

### Rollback Procedures

#### Rollback HNSW Index (Migration 003)

```sql
-- Drop index and helper functions
DROP INDEX IF EXISTS idx_memory_embeddings_hnsw;
DROP FUNCTION IF EXISTS set_hnsw_search_quality(TEXT);
DROP FUNCTION IF EXISTS validate_hnsw_performance(vector, INTEGER);

-- Verify rollback
SELECT indexname FROM pg_indexes WHERE tablename = 'memory_embeddings';
-- Should not show idx_memory_embeddings_hnsw
```

#### Rollback Embeddings Table (Migration 002)

```sql
-- Drop trigger and function
DROP TRIGGER IF EXISTS trg_memory_embeddings_updated_at ON memory_embeddings;
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop table (cascades to dependent objects)
DROP TABLE IF EXISTS memory_embeddings CASCADE;

-- Verify rollback
\dt memory_embeddings
-- Should return "No relations found"
```

#### Rollback pgvector Extension (Migration 001)

```sql
-- WARNING: This will break all vector functionality
-- Only do this if you want to completely remove vector support

DROP EXTENSION IF EXISTS vector CASCADE;

-- Verify rollback
SELECT * FROM pg_available_extensions WHERE name = 'vector';
```

---

## Verification Steps

Complete verification checklist after setup:

### 1. PostgreSQL Running

```bash
# Check if PostgreSQL is running
docker compose ps postgres
# or
psql --version

# Check database accessibility
psql -U supermemory -d supermemory -c "SELECT 1;"
```

### 2. pgvector Extension Installed

```bash
# Verify extension is installed
psql -U supermemory -d supermemory -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# Expected output:
#  extname | extowner | extnamespace | extrelocatable | extversion
# ---------+----------+--------------+----------------+------------
#  vector  |       10 |         2200 | t              | 0.5.1
```

### 3. Migrations Applied

Check that all tables and indexes exist:

```bash
# List tables
psql -U supermemory -d supermemory -c "\dt"

# Expected output should include:
#              List of relations
#  Schema |        Name         | Type  |    Owner
# --------+---------------------+-------+-------------
#  public | memory_embeddings   | table | supermemory

# Check indexes
psql -U supermemory -d supermemory -c "\di"

# Expected output should include:
#                         List of relations
#  Schema |              Name              | Type  |    Owner    |      Table
# --------+--------------------------------+-------+-------------+---------------------
#  public | idx_memory_embeddings_hnsw     | index | supermemory | memory_embeddings
```

### 4. Vector Support Working

Test vector operations:

```bash
# Connect to database
psql -U supermemory -d supermemory

# Test vector type
supermemory=# SELECT '[1,2,3]'::vector;
#   vector
# -----------
#  [1,2,3]

# Test distance operator
supermemory=# SELECT '[1,2,3]'::vector <=> '[4,5,6]'::vector;
#   ?column?
# ----------
#  0.025368...
```

### 5. HNSW Index Verified

```bash
# Check index definition
psql -U supermemory -d supermemory -c "
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE indexname = 'idx_memory_embeddings_hnsw';
"

# Expected output:
#             indexname            |                  indexdef
# --------------------------------+--------------------------------------------------
#  idx_memory_embeddings_hnsw     | CREATE INDEX idx_memory_embeddings_hnsw
#                                 | ON public.memory_embeddings
#                                 | USING hnsw (embedding vector_cosine_ops)
#                                 | WITH (m='16', ef_construction='64')
```

### 6. Connection Pool Configured

```bash
# Verify environment variables
echo $DATABASE_POOL_MIN
echo $DATABASE_POOL_MAX
echo $DATABASE_IDLE_TIMEOUT

# Test connection with pool
psql -U supermemory -d supermemory -c "SELECT current_user, current_database();"
```

### 7. Run Test Suite

```bash
# Execute comprehensive tests
psql -U supermemory -d supermemory -f scripts/migrations/test_hnsw_index.sql

# With Docker
docker compose exec postgres psql -U supermemory -d supermemory \
  -f /migrations/test_hnsw_index.sql
```

### Complete Verification Script

Create a script to run all verification steps:

```bash
#!/bin/bash
# verify-database.sh

set -e

echo "=== Database Verification ==="

# 1. PostgreSQL Running
echo "1. Checking PostgreSQL..."
if psql -U supermemory -d supermemory -c "SELECT 1;" > /dev/null; then
  echo "   ✓ PostgreSQL is running"
else
  echo "   ✗ PostgreSQL is not accessible"
  exit 1
fi

# 2. pgvector Extension
echo "2. Checking pgvector extension..."
if psql -U supermemory -d supermemory -c "SELECT * FROM pg_extension WHERE extname = 'vector';" | grep -q vector; then
  echo "   ✓ pgvector extension installed"
else
  echo "   ✗ pgvector extension not found"
  exit 1
fi

# 3. Tables
echo "3. Checking tables..."
if psql -U supermemory -d supermemory -c "\dt memory_embeddings" | grep -q memory_embeddings; then
  echo "   ✓ memory_embeddings table exists"
else
  echo "   ✗ memory_embeddings table not found"
  exit 1
fi

# 4. Indexes
echo "4. Checking HNSW index..."
if psql -U supermemory -d supermemory -c "\di idx_memory_embeddings_hnsw" | grep -q hnsw; then
  echo "   ✓ HNSW index exists"
else
  echo "   ✗ HNSW index not found"
  exit 1
fi

# 5. Vector Support
echo "5. Testing vector operations..."
if psql -U supermemory -d supermemory -c "SELECT '[1,2,3]'::vector;" > /dev/null; then
  echo "   ✓ Vector operations working"
else
  echo "   ✗ Vector operations failed"
  exit 1
fi

echo ""
echo "=== All Checks Passed ==="
```

---

## Troubleshooting

### PostgreSQL Connection Issues

#### Error: "could not translate host name to address"

```
psql: error: could not translate host name "postgres" to address: nodename nor servname provided
```

**Solutions:**

1. For Docker: Ensure services are on the same network
   ```bash
   docker compose ps
   docker network ls | grep supermemory
   ```

2. For local: Verify PostgreSQL is running
   ```bash
   psql --version
   brew services list | grep postgres
   ```

3. Check connection string
   ```bash
   echo $DATABASE_URL
   # Should be: postgresql://user:password@host:port/database
   ```

#### Error: "role 'supermemory' does not exist"

```
psql: error: FATAL:  role "supermemory" does not exist
```

**Solution:**

```bash
# Create missing user (as superuser)
sudo -u postgres psql -c "CREATE USER supermemory WITH PASSWORD 'password';"

# Or with Docker
docker compose exec postgres psql -U postgres -c \
  "CREATE USER supermemory WITH PASSWORD 'supermemory_secret';"
```

#### Error: "database 'supermemory' does not exist"

**Solution:**

```bash
# Create database
sudo -u postgres psql -c "CREATE DATABASE supermemory;"

# Or with Docker
docker compose exec postgres psql -U postgres -c \
  "CREATE DATABASE supermemory;"
```

### pgvector Extension Issues

#### Error: "extension 'vector' is not available"

```
ERROR: extension "vector" is not available
HINT: Install the postgresql-<version>-pgvector package
```

**Solution:**

**macOS:**
```bash
brew install pgvector
brew services restart postgresql@16
```

**Ubuntu:**
```bash
sudo apt install postgresql-16-pgvector
sudo systemctl restart postgresql
```

**Docker:** Use pgvector image
```bash
# Ensure using pgvector image in docker-compose.yml
image: pgvector/pgvector:pg16
```

### Migration Issues

#### Migration Fails with "Extension Already Exists"

```
ERROR: extension "vector" already exists
```

**Solution:** This is expected on re-run. Use `IF NOT EXISTS`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

#### Table Already Exists Error

**Solution:** Use `IF NOT EXISTS` in migration:

```sql
CREATE TABLE IF NOT EXISTS memory_embeddings (...);
```

#### Index Creation Fails

```
ERROR: index "idx_memory_embeddings_hnsw" already exists
```

**Solution:** Drop before recreating or use `IF NOT EXISTS`:

```sql
DROP INDEX IF EXISTS idx_memory_embeddings_hnsw;
CREATE INDEX idx_memory_embeddings_hnsw ...;
```

### Connection Pool Issues

#### "sorry, too many clients already"

```
FATAL: remaining connection slots are reserved for non-replication superuser connections
```

**Solutions:**

1. Reduce pool size:
   ```bash
   DATABASE_POOL_MAX=50
   ```

2. Increase PostgreSQL max_connections:
   ```bash
   # In postgresql.conf
   max_connections = 200
   ```

3. Close idle connections:
   ```bash
   # Set shorter idle timeout
   DATABASE_IDLE_TIMEOUT=10000  # 10 seconds
   ```

4. Monitor connections:
   ```sql
   SELECT count(*) FROM pg_stat_activity;
   ```

### HNSW Index Issues

#### Index Not Being Used for Queries

```bash
# Check query plan
EXPLAIN SELECT ... ORDER BY embedding <=> $1::vector LIMIT 10;
```

If shows "Seq Scan" instead of "Index Scan":

1. Check index exists:
   ```sql
   \di idx_memory_embeddings_hnsw
   ```

2. Ensure vector dimensions match:
   ```sql
   SELECT DISTINCT vector_dims(embedding) FROM memory_embeddings;
   ```

3. Update statistics:
   ```sql
   ANALYZE memory_embeddings;
   ```

#### Slow Vector Search Performance

**Solutions:**

1. Increase ef_search:
   ```bash
   DATABASE_HNSW_EF_SEARCH=200
   ```

2. Verify index health:
   ```sql
   SELECT pg_size_pretty(pg_relation_size('idx_memory_embeddings_hnsw'));
   ```

3. Check query plan cost:
   ```sql
   EXPLAIN ANALYZE SELECT ... ORDER BY embedding <=> $1::vector LIMIT 10;
   ```

---

## Performance Tuning

### Search Quality Adjustment

Tune search quality vs. performance tradeoff:

```bash
# Set environment variable
export HNSW_EF_SEARCH=100

# Or in .env file
HNSW_EF_SEARCH=100  # Default: balanced (99% recall)
```

#### Quality Levels

| Level | ef_search | Recall | Speed | Use Case |
|-------|-----------|--------|-------|----------|
| Fast | 40 | ~95% | Fastest | Real-time, high-volume |
| Balanced | 100 | ~99% | Balanced | **Default, recommended** |
| Accurate | 200 | ~99.5%+ | Slower | Critical accuracy needs |

#### Dynamic Adjustment in Queries

```sql
-- Set for specific query
SET LOCAL hnsw.ef_search = 200;
SELECT ... ORDER BY embedding <=> $1::vector LIMIT 10;
-- Resets after transaction
```

### Index Configuration

Current HNSW parameters (set during migration):

| Parameter | Value | Meaning |
|-----------|-------|---------|
| m | 16 | Connections per node |
| ef_construction | 64 | Build quality |
| ef_search | 100 | Search quality |

To optimize for different workloads, rebuild index:

```sql
-- Rebuild with different parameters
DROP INDEX idx_memory_embeddings_hnsw;
CREATE INDEX idx_memory_embeddings_hnsw
ON memory_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 128);  -- Increased quality

-- Update statistics
ANALYZE memory_embeddings;
```

### Query Optimization

#### Optimal Query Pattern

```sql
EXPLAIN ANALYZE
SELECT
    id,
    1 - (embedding <=> $1::vector) as similarity,
    memory_id
FROM memory_embeddings
WHERE 1 - (embedding <=> $1::vector) > 0.7
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

**Expected plan includes:**
```
Index Scan using idx_memory_embeddings_hnsw on memory_embeddings
```

#### Query Patterns to Avoid

**Don't use dot product for normalized vectors:**
```sql
-- Bad: Uses sequential scan
SELECT id FROM memory_embeddings
ORDER BY embedding <#> $1::vector;
```

**Don't use complex expressions in ORDER BY:**
```sql
-- Bad: May not use index
SELECT id FROM memory_embeddings
ORDER BY (1 - (embedding <=> $1::vector)) DESC;

-- Good: Simple distance
SELECT id FROM memory_embeddings
ORDER BY embedding <=> $1::vector;
```

### Connection Pool Tuning

Adjust pool sizes based on workload:

```bash
# High concurrency (many users)
DATABASE_POOL_MIN=20
DATABASE_POOL_MAX=100

# Low concurrency (batch processing)
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20

# Very high concurrency (shared service)
DATABASE_POOL_MIN=50
DATABASE_POOL_MAX=150
```

### Resource Allocation

Tune PostgreSQL for better performance:

```sql
-- Increase shared buffers (1/4 of system RAM)
ALTER SYSTEM SET shared_buffers = '8GB';

-- Increase work memory for sorting
ALTER SYSTEM SET work_mem = '256MB';

-- Increase maintenance work memory
ALTER SYSTEM SET maintenance_work_mem = '2GB';

-- Apply changes
SELECT pg_reload_conf();
```

---

## Monitoring

### Active Connections

```sql
-- Check current connections
SELECT
    pid,
    usename,
    application_name,
    state,
    query_start,
    query
FROM pg_stat_activity
WHERE datname = 'supermemory'
ORDER BY query_start DESC;
```

### Index Statistics

```sql
-- Check index usage
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE indexrelname = 'idx_memory_embeddings_hnsw';
```

### Query Performance

```sql
-- Enable query logging
ALTER DATABASE supermemory SET log_min_duration_statement = 1000;  -- Log queries > 1s

-- View slow queries
SELECT
    query,
    calls,
    total_time,
    mean_time
FROM pg_stat_statements
WHERE query LIKE '%memory_embeddings%'
ORDER BY mean_time DESC;
```

### Database Size

```sql
-- Overall database size
SELECT
    datname,
    pg_size_pretty(pg_database_size(datname))
FROM pg_database
WHERE datname = 'supermemory';

-- Table size
SELECT
    pg_size_pretty(pg_total_relation_size('memory_embeddings')) as total_size,
    pg_size_pretty(pg_relation_size('memory_embeddings')) as table_size,
    pg_size_pretty(pg_indexes_size('memory_embeddings')) as indexes_size;
```

### Vector Count

```sql
-- Count embeddings
SELECT COUNT(*) FROM memory_embeddings;

-- Count by model
SELECT model, COUNT(*) FROM memory_embeddings GROUP BY model;

-- Storage per embedding
SELECT
    COUNT(*) as total_embeddings,
    pg_size_pretty(AVG(pg_column_size(embedding))) as avg_embedding_size;
```

---

## Related Documentation

- **[Database Quick Start](./database-quickstart.md)** - Get started quickly with Docker
- **[Database Performance](./database-performance.md)** - Performance benchmarks and tuning
- **[Migration Scripts](../scripts/migrations/README.md)** - Technical migration details
- **[pgvector GitHub](https://github.com/pgvector/pgvector)** - Official pgvector documentation
- **[PostgreSQL Docs](https://www.postgresql.org/docs/16/)** - PostgreSQL 16 documentation

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-02 | 1.0.0 | Complete database setup guide with Docker, local setup, pooling, and troubleshooting |

---

**Note**: This guide covers PostgreSQL 16 with pgvector 0.5.0+. For older versions, refer to version-specific documentation.

For issues or questions, check the troubleshooting section above or open an issue on GitHub.
