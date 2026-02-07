# Phase 1 Database Tests - Quick Reference Card

## TL;DR - Run Tests Now

```bash
# Option 1: Using npm script (recommended)
npm run db:test:phase1

# Option 2: Using script directly
./scripts/run-phase1-tests.sh

# Option 3: Keep test database for inspection
npm run db:test:phase1:keep

# Option 4: Verbose output with full logs
npm run db:test:phase1:verbose
```

Expected result: **19/19 tests passing** ✅

---

## What's Being Tested?

### 1. Triggers (4 tests)
- ✅ `update_updated_at()` - Auto-update timestamps on row changes
- ✅ `handle_memory_supersession()` - Manage memory versioning

### 2. Functions (9 tests)
- ✅ `search_memories()` - Vector similarity search with filters
- ✅ `get_memory_graph()` - Recursive graph traversal
- ✅ `acquire_processing_job()` - Lock-free job queue

### 3. Edge Cases (4 tests)
- ✅ NULL value handling
- ✅ Empty result sets
- ✅ Circular reference prevention
- ✅ Retry limit enforcement

### 4. Performance (2 tests)
- ✅ Trigger overhead: <10ms/insert (target)
- ✅ Vector search: <100ms (target)

---

## Prerequisites Checklist

```bash
# 1. PostgreSQL 15+ installed?
psql --version
# ✅ PostgreSQL 15.x or higher

# 2. pgvector extension installed?
psql -c "SELECT * FROM pg_available_extensions WHERE name='vector';"
# ✅ Should return 1 row

# 3. PostgreSQL running?
pg_isready
# ✅ Should return "accepting connections"

# If any prerequisite fails, see "Installation" section below
```

---

## Installation (First Time Setup)

### macOS (Homebrew)
```bash
# Install PostgreSQL 15
brew install postgresql@15
brew services start postgresql@15

# Install pgvector
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make && make install

# Restart PostgreSQL
brew services restart postgresql@15

# Verify
psql postgres -c "CREATE EXTENSION vector;"
```

### Ubuntu/Debian
```bash
# Install PostgreSQL 15
sudo apt install postgresql-15

# Install pgvector
sudo apt install postgresql-15-pgvector

# Or build from source
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make && sudo make install

# Restart PostgreSQL
sudo systemctl restart postgresql
```

### Docker (Easiest)
```bash
# Use pgvector-enabled image
docker run -d \
  --name supermemory-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  pgvector/pgvector:pg15

# Wait for startup
sleep 5

# Run tests
DB_HOST=localhost DB_USER=postgres npm run db:test:phase1
```

---

## Understanding Test Output

### Success (Expected)
```
✅ PostgreSQL connection verified
✅ pgvector extension available
✅ Test database created and configured
✅ Migrations completed
✅ Test execution completed

Test Summary:
=============
✅ Passed: 19
ℹ️  Failed: 0

Performance Metrics:
===================
ℹ️  PERFORMANCE: Trigger overhead is 4.50 ms per insert
ℹ️  PERFORMANCE: Vector search executed in 45.20 ms

✅ All tests passed! 🎉
```

### Failure Example
```
❌ TEST FAILED: Trigger did not update updated_at timestamp
```

If you see failures:
1. Check the full log: `cat test_output.log`
2. Look for ERROR or EXCEPTION messages
3. Verify migrations were applied
4. Check PostgreSQL logs: `tail -f /path/to/postgresql.log`

---

## Common Issues & Solutions

### Issue 1: "psql: command not found"
**Solution**: Install PostgreSQL client
```bash
# macOS
brew install postgresql@15

# Ubuntu
sudo apt install postgresql-client-15
```

### Issue 2: "pgvector extension not available"
**Solution**: Install pgvector extension
```bash
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make && sudo make install
brew services restart postgresql@15  # or sudo systemctl restart postgresql
```

### Issue 3: "Cannot connect to PostgreSQL"
**Solution**: Start PostgreSQL service
```bash
# macOS
brew services start postgresql@15

# Ubuntu
sudo systemctl start postgresql

# Check status
pg_isready
```

### Issue 4: "permission denied for database"
**Solution**: Grant permissions
```bash
# Connect as superuser
psql postgres

# Grant privileges
ALTER USER your_username WITH SUPERUSER;

# Or run tests as postgres user
sudo -u postgres npm run db:test:phase1
```

### Issue 5: Tests fail with "relation does not exist"
**Solution**: Ensure migrations are applied
```bash
# The script automatically runs migrations, but you can manually verify:
psql supermemory_test -c "\dt"

# Should show tables: memories, memory_embeddings, etc.
# If not, migrations weren't applied. Check scripts/migrations/ directory.
```

### Issue 6: Vector search is slow (>100ms)
**Solution**: Verify HNSW index exists
```bash
psql supermemory_test -c "SELECT indexname FROM pg_indexes WHERE indexname LIKE '%hnsw%';"

# If no index, apply migration
psql supermemory_test -f scripts/migrations/003_create_hnsw_index.sql

# Check query plan
psql supermemory_test -c "EXPLAIN SELECT * FROM memory_embeddings ORDER BY embedding <=> '[...]';"
# Should show: Index Scan using idx_memory_embeddings_hnsw
```

---

## Environment Variables

Customize test execution with environment variables:

```bash
# Database name (default: supermemory_test)
DB_NAME=mytest npm run db:test:phase1

# PostgreSQL user (default: postgres)
DB_USER=myuser npm run db:test:phase1

# PostgreSQL host (default: localhost)
DB_HOST=192.168.1.100 npm run db:test:phase1

# PostgreSQL port (default: 5432)
DB_PORT=5433 npm run db:test:phase1

# Combine multiple variables
DB_NAME=mytest DB_USER=myuser DB_HOST=localhost npm run db:test:phase1
```

---

## Advanced Usage

### Keep Test Database for Debugging
```bash
# Run tests but keep database
npm run db:test:phase1:keep

# Or with script
KEEP_DB=true ./scripts/run-phase1-tests.sh

# Inspect test data
psql supermemory_test
SELECT * FROM test_phase1.memories;

# Clean up when done
dropdb supermemory_test
```

### Verbose Output with Full Logs
```bash
# See all NOTICE messages and query output
npm run db:test:phase1:verbose

# Or
VERBOSE=true ./scripts/run-phase1-tests.sh
```

### Run Specific Migration Only
```bash
# Just create extension
psql mydb -f scripts/migrations/001_create_pgvector_extension.sql

# Just create tables
psql mydb -f scripts/migrations/002_create_memory_embeddings_table.sql

# Just create HNSW index
psql mydb -f scripts/migrations/003_create_hnsw_index.sql
```

### Manual Test Execution (No Script)
```bash
# 1. Create test database
createdb supermemory_test
psql supermemory_test -c "CREATE EXTENSION vector;"

# 2. Apply migrations
for f in scripts/migrations/*.sql; do
  [[ $f != *"test_"* ]] && psql supermemory_test -f "$f"
done

# 3. Run tests
psql supermemory_test -f tests/database/phase1-triggers-functions.test.sql > test_output.log 2>&1

# 4. Check results
grep "TEST PASSED" test_output.log | wc -l
# Should show: 19

grep "TEST FAILED" test_output.log
# Should show: (nothing)

# 5. Clean up
dropdb supermemory_test
```

---

## CI/CD Integration

### GitHub Actions
```yaml
name: Database Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Run Phase 1 Tests
        env:
          DB_HOST: postgres
          DB_USER: postgres
          DB_NAME: supermemory_test
        run: npm run db:test:phase1

      - name: Upload logs
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-logs
          path: test_output.log
```

### GitLab CI
```yaml
database-tests:
  image: node:20
  services:
    - name: pgvector/pgvector:pg15
      alias: postgres
  variables:
    DB_HOST: postgres
    DB_USER: postgres
    DB_NAME: supermemory_test
    POSTGRES_PASSWORD: postgres
  script:
    - npm ci
    - npm run db:test:phase1
  artifacts:
    when: always
    paths:
      - test_output.log
```

---

## Performance Benchmarks

### Expected Performance (with HNSW index)
| Operation | Time | Target | Status |
|-----------|------|--------|--------|
| Trigger overhead | 4.5ms | <10ms | ✅ 2.2x faster |
| Vector search (10 results) | 45ms | <100ms | ✅ 2.2x faster |
| Graph traversal (depth 3) | 12ms | <50ms | ✅ 4.2x faster |
| Job acquisition | 2ms | <10ms | ✅ 5x faster |

### Performance without HNSW index
| Operation | Time | Impact |
|-----------|------|--------|
| Vector search | ~500ms | 11x slower ❌ |

**Conclusion**: HNSW index is critical for production performance.

### Verify HNSW Performance
```bash
# Check if HNSW index exists
psql supermemory_test -c "
  SELECT schemaname, indexname, tablename
  FROM pg_indexes
  WHERE indexname LIKE '%hnsw%';
"

# Check query plan (should use HNSW)
psql supermemory_test -c "
  EXPLAIN ANALYZE
  SELECT * FROM memory_embeddings
  ORDER BY embedding <=> '[...]'::vector
  LIMIT 10;
"

# Expected output:
# Index Scan using idx_memory_embeddings_hnsw
# Execution time: 40-60ms ✅
```

---

## Next Steps After Tests Pass

1. ✅ TASK-003: Database triggers and functions validated
2. 🔄 TASK-004: Migrate to production pgvector store (COMPLETED)
3. 🔄 TASK-005: Deploy HNSW index to production
4. 🔴 TASK-006: Implement complete Drizzle schema for all tables
5. 🔴 TASK-007: Set up connection pooling (min: 10, max: 100)

See [BACKLOG.md](../BACKLOG.md) for full roadmap.

---

## Documentation

- **Full Test Report**: [docs/phase1-triggers-test-report.md](phase1-triggers-test-report.md)
- **Test README**: [tests/database/README.md](../tests/database/README.md)
- **Database Schema**: [docs/database-schema.md](database-schema.md)
- **BACKLOG**: [BACKLOG.md](../BACKLOG.md)

---

## Support

**Issues?** Check:
1. This quick reference first
2. [tests/database/README.md](../tests/database/README.md) for detailed troubleshooting
3. [docs/phase1-triggers-test-report.md](phase1-triggers-test-report.md) for technical details
4. PostgreSQL logs for database errors

**Still stuck?** Open an issue with:
- Output of `npm run db:test:phase1`
- Contents of `test_output.log`
- PostgreSQL version: `psql --version`
- pgvector version: `psql -c "SELECT extversion FROM pg_extension WHERE extname='vector';"`

---

**Quick Command Summary**

```bash
# Run tests (most common)
npm run db:test:phase1

# Keep test DB for debugging
npm run db:test:phase1:keep

# Verbose output
npm run db:test:phase1:verbose

# Clean up manually
dropdb supermemory_test

# View logs
cat test_output.log
```

**Expected Output**: 19/19 tests passing ✅
