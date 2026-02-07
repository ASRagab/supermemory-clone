# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains runtime code: `api/` (routes + middleware), `services/` (business logic), `workers/` (BullMQ pipeline), `db/` (client + schemas), `mcp/` (MCP server), and `utils/`.
- `tests/` mirrors runtime domains (`tests/api`, `tests/services`, `tests/workers`, `tests/database`, etc.) with Vitest suites.
- `scripts/` holds operational scripts; SQL migrations live in `scripts/migrations/`.
- `docs/` stores architecture, setup, and deployment references. `dist/` is generated build output.

## Build, Test, and Development Commands
- `npm run dev`: run API in watch mode via `tsx`.
- `npm run build`: compile TypeScript to `dist/`.
- `npm run start`: run compiled server (`dist/index.js`).
- `npm run mcp:dev`: run MCP server entrypoint in dev.
- `npm run test:run`: run all tests once.
- `npm run test:coverage`: run tests with coverage report.
- `npm run lint`, `npm run format:check`, `npm run typecheck`: static quality gates.
- `npm run validate`: full local gate (`typecheck + lint + format check + tests`).
- `npm run db:migrate`, `npm run db:test:phase1`: database migration and SQL regression flow.

## Coding Style & Naming Conventions
- TypeScript with strict compiler settings (`tsconfig.json`), ES modules (`NodeNext`).
- Prettier rules: 2 spaces, single quotes, semicolons, trailing commas (`es5`), 100-char line width.
- ESLint enforces TypeScript best practices (`prefer-const`, no `var`, limited `console`).
- Follow existing file naming: `*.service.ts`, `*.repository.ts`, `*.worker.ts`, route modules under `src/api/routes/*.ts`.

## Testing Guidelines
- Framework: Vitest (`tests/**/*.test.ts`, setup in `tests/setup.ts`).
- Coverage thresholds: statements 80%, branches 75%, functions 80%, lines 80%.
- Keep tests domain-aligned under `tests/`; name files `<module>.test.ts`.
- Run focused tests when iterating, e.g. `npx vitest run tests/services/search.service.test.ts`.

## Commit & Pull Request Guidelines
- Match observed commit style: imperative summaries (`Fix ...`) or scoped task IDs (`TASK-00X: ...`).
- Keep commits focused and atomic; avoid mixing unrelated domains.
- PRs should include: concise description, linked issue/task, affected paths, and validation commands run (typically `npm run validate` or scoped equivalents).
- For API behavior changes, include request/response examples or equivalent evidence.

## Security & Configuration Tips
- Copy `.env.example` to `.env`; never commit secrets or API keys.
- Enable secret scanning locally:
  `cp scripts/pre-commit-secrets .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`
- Runtime dependencies: PostgreSQL (with pgvector) and Redis; SQLite is for tests (`NODE_ENV=test`).
