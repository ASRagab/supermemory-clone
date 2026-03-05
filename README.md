# Supermemory Clone

Local-first memory service for developers and coding agents.

It stores documents, extracts memories, indexes embeddings, and serves search/profile APIs plus an MCP server for agent workflows.

## What It Does

- Ingests text and files into documents.
- Extracts memory units and profile facts.
- Supports semantic, memory, and hybrid search.
- Exposes REST API (`/api/v1/*`) and MCP tools (`supermemory_*`).
- Runs with PostgreSQL + pgvector; Redis is optional (queue path) because inline fallback is built in.

## Architecture (High Level)

- `src/index.ts`: Hono API server, middleware stack, route mounting.
- `src/api/routes/*`: documents, search, profiles endpoints.
- `src/services/*`: document processing, memory extraction, search, profile logic.
- `src/mcp/*`: MCP server, tools, resources, rate limiting.
- `src/db/*`: database client routing (PostgreSQL in runtime; SQLite only for tests).
- `src/queues/*` + `src/workers/*`: BullMQ pipeline (`extraction -> chunking -> embedding -> indexing`).

## Requirements

- Node.js >= 20
- PostgreSQL with pgvector
- Redis (optional but recommended for async workers)

## Quick Start (Turnkey)

```bash
git clone <repo-url>
cd supermemory-clone
npm install
npm run setup

# Start dependencies (minimum: postgres)
docker compose up -d postgres redis

# Apply SQL migrations
./scripts/migrations/run_migrations.sh

# Validate env + connectivity
npm run doctor

# Start API
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## Configuration

Copy `.env.example` to `.env` and set values.

Required:

- `DATABASE_URL` (must be `postgres://` or `postgresql://` outside tests)

Optional:

- `AUTH_ENABLED`, `AUTH_TOKEN` (minimal bearer token auth)
- `REDIS_URL` (queues; if unavailable, ingestion falls back inline)
- `OPENAI_API_KEY` (embeddings)
- `LLM_PROVIDER`, `ANTHROPIC_API_KEY` (LLM extraction)
- `CSRF_SECRET`, `ALLOWED_ORIGINS` (hardening)

No external API keys are required for basic local operation.

## Auth and CSRF

- API auth is optional.
- `AUTH_ENABLED=false` (default): pass-through auth context.
- `AUTH_ENABLED=true`: requires `Authorization: Bearer <AUTH_TOKEN>`.
- CSRF protection is applied to API state-changing routes; use `GET /api/v1/csrf-token` first for browser clients.

## REST API Surface

Base path: `/api/v1`

- `POST /documents`
- `GET /documents`
- `GET /documents/:id`
- `PUT /documents/:id`
- `DELETE /documents/:id`
- `POST /documents/file`
- `POST /documents/bulk-delete`
- `POST /search`
- `GET /profiles`
- `GET /profiles/:tag`
- `PUT /profiles/:tag`
- `DELETE /profiles/:tag`

## MCP for Coding Agents

### Quick Setup

Run the one-command setup (builds if needed and registers with Claude Code):

```bash
npm run mcp:setup
```

### Installation Options

**Option A — Project auto-discovery (recommended for teams)**

The repo ships a `.mcp.json` that Claude Code auto-discovers when you open the
project. Just make sure the project is built:

```bash
npm run build
```

**Option B — Manual registration**

```bash
npm run build
claude mcp add supermemory -- node "$(pwd)/dist/mcp/index.js"
```

**Option C — npx (after package is published)**

```bash
claude mcp add supermemory -- npx supermemory-mcp
```

### Prerequisites

- Node.js >= 20
- PostgreSQL with pgvector running (`docker compose up -d postgres`)
- Project built (`npm run build`)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | No | Enables embeddings and LLM features |
| `REDIS_URL` | No | Enables async queue workers |
| `LOG_LEVEL` | No | Logging verbosity (default: `info`) |

### Verification

```bash
npm run doctor        # checks env, DB, Redis, MCP build & registration
claude mcp list       # confirm supermemory appears
```

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `dist/mcp/index.js` not found | Run `npm run build` |
| PostgreSQL connection refused | Start the container: `docker compose up -d postgres` |
| Port already in use | Check `API_PORT` in `.env` (default 13000) |
| MCP tools not appearing | Re-register: `npm run mcp:setup` |

### MCP Tools

- `supermemory_add`
- `supermemory_search`
- `supermemory_profile`
- `supermemory_list`
- `supermemory_delete`
- `supermemory_remember`
- `supermemory_recall`

## Development Commands

- `npm run dev` - API with watch mode
- `npm run build` - TypeScript build
- `npm run start` - Run built API
- `npm run mcp:dev` - MCP with tsx
- `npm run mcp` - Run built MCP server
- `npm run test:run` - Full tests once
- `npm run lint` - ESLint
- `npm run typecheck` - TS checks
- `npm run validate` - typecheck + lint + format + tests

## Testing

- Unit/integration tests: `vitest`
- Typical focused run:

```bash
npx vitest run tests/services/search.service.test.ts
```

- Database regression flow:

```bash
npm run db:test:phase1
```

## Project Policy

Repository documentation is intentionally consolidated into only:

- `README.md` (project/system/operator reference)
- `AGENTS.md` (agent/contributor implementation reference)

## License

MIT
