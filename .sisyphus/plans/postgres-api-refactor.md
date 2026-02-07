# Postgres-Primary + Single API Layer Refactor Plan

## TL;DR

> **Quick Summary**: Consolidate the REST API onto `src/index.ts`, move MCP and API persistence onto the Postgres-backed service layer, and restrict SQLite to dev/test scripts only while providing a one-time migration for `mcp-state.json`.
>
> **Deliverables**:
>
> - Single Hono server entrypoint (`src/index.ts`) with CSRF + health checks consolidated
> - Postgres-backed persistence for API routes and MCP tools (no in-memory stores in runtime)
> - One-time migration path from `mcp-state.json` to Postgres
> - Explicit dev/test-only SQLite boundary
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES (2 waves)
> **Critical Path**: Repository persistence → API routes + MCP wiring → migration + verification

---

## Context

### Original Request

Produce a formal refactor plan aligned with: **Postgres primary**, **single API layer**, **SQLite test-only (NODE_ENV=test)**. Must include phases, concrete steps, affected files/modules, dependency order, migration strategy, risk/mitigation, verification steps, success criteria, decision rationale, and explicit non-goals. No code changes now.

### Interview Summary (Decisions)

- Canonical API entrypoint: **keep `src/index.ts`**; fold CSRF/middleware from `src/api/index.ts` and remove duplicate server.
- MCP persistence: **reuse service layer** (single source of truth) with Postgres.
- MCP migration: **one-time migration** from `mcp-state.json` → Postgres.
- SQLite boundary: **tests only (NODE_ENV=test)**; runtime API/MCP use Postgres exclusively.
- SQLite data migration: **no migration** (test-only data disposable).
- Test strategy: **tests-after** using existing Vitest.

### Observed Issues (Verified)

- `src/mcp/index.ts` maintains in-memory state plus file persistence to `mcp-state.json`.
- Duplicate REST entrypoints: `src/index.ts` and `src/api/index.ts`.
- API routes use in-memory stores: `src/api/routes/*` → `src/api/stores/index.ts`.
- SQLite-only DB layer in `src/db/index.ts` plus auto-selecting DB client in `src/db/client.ts` (defaults to SQLite).

### Key Repository Findings (Verified)

- `src/db/postgres.ts` exists (Postgres connection + migrations).
- `src/services/memory.repository.ts` and `src/services/profile.repository.ts` are in-memory.
- `src/services/search.service.ts` uses in-memory vector store and memory graph by default.
- Postgres schema exists for documents/memories/profiles/containers under `src/db/schema/*`.

### Decision Rationale

- **Single API entrypoint** reduces duplication and drift (currently two Hono servers).
- **Service-layer reuse** ensures MCP and REST share consistent persistence behavior.
- **Postgres primary** aligns with repository’s existing schema and avoids split-brain state.
- **SQLite test-only (NODE_ENV=test)** preserves local testing flexibility while keeping runtime consistent.
- **Migration of mcp-state.json** avoids data loss during the persistence switch.

### Assumptions / Defaults Applied

- Local/dev execution context (no production rollout plan included).
- Health checks validate Postgres connectivity only.
- Embeddings from `mcp-state.json` are re-generated via existing embedding service for consistency.

---

## Work Objectives

### Core Objective

Unify persistence and API entrypoints so all runtime reads/writes go through Postgres-backed services, while keeping SQLite strictly for tests (NODE_ENV=test).

### Concrete Deliverables

- Consolidated Hono server in `src/index.ts` (includes CSRF + health check logic from `src/api/index.ts`).
- API routes no longer use in-memory stores; they use Postgres-backed services.
- MCP tools read/write through the same Postgres-backed services.
- One-time migration path for `mcp-state.json` to Postgres.
- Enforced test-only SQLite usage (NODE_ENV=test).

### Definition of Done

- All API and MCP flows persist and read from Postgres only (no in-memory persistence at runtime).
- `src/api/index.ts` is removed/retired as a server entrypoint (no duplicate server path remains).
- `mcp-state.json` migration path is implemented and verified.
- Tests (Vitest) and health checks pass with Postgres.

### Must Have

- No breaking API route contracts.
- No regressions to MCP tool behavior (add/search/profile/list/delete/remember/recall).
- Migration is incremental (minimize breaking changes and allow safe cutover).

### Must NOT Have (Non-Goals / Guardrails)

- No new features beyond persistence/entrypoint consolidation.
- No auth/authorization changes.
- No dependency upgrades or new storage systems.
- No API contract changes or new endpoints.
- No production rollout/monitoring changes beyond what’s necessary for refactor verification.

---

## Verification Strategy

### Test Decision

- **Infrastructure exists**: YES (Vitest)
- **User wants tests**: Tests-after

### Verification Approach

- Run existing Vitest suite after each phase.
- Use `/health` and existing API route tests to validate behavior.
- Ensure MCP operations work end-to-end against Postgres.

---

## Execution Strategy

### Parallel Execution Waves

**Wave 1 (Foundational persistence work)**

- Task 1: Postgres-backed repositories + vector store wiring

**Wave 2 (Entry point + route/MCP wiring)**

- Task 2: Consolidate API entrypoint (`src/index.ts`)
- Task 3: API routes → service layer
- Task 4: MCP persistence → service layer + migration
- Task 5: SQLite dev/test boundary enforcement

Critical Path: Task 1 → Task 3/4 → Task 5 → Verification

### Dependency Matrix

| Task | Depends On | Blocks       | Can Parallelize With |
| ---- | ---------- | ------------ | -------------------- |
| 1    | None       | 3,4          | 2                    |
| 2    | None       | 3            | 1                    |
| 3    | 1,2        | 5            | 4                    |
| 4    | 1          | 5            | 3                    |
| 5    | 3,4        | Verification | None                 |

---

## Migration Strategy (mcp-state.json → Postgres)

1. **Detect** `mcp-state.json` presence in MCP startup flow (`src/mcp/index.ts`).
2. **Parse** file into document + containerTag records.
3. **Map** document fields to Postgres `documents` table (`src/db/schema/documents.schema.ts`).
4. **Upsert** container tags to `container_tags` (`src/db/schema/containers.schema.ts`).
5. **Persist** imported documents through service layer (so Postgres is the source of truth).
6. **Mark** migration complete (e.g., write a migration flag in DB or rename the file) to avoid re-import.

### Data Migration Considerations

- Preserve `id`, `content`, `title`, `containerTag`, `metadata`, timestamps if available.
- If `embedding` exists in `mcp-state.json`, prefer regenerating embeddings through existing embedding service for consistency (avoid schema mismatch).
- If containerTag is missing, default to `default` as MCP currently does.

---

## Risks & Mitigations

| Risk                                      | Impact | Mitigation                                                                                      |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Data loss during MCP migration            | High   | One-time migration with validation; keep `mcp-state.json` until verified import.                |
| API regressions after consolidation       | High   | Keep route signatures identical; use existing tests and add minimal regression tests if needed. |
| Postgres unavailable at startup           | Medium | Fail-fast with clear error; health check surfaces DB connectivity.                              |
| Performance regressions (in-memory → DB)  | Medium | Use existing Postgres schema/indexes and pgvector; avoid new heavy queries.                     |
| SQLite still used in runtime accidentally | Medium | Enforce dev/test-only gate in config/db client.                                                 |

---

## TODOs

> Implementation + tests are combined per task. Each task includes references and verification criteria.

- [ ] 1. Postgres-backed persistence for services (Memory/Profile/Search)

  **What to do**:
  - Replace in-memory repositories in `src/services/memory.repository.ts` and `src/services/profile.repository.ts` with Postgres-backed implementations using existing Drizzle schema.
  - Update `src/services/search.service.ts` to use a Postgres-backed vector store (see `src/services/vectorstore/pgvector.ts`) and replace in-memory memory graph for runtime.
  - Ensure `src/db/client.ts` and `src/db/postgres.ts` are the data sources used by services.

  **Must NOT do**:
  - Do not change public service method signatures.
  - Do not introduce new storage providers beyond Postgres.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: multi-module persistence refactor with data-layer implications
  - **Skills**: `V3 Core Implementation`, `V3 DDD Architecture`
    - `V3 Core Implementation`: aligns service/repository patterns
    - `V3 DDD Architecture`: ensures clean data access boundaries
  - **Skills Evaluated but Omitted**:
    - `V3 Security Overhaul`: no auth changes in scope

  **Parallelization**:
  - Can Run In Parallel: YES (with Task 2)
  - Parallel Group: Wave 1
  - Blocks: Tasks 3, 4
  - Blocked By: None

  **References**:
  - `src/services/memory.repository.ts` — current in-memory repository to replace
  - `src/services/profile.repository.ts` — current in-memory profile persistence
  - `src/services/search.service.ts` — in-memory vector store and memory graph
  - `src/services/vectorstore/pgvector.ts` — Postgres vector store implementation
  - `src/db/schema/*` — Postgres schema (documents, memories, user_profiles, container_tags)
  - `src/db/postgres.ts` + `src/db/client.ts` — Postgres connection and DB selection

  **Acceptance Criteria**:
  - Service repositories persist and read data via Postgres (no in-memory store used in runtime paths).
  - Vitest suite passes for service-level tests.

- [ ] 2. Consolidate API entrypoint into `src/index.ts`

  **What to do**:
  - Move CSRF middleware and `/api/v1/csrf-token` endpoint logic from `src/api/index.ts` into `src/index.ts`.
  - Ensure `src/index.ts` remains the single server entrypoint; remove/retire duplicate server in `src/api/index.ts`.
  - Update health check to verify Postgres connectivity (not SQLite).

  **Must NOT do**:
  - Do not change route paths or response shapes.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: targeted entrypoint consolidation
  - **Skills**: `V3 CLI Modernization`
    - Ensures middleware/entrypoint behavior is preserved
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: not UI work

  **Parallelization**:
  - Can Run In Parallel: YES (with Task 1)
  - Parallel Group: Wave 1
  - Blocks: Task 3
  - Blocked By: None

  **References**:
  - `src/index.ts` — primary API entrypoint
  - `src/api/index.ts` — duplicate entrypoint containing CSRF setup
  - `src/api/middleware/csrf.ts` — CSRF middleware

  **Acceptance Criteria**:
  - Only one server entrypoint remains (`src/index.ts`).
  - `/api/v1/csrf-token` and CSRF middleware work as before.
  - `/health` reflects Postgres connectivity.

- [ ] 3. Route API endpoints through service layer (remove in-memory stores)

  **What to do**:
  - Refactor `src/api/routes/documents.ts`, `search.ts`, `profiles.ts` to call service-layer methods backed by Postgres.
  - Remove dependence on `src/api/stores/index.ts` in runtime path.
  - Keep API contracts intact (request/response shapes).

  **Must NOT do**:
  - Do not introduce new endpoints or change API semantics.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: multiple routes, cross-service integration
  - **Skills**: `V3 Core Implementation`
  - **Skills Evaluated but Omitted**:
    - `github-workflow-automation`: not CI scope

  **Parallelization**:
  - Can Run In Parallel: YES (with Task 4)
  - Parallel Group: Wave 2
  - Blocks: Task 5
  - Blocked By: Tasks 1, 2

  **References**:
  - `src/api/routes/documents.ts` — in-memory document CRUD
  - `src/api/routes/search.ts` — in-memory search
  - `src/api/routes/profiles.ts` — in-memory profiles
  - `src/api/stores/index.ts` — in-memory store to remove from runtime
  - `src/services/memory.service.ts` / `src/services/search.service.ts` / `src/services/profile.service.ts`

  **Acceptance Criteria**:
  - API CRUD/search/profile endpoints use Postgres-backed services.
  - No runtime dependency on `documentsStore`/`profilesStore`.
  - Vitest API tests pass.

- [ ] 4. MCP persistence → service layer + migration

  **What to do**:
  - Update `src/mcp/index.ts` to remove in-memory `documents` + file persistence and call Postgres-backed services.
  - Add one-time migration from `mcp-state.json` into Postgres using the service layer.
  - Ensure MCP tool handlers use shared services for add/search/profile/list/delete/remember/recall.

  **Must NOT do**:
  - Do not change MCP tool names or schemas.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: touches MCP server and persistence
  - **Skills**: `V3 MCP Optimization`
    - Ensures MCP behavior remains consistent while refactoring persistence
  - **Skills Evaluated but Omitted**:
    - `V3 Security Overhaul`: no auth changes

  **Parallelization**:
  - Can Run In Parallel: YES (with Task 3)
  - Parallel Group: Wave 2
  - Blocks: Task 5
  - Blocked By: Task 1

  **References**:
  - `src/mcp/index.ts` — in-memory + file persistence to replace
  - `src/services/memory.service.ts` / `src/services/search.service.ts` / `src/services/profile.service.ts`
  - `src/services/persistence/index.ts` — existing file persistence utilities
  - `src/db/schema/documents.schema.ts` / `containers.schema.ts`

  **Acceptance Criteria**:
  - MCP operations persist to Postgres and survive restart (no file-only persistence).
  - `mcp-state.json` migration imports documents/tags successfully when present.

- [ ] 5. Enforce SQLite test-only boundary

  **What to do**:
  - Adjust `src/config/index.ts` and `src/db/client.ts` to require Postgres for runtime API/MCP; allow SQLite only when `NODE_ENV=test`.
  - Ensure any health checks reference Postgres (not SQLite).
  - Remove/retire `src/db/index.ts` usage from runtime paths, keeping it available for tests if still needed.

  **Must NOT do**:
  - Do not remove SQLite entirely if tests still need it.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
  - **Skills**: `V3 Core Implementation`
  - **Skills Evaluated but Omitted**:
    - `V3 Security Overhaul`: not required

  **Parallelization**:
  - Can Run In Parallel: NO
  - Parallel Group: Sequential (after Tasks 3 and 4)
  - Blocks: Verification
  - Blocked By: Tasks 3, 4

  **References**:
  - `src/config/index.ts` — `databaseUrl` default currently SQLite
  - `src/db/client.ts` — selects SQLite vs Postgres based on URL
  - `src/db/index.ts` — SQLite-only DB implementation

  **Acceptance Criteria**:
  - Runtime API/MCP uses Postgres only; SQLite is only used when `NODE_ENV=test`.
  - `/health` reflects Postgres connectivity.

---

## Success Criteria

- All existing Vitest tests pass after refactor.
- API endpoints and MCP tools work with Postgres-backed persistence.
- No duplicate API server entrypoint remains.
- `mcp-state.json` migration successfully imports into Postgres when present.
- SQLite is restricted to tests only (NODE_ENV=test; no runtime usage).
