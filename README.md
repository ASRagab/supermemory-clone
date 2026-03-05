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
- Docker + Docker Compose
- PostgreSQL with pgvector
- Redis (optional but recommended for async workers)

## Quick Start (Turnkey)

`curl | bash` bootstrap:

```bash
curl -fsSL https://raw.githubusercontent.com/ASRagab/supermemory-clone/main/scripts/bootstrap.sh | bash
```

You can pass installer flags after `--`, for example:

```bash
curl -fsSL https://raw.githubusercontent.com/ASRagab/supermemory-clone/main/scripts/bootstrap.sh | bash -s -- -- --non-interactive --skip-api-keys
```

Local clone + install:

```bash
git clone https://github.com/ASRagab/supermemory-clone.git
cd supermemory-clone
./scripts/install.sh
```

Prefer reviewing remote scripts before execution:

```bash
curl -fsSL https://raw.githubusercontent.com/ASRagab/supermemory-clone/main/scripts/bootstrap.sh | less
```

The `install` command handles:

- prerequisite checks (Node/Docker/Compose)
- `npm install`
- `.env` creation from `.env.example`
- optional API key prompts (or you can skip and configure later)
- Docker startup (`postgres`, `redis`, `api`) + migrations
- API health verification on `http://localhost:13000/health`
- non-conflicting local host ports by default (`13000`, `15432`, `16379`)
- build + optional Claude Code MCP registration
- connectivity check (`npm run doctor`)

Installer lifecycle commands:

```bash
./scripts/install.sh install      # default if command is omitted
./scripts/install.sh update       # clean reinstall of app components; preserves postgres/redis data and attempts migrations
./scripts/install.sh uninstall    # removes install artifacts, docker resources, and Claude MCP registrations
```

Optional flags:

```bash
./scripts/install.sh --skip-api-keys --skip-claude
./scripts/install.sh update --skip-docker
./scripts/install.sh install --skip-api-start
./scripts/install.sh --scope project
./scripts/install.sh --non-interactive
```

Manual path (if you skip parts of installer):

```bash
cp .env.example .env
npm run stack:up
./scripts/migrations/run_migrations.sh
npm run build
npm run doctor
```

After `./scripts/install.sh`, the API is already running in Docker and ready to use:

```bash
curl http://localhost:13000/health
```

If you prefer local watch mode instead of Docker for API runtime:

```bash
docker compose stop api
npm run dev
curl http://localhost:13000/health
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

`./scripts/install.sh` already attempts Claude Code MCP registration at **user scope** (available across your local projects).
If you want to override the installer scope (for example, `--scope project`) or choose scope manually, run:

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
- `npm run stack:up` - Start API + Postgres + Redis containers
- `npm run stack:down` - Stop and remove stack containers
- `npm run stack:logs` - Tail API container logs
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
