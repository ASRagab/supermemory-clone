## [ERR-20260205-001] hooks pre-task requires --task-id

**Logged**: 2026-02-05 08:35
**Priority**: medium
**Status**: pending
**Area**: cli/hooks

### Context

Ran `npx @claude-flow/cli@latest hooks pre-task --description "..."` and it failed with: `Required option missing: --task-id`.

### Learning

`hooks pre-task` now requires an explicit `--task-id`.

### Resolution

Include a `--task-id` parameter when invoking `hooks pre-task`, or use a different hook (e.g., `hooks route`) when no task id is available.
