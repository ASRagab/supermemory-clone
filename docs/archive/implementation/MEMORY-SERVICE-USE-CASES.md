# Memory Service Use Cases for Local Agent Deployment

## Executive Summary
This memory service gives locally running AI agents a durable, searchable memory layer so they can persist facts, preferences, and evolving project context across sessions on a single machine, enabling higher-quality continuity, fewer repeated prompts, and faster task resumption without relying on cloud or multi-tenant infrastructure.

## Primary Use Cases
1. **Cross-Session Project Continuity**: A local coding agent resumes work days later without reloading full context.
  Agent workflow: On session start, search by project `containerTag`, load a profile summary, and pull recent decisions; during work, store new decisions and summaries; at session end, write a session recap.
  Value: Eliminates repeated context setup and reduces drift in long-running projects.

2. **Personal Preference and Workflow Memory**: A single-user assistant adapts to recurring preferences (tools, style, routines).
  Agent workflow: Extract preferences from conversations (e.g., preferred stack, coding style, meeting times), store as stable memories, and retrieve them to guide responses and defaults.
  Value: Produces consistent, personalized output without re-asking the same questions.

3. **Local Knowledge Base for Active Workstreams**: An agent indexes local notes, docs, and snippets to answer "what did we decide?"
  Agent workflow: Ingest documents or notes into a project container, run semantic search for queries, and surface relevant snippets during planning or debugging.
  Value: Fast recall of local knowledge with minimal manual search.

4. **Decision Tracking and Change History**: A local agent keeps track of updates and contradictions over time.
  Agent workflow: Store decisions as memories, detect updates or contradictions, mark superseded items, and retrieve only the latest when asked.
  Value: Keeps agents aligned with the most current state without manual cleanup.

5. **Local Agent Handoff and Orchestration**: A planner agent hands off to a coding or debugging agent on the same machine.
  Agent workflow: The planner stores task breakdowns and constraints; the executor retrieves them, writes results and notes back; a reviewer agent reads the final memory set before reporting.
  Value: Enables coordinated multi-agent work without external services.

## Architecture Fit for Local Deployment
Key design decisions that support local use:
- Local-first API on `localhost` with API key auth fits a single-user environment.
- Container tags and profiles map cleanly to local projects or workspaces.
- LLM extraction with regex fallback allows operation even when offline or without keys.
- Typed memories (fact, preference, event, context) and confidence thresholds keep local data structured and reliable.
- Relationship tracking (updates, extends, contradicts) supports incremental knowledge in small, evolving projects.

Scalability considerations for laptop/desktop:
- Single-node databases (SQLite or local PostgreSQL + pgvector) keep operations fast and simple.
- Hybrid search keeps recall high without needing distributed infrastructure.
- Optional reranking and query rewriting can be enabled only when needed to save resources.

Integration patterns:
- REST API usage from local agents, CLIs, and editor tools.
- MCP server integration for agent frameworks that expect tool-based memory access.
- Per-project `containerTag` conventions to isolate memory across repositories.

## Recommendations for Optimization
Simplifications for local-only scenarios:
- Default to a single user and a single `containerTag` namespace policy (e.g., `project:<name>`).
- Disable multi-tenant rate limiting and reduce auth complexity to a single API key.
- Skip external OAuth connections unless needed for a local knowledge import.

Features that could be optional:
- Query rewriting, cross-encoder reranking, and relationship detection can be toggled off for speed.
- Knowledge graph relationships can be limited to `updates` and `extends` for simpler state tracking.

Performance optimizations:
- Use a lightweight vector store (SQLite-VSS) for small datasets; switch to pgvector if data grows.
- Cache recent searches and profile summaries in memory to speed session start.
- Batch embeddings and limit memory extraction depth for short, frequent notes.
