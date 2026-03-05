# AGENTS.md

Comprehensive contributor and coding-agent guide for this repository.

## Scope and Intent

This repository keeps exactly two documentation sources:

- `README.md` for product/runtime usage
- `AGENTS.md` for implementation and contribution rules

Do not add new Markdown documentation files unless explicitly requested.

## System Overview

Supermemory Clone is a PostgreSQL + pgvector memory system with:

- REST API (`src/index.ts`, `/api/v1/*`)
- MCP server (`src/mcp/index.ts`, `supermemory_*` tools)
- Optional async queue pipeline (BullMQ workers)
- Inline ingestion fallback when Redis/queue path is unavailable

Core modules:

- `src/api/routes/*` for endpoint behavior
- `src/services/*` for extraction, search, memory, profile logic
- `src/db/*` for database access and schema
- `src/queues/*` and `src/workers/*` for background processing

## Runtime and Prerequisites

- Node.js >= 20
- PostgreSQL (required outside tests)
- pgvector extension
- Redis optional (recommended for worker pipeline)

## Configuration Rules

Key env vars:

- Required: `DATABASE_URL` (`postgres://` or `postgresql://` URL)
- Optional auth: `AUTH_ENABLED`, `AUTH_TOKEN`
- Optional async queue: `REDIS_URL`
- Optional LLM/embedding: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_PROVIDER`

Important behavior:

- `AUTH_ENABLED=false` is default; API remains accessible without bearer token.
- When auth is enabled, middleware checks exact `Authorization: Bearer <AUTH_TOKEN>`.
- CSRF middleware is active for API write operations.

## Development Workflow

1. Install and configure:

```bash
npm install
npm run setup
```

2. Start dependencies:

```bash
docker compose up -d postgres redis
```

3. Migrate and verify:

```bash
./scripts/migrations/run_migrations.sh
npm run doctor
```

4. Run services:

```bash
npm run dev
npm run mcp:dev
```

## Quality Gates

Always run relevant checks before finalizing:

- `npm run lint`
- `npm run typecheck`
- `npm run test:run` (or targeted vitest files while iterating)

For DB-level checks:

- `npm run db:test:phase1`

## Coding Standards

- TypeScript, strict mode, ESM.
- Keep changes minimal and scoped.
- Preserve existing naming conventions (`*.service.ts`, `*.repository.ts`, `*.worker.ts`).
- Prefer explicit error handling and typed interfaces over ad-hoc `any`.
- Keep API and MCP behavior backward compatible unless change is intentional and tested.

## Data and Safety Rules

- Never commit secrets.
- Keep database writes parameterized via existing Drizzle patterns.
- Preserve multi-tenant boundaries via `containerTag`.
- Do not bypass auth/CSRF/rate-limit middleware semantics in API routes.

## Agent-Specific Execution Guidance

When implementing with coding agents:

1. Read affected route/service/schema files first.
2. Implement smallest viable diff.
3. Add or update tests for behavior changes.
4. Re-run lint/typecheck/tests.
5. Summarize changed files and validation commands in final handoff.

If Redis is unavailable in local environments, treat inline ingestion fallback as expected behavior rather than failure.

## MCP Guidance

MCP server is available via:

- `npm run mcp:dev` (tsx)
- `npm run mcp` (built JS)

Tool contracts are defined in `src/mcp/tools.ts`; when changing tool input/output, update handler logic and tests in `tests/mcp/*`.

## Commit and PR Expectations

- Keep commits focused and descriptive.
- Validate locally before commit.
- Include behavioral impact and verification commands in PR description.
- Avoid mixing unrelated refactors with functional changes.

## Definition of Done

A change is done when:

- Behavior is implemented and tested.
- `lint`, `typecheck`, and relevant tests pass.
- Runtime configuration expectations are unchanged or clearly updated in `README.md` and this file.
- No extra documentation files were introduced.

## Learnings

- **Gotcha**: MCP document cleanup depends on memory-document linkage. If inline ingestion writes `Memory.sourceId` but `src/services/memory.repository.ts` does not persist it into `memories.document_id`, `supermemory_delete` cannot reliably remove derived memories, vectors, or sourced profile facts. Preserve that mapping whenever the inline memory write path changes.
