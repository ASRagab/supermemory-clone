# Supermemory Clone

Local-first memory service for developers and coding agents.

It stores documents, extracts memories, indexes embeddings, and exposes both a REST API and `supermemory_*` MCP tools.

## Npx Install

Default user path:

```bash
npx -y @twelvehart/supermemory@latest full --mcp project
cd ~/.supermemory
claude
```

This installs the runtime into `~/.supermemory`, runs the canonical installer from that final directory, registers Claude MCP against the final path, and prints the minimal next steps.

Other supported `npx` examples:

```bash
npx -y @twelvehart/supermemory@latest agent --mcp project
npx -y @twelvehart/supermemory@latest api --dir ~/supermemory-api
npx -y @twelvehart/supermemory@latest full --skip-api-keys --mcp project
npx -y @twelvehart/supermemory@latest full --source-path "$(pwd)"
npx -y @twelvehart/supermemory@latest full --source-path "$(pwd)" --update
```

Modes:

- `agent`: installs the MCP-oriented runtime and leaves the API stopped.
- `api`: installs and starts the REST API stack.
- `full`: installs both surfaces and starts the API stack.

## Repo Installation

Repo installation is for maintainers, local development, and testing unpublished changes.

```bash
git clone https://github.com/ASRagab/supermemory-clone.git
cd supermemory-clone
npm install
./scripts/install.sh full --scope project
```

Canonical shell installer commands:

```bash
./scripts/install.sh
./scripts/install.sh agent
./scripts/install.sh api
./scripts/install.sh full
./scripts/install.sh update --mode api
./scripts/install.sh uninstall --purge
```

## Runtime Model

- PostgreSQL is required outside tests.
- pgvector is required for semantic search.
- Redis is optional; when unavailable, ingestion falls back inline.
- Embedding and vector dimensions are pinned to `1536`.
- `EMBEDDING_DIMENSIONS` and `VECTOR_DIMENSIONS` overrides are not supported.

## Configuration

The installed app keeps its env file at:

```bash
~/.supermemory/.env
```

Repo installs use the standard env resolution order:

1. CLI `--env-file`
2. `SUPERMEMORY_ENV_FILE`
3. `.env.local`
4. `.env`

Core variables:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `LLM_PROVIDER`
- `REDIS_URL`
- `AUTH_ENABLED`
- `AUTH_TOKEN`
- `CSRF_SECRET`
- `ALLOWED_ORIGINS`

After changing env values for a Docker-based install, recreate the API container:

```bash
cd ~/.supermemory
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile production up -d --force-recreate api
```

Then restart Claude if you are using the MCP surface.

## MCP Use

For the npx-installed path:

```bash
cd ~/.supermemory
claude
```

If you need to repair or register MCP manually:

```bash
cd ~/.supermemory
npm run mcp:setup -- --scope project --non-interactive --register-mcp
```

Direct Claude CLI registration:

```bash
cd ~/.supermemory
claude mcp add supermemory --scope project -- node "$(pwd)/dist/mcp/index.js"
```

Available MCP tools include:

- `supermemory_add`
- `supermemory_search`
- `supermemory_delete`
- `supermemory_remember`
- `supermemory_recall`

## REST API

Health check:

```bash
curl http://localhost:13000/health
```

Base path:

```text
/api/v1
```

Common endpoints:

- `POST /documents`
- `GET /documents`
- `GET /documents/:id`
- `DELETE /documents/:id`
- `POST /search`
- `GET /profiles`
- `PUT /profiles/:tag`
- `DELETE /profiles/:tag`

## Repo Development

Key commands:

- `npm run dev`
- `npm run build`
- `npm run mcp:dev`
- `npm run mcp`
- `npm run db:migrate`
- `npm run test:run`
- `npm run test:install`
- `npm run lint`
- `npm run typecheck`
- `npm run typecheck:install`
- `npm run pack:check:runtime`

Focused example:

```bash
npx vitest run tests/services/search.service.test.ts
```

## Publish

Publish order:

1. Publish `@twelvehart/supermemory-runtime` from the repo root.
2. Publish `@twelvehart/supermemory` from `packages/install`.

Recommended checks before publishing:

```bash
npm run build
npm run pack:check:runtime
npm run build:install
npm run typecheck:install
npm run test:install
```

Smoke test after publishing:

```bash
npx -y @twelvehart/supermemory@next full --mcp project --runtime-version next
cd ~/.supermemory
curl http://localhost:13000/health
claude
```

## License

MIT
