# Supermemory Clone

Local-first AI memory service with PostgreSQL + pgvector for semantic search. Designed for AI agents and personal knowledge management.

## What it is

- Local-first memory storage and retrieval
- Semantic search via pgvector (HNSW)
- Multi-tenant isolation with container tags
- Optional LLM extraction (OpenAI/Anthropic)
- MCP server for agent integrations

## Quick links

- Dev environment: [`docs/dev-environment-setup.md`](./docs/dev-environment-setup.md)
- Database setup: [`docs/database-setup.md`](./docs/database-setup.md)
- Migrations: [`scripts/migrations/README.md`](./scripts/migrations/README.md)
- Database schema: [`src/db/schema/README.md`](./src/db/schema/README.md)
- Workers: [`src/workers/README.md`](./src/workers/README.md)
- API design: [`docs/api-design.md`](./docs/api-design.md)
- Production deployment: [`docs/PRODUCTION-DEPLOYMENT-GUIDE.md`](./docs/PRODUCTION-DEPLOYMENT-GUIDE.md)
- Database tests: [`tests/database/README.md`](./tests/database/README.md)
- Documentation archive: [`docs/archive/README.md`](./docs/archive/README.md)

## Requirements

- Node.js 20+
- PostgreSQL 16+ with pgvector
- Docker (optional, recommended for local DB)

## Quick start (local)

```bash
git clone <repo>
cd supermemory-clone
npm install

npm run setup

docker compose up -d postgres

./scripts/migrations/run_migrations.sh

npm run doctor
npm run dev
curl http://localhost:3000/health
```

## Configuration (essentials)

Set values in `.env` (see `.env.example` for the full list).

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/supermemory
API_HOST=localhost
API_PORT=3000
AUTH_ENABLED=false
AUTH_TOKEN=
CSRF_SECRET=your-random-secret
OPENAI_API_KEY=sk-...              # Optional: embeddings
LLM_PROVIDER=openai|anthropic      # Optional: LLM extraction
ANTHROPIC_API_KEY=sk-ant-...       # Optional
REDIS_URL=redis://localhost:6379   # Required for BullMQ workers
```

Notes:

- Runtime requires PostgreSQL; SQLite is only used in tests (`NODE_ENV=test`).
- If `AUTH_ENABLED=false`, API auth is disabled (recommended for trusted local networks).
- If Redis is unavailable, API ingestion falls back to inline memory extraction/indexing.

## Feature modes

- **Local-only**: pattern-based extraction, no external API keys
- **Embeddings enabled**: semantic search via OpenAI embeddings
- **LLM extraction**: OpenAI/Anthropic for richer extraction

## Development

```bash
npm run dev
npm test
```

## Coding agent setup (MCP)

```bash
npm run build
claude mcp add supermemory -- node /absolute/path/to/supermemory-clone/dist/mcp/index.js
```

Or use `mcp-config.json` and point your agent to this repo root. No API keys are required for local-only mode.

## License

MIT
