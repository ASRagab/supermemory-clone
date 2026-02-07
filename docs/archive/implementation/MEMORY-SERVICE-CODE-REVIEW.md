# Memory Service Code Review (Local Deployment)
Date: 2026-02-04
Scope: Memory service and relationship detection vs local agent use cases in `docs/MEMORY-SERVICE-USE-CASES.md`.

**Executive Summary**
- The core local use cases are mostly supported (container tags, persistence, basic extraction), but the codebase carries multiple parallel relationship and LLM pipelines that add complexity without clear local value.
- LLM "helper" services (classifier, contradiction, extension) are wired through `extractMemories` with the wrong system prompt, which is fragile and likely contributes to the 27 failing LLM integration tests.
- Container-tag isolation is not consistently enforced in `updateIsLatest`, risking cross-project superseding that conflicts with the local `containerTag` model.
- Several optional features (embedding-based relationships, LLM verification, semantic search scaffolding) should be explicitly feature-flagged or kept out of default local paths to reduce complexity and failure surface.

**Simplification Recommendations (Prioritized)**
1. Default to a single local mode and disable LLM/embedding paths unless explicitly enabled.
   Impact: High (reduces complexity and flakiness; aligns with local/offline use).
   Risk: Low (keeps existing behavior behind flags).
   Files: `src/services/memory.service.ts`, `src/services/relationships/memory-integration.ts`, `src/services/llm/index.ts`.

2. Refactor or remove LLM "helper" services that repurpose `extractMemories` with incompatible prompts.
   Impact: High (likely resolves failing LLM integration tests and improves determinism).
   Risk: Medium (touches LLM integration; keep behind flags to avoid test breaks).
   Files: `src/services/llm/memory-classifier.service.ts`, `src/services/llm/contradiction-detector.service.ts`, `src/services/llm/memory-extension-detector.service.ts`.

3. Consolidate relationship detection paths into one default implementation.
   Impact: Medium (smaller surface area, easier to maintain).
   Risk: Low (keep alternate path behind config).
   Files: `src/services/memory.service.ts`, `src/services/relationships/detector.ts`, `src/services/relationships/memory-integration.ts`.

4. Deduplicate classification patterns and heuristics.
   Impact: Medium (less drift and fewer inconsistencies).
   Risk: Low (pure refactor).
   Files: `src/services/memory.service.ts`, `src/services/llm/memory-classifier.service.ts`, `src/services/llm/mock.ts`.

5. Treat `semanticSearch` as a simple text search and document it as such, or wire it to embeddings when enabled.
   Impact: Low to Medium (clarifies behavior and reduces surprises).
   Risk: Low.
   Files: `src/services/memory.repository.ts`.

**Missing Code Path Handling (Severity)**
- High: `updateIsLatest` ignores `containerTag` and can supersede across projects. This violates container isolation in local use cases.
  Files: `src/services/memory.service.ts`.

- Medium: LLM extension/contradiction/classification services use `provider.extractMemories` with a fixed memory-extraction system prompt, but send JSON-only prompts for other tasks. Output parsing is unreliable and likely fails when models follow the system prompt.
  Files: `src/services/llm/memory-classifier.service.ts`, `src/services/llm/contradiction-detector.service.ts`, `src/services/llm/memory-extension-detector.service.ts`.

- Medium: `processAndStoreMemories` performs multiple writes without transactional safeguards; partial failures can leave memories stored without relationships or supersede updates. For local-only, consider best-effort cleanup or explicit "partial result" signaling.
  Files: `src/services/memory.service.ts`.

- Low: `containerTag` validation skips empty string because checks are `if (containerTag)`, allowing invalid empty tags.
  Files: `src/services/memory.service.ts`, `src/services/memory.repository.ts`.

- Low: `semanticSearch` ignores `similarityThreshold` and doesn't use embeddings; this is fine if documented, but misleading as "semantic."
  Files: `src/services/memory.repository.ts`.

**Alignment Assessment (Use Cases vs Implementation)**
- Cross-Session Project Continuity: Largely supported via `containerTag`, storage, and retrieval. Missing explicit helpers for "session recap" or "profile summary," but can be layered externally.
  Files: `src/services/memory.service.ts`, `src/services/memory.repository.ts`.

- Personal Preference and Workflow Memory: Supported via extraction/classification and storage. LLM classification adds complexity without clear local benefit; regex paths are adequate for local use.
  Files: `src/services/memory.service.ts`, `src/services/llm/memory-classifier.service.ts`.

- Local Knowledge Base for Active Workstreams: Partially supported. `semanticSearch` is a text match, and embedding search exists but is not in the default repository path. Recommend choosing one path.
  Files: `src/services/memory.repository.ts`, `src/services/relationships/memory-integration.ts`.

- Decision Tracking and Change History: Relationship detection and superseding are implemented, but container isolation gaps in `updateIsLatest` and heuristic thresholds make updates inconsistent.
  Files: `src/services/memory.service.ts`.

- Local Agent Handoff and Orchestration: Storage and retrieval APIs are sufficient. The enhanced embedding/relationship stack is likely unnecessary for local orchestration without explicit need.
  Files: `src/services/memory.service.ts`, `src/services/relationships/memory-integration.ts`.

**Estimated Impact by Recommendation**
1. Local-only mode with LLM/embedding off by default: High impact, Low risk.
2. Fix or remove LLM helper services misuse: High impact, Medium risk.
3. Single relationship detection path by default: Medium impact, Low risk.
4. Deduplicate heuristics: Medium impact, Low risk.
5. Clarify `semanticSearch` vs embedding behavior: Low to Medium impact, Low risk.
