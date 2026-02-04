# Memory Service Implementation Tasks
Date: 2026-02-04
Source: `docs/MEMORY-SERVICE-CODE-REVIEW.md`

**Summary**
Total tasks: 9
Estimated effort: 9 to 18 hours (tasks are 30 to 60 minutes each, excluding review time)

**Implementation Phases**
1. Phase 1: Data safety and container isolation
Testing: Focus on service-level unit tests for container boundaries and partial-failure behavior.
2. Phase 2: Default local mode and search behavior
Testing: Configuration tests for feature flags and repository search behavior.
3. Phase 3: LLM helper correctness and heuristic consistency
Testing: LLM helper unit tests with mocked providers and shared heuristic fixtures.
4. Phase 4: Relationship detection consolidation
Testing: Detector selection tests and behavior parity tests for default path.

**Task List (Topologically Sorted)**
- [x] TASK-001: Default Local Mode With Feature Flags (Impact: High, Risk: Low, Size: M) ✅
Files: `src/services/memory.service.ts`, `src/services/relationships/memory-integration.ts`, `src/services/llm/index.ts`, `src/config/feature-flags.ts` (or existing config module)
Tests: `tests/services/memory.service.test.ts`, `tests/services/relationships/memory-integration.test.ts`, `tests/services/llm/index.test.ts`
Criteria: When no explicit flags are enabled, LLM and embedding paths are skipped; enabling flags restores current behavior; defaults match local/offline use.
Test cases to add: Default config uses non-LLM extraction path; default config uses non-embedding relationship path; explicit flag enables LLM helper pipeline; explicit flag enables embedding-based relationships.
Depends on: None

- [x] TASK-002: Enforce `containerTag` in `updateIsLatest` (Impact: High, Risk: Low, Size: S) ✅
Files: `src/services/memory.service.ts`
Tests: `tests/services/memory.service.test.ts`
Criteria: Superseding is restricted to the same `containerTag`; cross-container memories are never marked non-latest.
Test cases to add: Supersede within same `containerTag` updates prior record; different `containerTag` does not update prior record; missing `containerTag` behavior remains consistent with existing defaults.
Depends on: None

- [x] TASK-003: Validate Empty `containerTag` Values (Impact: Medium, Risk: Low, Size: S) ✅
Files: `src/services/memory.service.ts`, `src/services/memory.repository.ts`
Tests: `tests/services/memory.service.test.ts`, `tests/services/memory.repository.test.ts`
Criteria: Empty-string `containerTag` is rejected or normalized consistently at service and repository boundaries.
Test cases to add: Empty string `containerTag` triggers validation error; whitespace-only `containerTag` triggers validation error; valid non-empty tag passes.
Depends on: None

- [ ] TASK-004: Add Partial-Failure Safeguards in `processAndStoreMemories` (Impact: Medium, Risk: Medium, Size: M)
Files: `src/services/memory.service.ts`
Tests: `tests/services/memory.service.test.ts`
Criteria: If relationship storage or supersede updates fail, the service either rolls back or returns explicit partial-failure metadata; no silent partial state.
Test cases to add: Relationship write failure returns partial result or rollback; supersede update failure returns partial result or rollback; all-success path unchanged.
Depends on: None

- [ ] TASK-005: Fix LLM Helper Services to Use Task-Appropriate Prompts (Impact: High, Risk: Medium, Size: M)
Files: `src/services/llm/memory-classifier.service.ts`, `src/services/llm/contradiction-detector.service.ts`, `src/services/llm/memory-extension-detector.service.ts`, `src/services/llm/index.ts`
Tests: `tests/services/llm/memory-classifier.service.test.ts`, `tests/services/llm/contradiction-detector.service.test.ts`, `tests/services/llm/memory-extension-detector.service.test.ts`
Criteria: Helper services no longer call `extractMemories` with a mismatched system prompt; outputs are parsed deterministically; failures return predictable errors.
Test cases to add: Each helper uses dedicated prompt template; JSON-only outputs parse successfully; incorrect model output yields structured error; feature flag off bypasses helper execution.
Depends on: TASK-001

- [ ] TASK-006: Deduplicate Classification Heuristics (Impact: Medium, Risk: Low, Size: S)
Files: `src/services/llm/memory-classifier.service.ts`, `src/services/llm/mock.ts`, `src/services/memory.service.ts`, `src/services/llm/heuristics.ts` (new)
Tests: `tests/services/llm/heuristics.test.ts`, `tests/services/memory.service.test.ts`
Criteria: Heuristic patterns exist in a single module and are used consistently by live and mock paths.
Test cases to add: Shared heuristics module returns same classification for a set of fixtures; memory service and mock classifier both use shared results.
Depends on: TASK-005

- [ ] TASK-007: Consolidate Relationship Detection Default Path (Impact: Medium, Risk: Low, Size: M)
Files: `src/services/memory.service.ts`, `src/services/relationships/detector.ts`, `src/services/relationships/memory-integration.ts`, `src/config/feature-flags.ts` (or existing config module)
Tests: `tests/services/relationships/detector.test.ts`, `tests/services/memory.service.test.ts`
Criteria: Only one relationship detection path is used by default; alternate path is gated behind a flag with parity tests.
Test cases to add: Default config uses primary detector; explicit flag routes to alternate detector; outputs match expected relationships for a shared fixture.
Depends on: TASK-001

- [ ] TASK-008: Clarify `semanticSearch` Behavior and Wire to Embeddings When Enabled (Impact: Medium, Risk: Low, Size: S)
Files: `src/services/memory.repository.ts`
Tests: `tests/services/memory.repository.test.ts`
Criteria: When embeddings are disabled, `semanticSearch` performs text search and documents that `similarityThreshold` is ignored; when embeddings are enabled, threshold is enforced.
Test cases to add: With embeddings disabled, text search is used and threshold is ignored; with embeddings enabled, threshold filters results; both paths return stable ordering.
Depends on: TASK-001

- [ ] TASK-009: Align Container Isolation in Relationship Superseding Paths (Impact: Medium, Risk: Low, Size: S)
Files: `src/services/memory.service.ts`, `src/services/relationships/memory-integration.ts`
Tests: `tests/services/relationships/memory-integration.test.ts`
Criteria: Relationship-driven superseding respects `containerTag` boundaries throughout integration flow.
Test cases to add: Relationship updates do not supersede across containers; container-scoped relationships update only within container.
Depends on: TASK-002

**Testing Strategy By Phase**
Phase 1: Add unit tests around container boundaries and partial-failure handling; use mocks to simulate write failures.
Phase 2: Add configuration and repository tests to validate default paths and embedding gating.
Phase 3: Add LLM helper tests with mocked provider responses and shared heuristic fixtures.
Phase 4: Add detector selection and parity tests to ensure the default relationship path matches expected output.
