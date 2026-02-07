# Workers

Background processing pipeline built on BullMQ. Workers consume queued jobs to extract, chunk, embed, and index documents.

## Pipeline flow

```
Extraction → Chunking → Embedding → Indexing
```

## Workers

| Worker     | File                   | Queue        | Purpose                                   |
| ---------- | ---------------------- | ------------ | ----------------------------------------- |
| Extraction | `extraction.worker.ts` | `extraction` | Extract text/metadata from documents      |
| Chunking   | `chunking.worker.ts`   | `chunking`   | Split text into chunks                    |
| Embedding  | `embedding.worker.ts`  | `embedding`  | Generate vector embeddings                |
| Indexing   | `indexing.worker.ts`   | `indexing`   | Store memories, dedupe, and relationships |

## Configuration

Workers require:

- PostgreSQL connection (`DATABASE_URL`)
- Redis for BullMQ (`REDIS_URL`)
- OpenAI API key for embeddings (`OPENAI_API_KEY`, optional if embeddings disabled)

See `.env.example` and the root [`README.md`](../../README.md) for the full list.

## Running workers

Workers are instantiated via the `create*Worker` helpers in each file. Ensure Redis is running and migrations are applied before starting workers.

## Testing

```bash
npm test tests/workers/extraction.worker.test.ts
npm test tests/workers/chunking.worker.test.ts
npm test tests/workers/embedding.worker.test.ts
npm test tests/workers/indexing.worker.test.ts
```

## Related documentation

- Database setup: [`docs/database-setup.md`](../../docs/database-setup.md)
- Migrations: [`scripts/migrations/README.md`](../../scripts/migrations/README.md)
- Schema: [`src/db/schema/README.md`](../db/schema/README.md)
