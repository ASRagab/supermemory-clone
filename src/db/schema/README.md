# PostgreSQL Database Schema

Drizzle ORM schema definitions for the Supermemory PostgreSQL database.

## Schema files

| File                      | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `containers.schema.ts`    | Container tags for multi-tenant isolation        |
| `documents.schema.ts`     | Raw uploaded documents                           |
| `memories.schema.ts`      | Extracted knowledge units with versioning        |
| `embeddings.schema.ts`    | Vector embeddings for semantic search (pgvector) |
| `relationships.schema.ts` | Knowledge graph edges between memories           |
| `profiles.schema.ts`      | Aggregated user knowledge and preferences        |
| `queue.schema.ts`         | Async job management for the processing pipeline |
| `index.ts`                | Exports all schema definitions                   |

## Key concepts

- **Memory versioning**: immutable memories with `is_latest`, `supersedes_id`, and `version` tracking.
- **Multi-tenancy**: `container_tag` on key tables for isolation.
- **Vector search**: `memory_embeddings` uses pgvector + HNSW for fast similarity search.

## Migrations & setup

- Migrations: [`scripts/migrations/README.md`](../../../scripts/migrations/README.md)
- Database setup: [`docs/database-setup.md`](../../../docs/database-setup.md)

## Testing & verification

- Database tests: [`tests/database/README.md`](../../../tests/database/README.md)

## Constraints (high level)

- `container_tags.tag` must match `^[a-zA-Z0-9_-]+$`
- `documents.status`: pending | processing | processed | failed | archived
- `memories.memory_type`: fact | preference | episode | belief | skill | context
- `memory_relationships` prevents self-loops and enforces unique edges

## References

- [Database schema overview](../../../docs/database-schema.md)
- [pgvector documentation](https://github.com/pgvector/pgvector)
- [Drizzle ORM PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)
