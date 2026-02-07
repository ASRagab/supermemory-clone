# Database Test Suite

Database-level tests for triggers, functions, and pgvector behavior.

## Quick start (automated)

```bash
./scripts/run-phase1-tests.sh

# Keep the test DB for inspection
./scripts/run-phase1-tests.sh --keep-db

# Verbose output
./scripts/run-phase1-tests.sh --verbose
```

## Manual run

```bash
createdb supermemory_test
psql supermemory_test -c "CREATE EXTENSION vector;"

psql supermemory_test -f scripts/migrations/001_create_pgvector_extension.sql
psql supermemory_test -f scripts/migrations/002_create_memory_embeddings_table.sql
psql supermemory_test -f scripts/migrations/003_create_hnsw_index.sql

psql supermemory_test -f tests/database/phase1-triggers-functions.test.sql
dropdb supermemory_test
```

## Expected output

All tests should emit `TEST PASSED` notices and complete without errors.

## Troubleshooting (short list)

- **pgvector not available**: install pgvector and enable the extension.
- **relation does not exist**: run migrations before the test.
- **slow vector queries**: verify the HNSW index is present.

For detailed setup and performance tuning, see the database setup and migration guides.

## Related documentation

- Database setup: [`docs/database-setup.md`](../../docs/database-setup.md)
- Migrations: [`scripts/migrations/README.md`](../../scripts/migrations/README.md)
- Schema: [`src/db/schema/README.md`](../../src/db/schema/README.md)
