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

Bootstrap supports a safe rerun/update path for existing compatible clones:

```bash
bash scripts/bootstrap.sh --dir ./supermemory-clone -- --non-interactive --skip-mcp
bash scripts/bootstrap.sh --dir ./supermemory-clone --update-if-exists -- --non-interactive --skip-mcp
```

Local clone + install:

```bash
git clone https://github.com/ASRagab/supermemory-clone.git
cd supermemory-clone
./scripts/install.sh
```

The default installer path is agent-first. It builds the project, starts PostgreSQL, and leaves the API stopped unless you choose an API-oriented mode.

Prefer reviewing remote scripts before execution:

```bash
curl -fsSL https://raw.githubusercontent.com/ASRagab/supermemory-clone/main/scripts/bootstrap.sh | less
```

The installer supports explicit modes:

```bash
./scripts/install.sh                  # same as: install --mode agent
./scripts/install.sh agent            # agent-first MCP workflow
./scripts/install.sh api              # REST API workflow
./scripts/install.sh full             # both surfaces, explicit all-in path
./scripts/install.sh update --mode api
./scripts/install.sh agent --env-file /tmp/supermemory-agent.env
```

Mode behavior:

- `agent`: installs dependencies, creates `.env`, starts PostgreSQL, builds the project, and prepares MCP usage without auto-starting the API.
- `api`: installs dependencies, creates `.env`, starts PostgreSQL + Redis + API, builds the project, and verifies API health.
- `full`: explicit all-surfaces install path. In the current implementation it shares the same container startup set as `api` but prints both API and MCP next steps.

The install/update flow handles:

- prerequisite checks (Node/Docker/Compose)
- `npm install`
- `.env` creation from `.env.example`
- optional API key prompts (or you can skip and configure later)
- mode-aware Docker startup + migrations
- non-conflicting local host ports by default (`13000`, `15432`, `16379`)
- build + optional Claude Code MCP registration
- connectivity check (`npm run doctor`)

Installer lifecycle commands:

```bash
./scripts/install.sh install      # default if command is omitted; defaults to --mode agent
./scripts/install.sh update       # clean reinstall of app components; preserves postgres/redis data and attempts migrations
./scripts/install.sh uninstall    # removes generated artifacts and stops local services
./scripts/install.sh uninstall --purge
```

Optional flags:

```bash
./scripts/install.sh --skip-api-keys --skip-mcp
./scripts/install.sh update --skip-docker
./scripts/install.sh install --mode api --skip-api-start
./scripts/install.sh --register-mcp --scope project
./scripts/install.sh --non-interactive          # does not register MCP unless --scope or --register-mcp is also passed
./scripts/install.sh uninstall --purge          # also removes env files, Claude MCP registrations, and docker volumes
```

Manual path (if you skip parts of installer):

```bash
cp .env.example .env
npm run stack:up
./scripts/migrations/run_migrations.sh
npm run build
npm run doctor
```

After the default `./scripts/install.sh` agent install, the API is not running yet. To start the MCP server:

```bash
npm run mcp
```

If you want the REST API instead, use API mode:

```bash
./scripts/install.sh api
curl http://localhost:13000/health
```

If you already installed in `api` or `full` mode, the API is running in Docker and ready to use:

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

Env file precedence is:

1. CLI `--env-file` for supported scripts
2. `SUPERMEMORY_ENV_FILE`
3. `.env.local`
4. `.env`

The API and MCP runtime honor `SUPERMEMORY_ENV_FILE`, then fall back to `.env.local`, then `.env`.

Examples:

```bash
SUPERMEMORY_ENV_FILE=~/.config/supermemory/config.env npm run doctor -- --mode agent
npm run mcp:setup -- --env-file /tmp/supermemory-agent.env
./scripts/install.sh agent --env-file /tmp/supermemory-agent.env
```

Required:

- `DATABASE_URL` (must be `postgres://` or `postgresql://` outside tests)

Optional:

- `AUTH_ENABLED`, `AUTH_TOKEN` (minimal bearer token auth)
- `REDIS_URL` (queues; if unavailable, ingestion falls back inline)
- `OPENAI_API_KEY` (embeddings)
- `LLM_PROVIDER`, `ANTHROPIC_API_KEY` (LLM extraction)
- `CSRF_SECRET`, `ALLOWED_ORIGINS` (hardening)

No external API keys are required for basic local operation.
Fresh installs leave provider keys and `LLM_PROVIDER` blank until you set real credentials.

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

`./scripts/install.sh agent` is the MCP-first installer path. Interactive installs can register Claude MCP after prompting for a scope. Non-interactive installs do not touch Claude config unless you pass `--scope` or `--register-mcp`.
If you want to register or repair Claude MCP later, run:

```bash
npm run mcp:setup
npm run mcp:setup -- --scope project --non-interactive --register-mcp
```

### Installation Options

**Option A — Manual registration with the setup helper**

```bash
npm run mcp:setup
```

**Option B — Project-scope registration**

```bash
npm run build
npm run mcp:setup -- --scope project --non-interactive --register-mcp
```

**Option C — Direct Claude CLI registration**

```bash
npm run build
claude mcp add supermemory --scope user -- node "$(pwd)/dist/mcp/index.js"
```

**Option D — npx (after package is published)**

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
npm run doctor -- --mode agent
npm run doctor -- --mode api
claude mcp get supermemory
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
