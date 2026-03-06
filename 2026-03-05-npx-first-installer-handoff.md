# Handoff: Npx-First Installer

**Generated**: 2026-03-05
**Status**: Implemented
**Primary audience**: maintainers implementing a zero-knowledge installer experience

## Executive Summary

The current install surface is optimized for contributors, not first-time users. A zero-knowledge user should not need to understand:

- `curl | bash`
- temporary bootstrap directories
- repo cloning
- `npm run mcp`
- repo-local repair commands after install

The new default should be:

```bash
npx -y @twelvehart/supermemory@latest full --dir ./supermemory --mcp project
```

That command should:

1. Download the runtime payload into the final install directory without creating a git checkout.
2. Run the existing in-repo installer from that final directory.
3. Register Claude MCP against the final path.
4. Print only next steps a brand-new user can actually take.

The in-repo installer remains canonical. `npx` becomes the default transport and user-facing entrypoint.

## Decisions Locked In

These decisions remove ambiguity before implementation:

1. `npx` is the default documented install path. `curl` and manual clone become secondary fallback paths.
2. The repository remains a single GitHub repo.
3. Packaging is split by npm package, not by repository.
4. The runtime payload should be installed from a published npm tarball by default, not via visible `git clone`.
5. The existing `scripts/install.sh` remains the canonical install engine.
6. Project-scope MCP registration must always target the final install directory, never a temporary path.
7. `full --mcp project` success output must assume the user opens Claude from the installed directory. It must not instruct them to run `npm run mcp`.
8. Non-applicable help text must not be printed. Example: do not print `If you skipped Docker` unless `--skip-docker` was actually used.
9. Backward compatibility is not a design constraint for this effort.

## Current State

The current flow is split across:

- [README.md](/Users/ahmad.ragab/Dev/supermemory-clone/README.md)
- [scripts/bootstrap.sh](/Users/ahmad.ragab/Dev/supermemory-clone/scripts/bootstrap.sh)
- [scripts/install.sh](/Users/ahmad.ragab/Dev/supermemory-clone/scripts/install.sh)

Observed issues from the current UX:

- `curl` exposes bootstrap mechanics instead of a stable product command.
- bootstrap historically registered MCP against a temp path, which made the success message misleading.
- `full` prints contributor-oriented next steps instead of zero-knowledge next steps.
- output branches are too broad and include instructions irrelevant to the flags actually used.
- repo checkout is visible even though most users only want a working local install.

## Target User Experience

### Primary Path

```bash
npx -y @twelvehart/supermemory@latest full --dir ./supermemory --mcp project
cd ./supermemory
claude
```

### Minimal Success Output

For `full --mcp project`:

```text
Install complete.

Next:
  1. cd ./supermemory
  2. Open Claude in this directory
  3. Ask Claude to use supermemory_add

API health:
  curl http://localhost:13000/health
```

For `agent --mcp project`:

```text
Install complete.

Next:
  1. cd ./supermemory
  2. Open Claude in this directory
```

### Explicit Non-Goals

- No requirement to preserve old `curl` messaging.
- No requirement to preserve current package names.
- No requirement to preserve the current README structure.

## Proposed Architecture

## Package Layout

Keep one repo and add one installer workspace:

```text
/
  package.json                 # runtime package metadata
  scripts/install.sh           # canonical installer engine
  scripts/bootstrap.sh         # fallback transport only
  packages/
    install/
      package.json             # published as @twelvehart/supermemory
      src/cli.ts
      src/runtime-source.ts
      src/unpack.ts
      src/run-install.ts
      src/output.ts
      src/types.ts
```

## Published Packages

### Runtime package

- Proposed name: `@twelvehart/supermemory-runtime`
- Source location: repo root package
- Purpose: publish the installable runtime tarball
- Must include:
  - `scripts/install.sh`
  - `scripts/mcp-setup.ts`
  - `scripts/doctor.ts`
  - `docker-compose*.yml`
  - `src`
  - `drizzle`
  - config files needed for build/test/install

### Installer package

- Proposed name: `@twelvehart/supermemory`
- Source location: `packages/install`
- Purpose: zero-knowledge entrypoint via `npx`
- Responsibility:
  - parse UX-friendly flags
  - fetch the runtime tarball for a specific version
  - unpack into the final directory
  - invoke `scripts/install.sh`
  - post-process output into user-appropriate next steps

## Why npm Tarball Instead of Git Clone

Primary reasons:

- avoids `.git` checkout for product users
- removes bootstrap temp-dir/path problems
- makes `npx` and the installed payload come from the same registry/auth story
- works cleanly from the same repo while still shipping separate packages

Fallback, not primary:

- authenticated GitHub tarball download for local maintainers or emergency recovery

## CLI Contract

Recommended command surface:

```bash
npx -y @twelvehart/supermemory@latest <mode> [options]
```

Modes:

- `agent`
- `api`
- `full`

Installer flags:

- `--dir <path>`
- `--env-file <path>`
- `--skip-api-keys`
- `--mcp <scope>` where scope is `project`, `user`, or `local`
- `--skip-docker`
- `--skip-api-start`
- `--runtime-version <semver|tag>`
- `--source-path <local-path>` for maintainer/dev testing only

Behavioral mapping:

- `--mcp project` maps to `--register-mcp --scope project`
- `--mcp user` maps to `--register-mcp --scope user`
- no `--mcp` means do not modify Claude config in non-interactive mode

## Install Flow

1. Resolve target directory.
2. Refuse to install into a non-empty directory unless `--update` or equivalent is explicitly chosen.
3. Resolve runtime source:
   - default: npm registry tarball for `@twelvehart/supermemory-runtime`
   - dev override: local path
4. Unpack runtime into the final install directory.
5. Run the canonical installer from the final install directory.
6. Read installer result and emit mode-aware, flag-aware success text.
7. Write an install manifest, for example `.supermemory-install.json`, containing:
   - installer version
   - runtime version
   - install mode
   - target dir
   - mcp scope
   - install timestamp

## Runtime Packaging Requirements

The runtime tarball must be explicitly curated. Relying on npm defaults is too risky.

Required work:

- add a strict `files` allowlist in root `package.json`
- ensure `npm pack` contains the full install payload
- exclude:
  - `.git`
  - test artifacts
  - local smoke installs
  - coverage output
  - transient data files

Validation gate:

- a scripted `npm pack --json` inspection test must fail if required installer/runtime files are missing

## Installer Output Rules

The installer output must be rewritten around user state, not maintainer state.

Rules:

1. Always print `cd <install-dir>` first when the installed directory is not the current shell directory.
2. If `full` or `api` started the API successfully, print the health URL.
3. If project-scope MCP registration succeeded, tell the user to open Claude in that directory.
4. Do not tell a zero-knowledge user to run `npm run mcp` when Claude registration already succeeded.
5. Do not print skipped-branch guidance unless the corresponding skip flag was used.
6. If API keys were skipped, print one short sentence on degraded quality, not a long maintainer paragraph.

## Test Strategy

## Unit/Component

- installer CLI arg parsing
- runtime source resolution
- success output rendering
- install manifest generation
- runtime tarball content validation

## Integration

- `--source-path` installs into a temp directory and registers project-scope MCP against the final path
- `full --skip-api-keys --mcp project` brings up Docker and passes health checks
- `agent --mcp project` skips API start and still yields correct Claude-ready output
- `uninstall --purge` removes Docker resources and MCP registration from an `npx`-installed directory

## Clean-Room End-to-End

Required test matrix:

1. no existing install, no API keys, `full --mcp project`
2. no existing install, no API keys, `agent --mcp project`
3. existing install upgrade/update path
4. private-registry authenticated path
5. Claude CLI absent
6. Docker absent
7. npm auth missing

Success definition for the primary path:

1. user runs one `npx` command
2. installer completes without repo knowledge
3. user runs `cd <dir>`
4. user opens Claude
5. `supermemory_add` persists data successfully

## Release Plan

Release ordering matters.

1. publish runtime package
2. publish installer package targeting that runtime version
3. smoke test `npx -y @twelvehart/supermemory@latest ...`
4. switch README quick-start to `npx`
5. demote `curl` and manual clone to fallback sections

## Recommended Sprint Breakdown

## Sprint 1: Packaging Contract

**Goal**: make the runtime publishable as a complete install payload

Tasks:

- rename/package the runtime for publishable npm distribution
- add root `files` allowlist and pack validation
- document required runtime package contents
- add a release command for runtime tarball smoke validation

Demo:

- `npm pack` produces a tarball that can be unpacked and contains `scripts/install.sh`

## Sprint 2: Installer Package

**Goal**: ship `@twelvehart/supermemory` as a thin wrapper around the canonical installer

Tasks:

- create `packages/install`
- implement CLI parsing and source resolution
- fetch runtime tarball from registry
- unpack directly into final directory
- run `scripts/install.sh` with mapped flags
- emit install manifest

Demo:

- `npx -y @twelvehart/supermemory@latest agent --dir ./tmp-smoke --mcp project --source-path <local>` succeeds locally

## Sprint 3: Output and UX Hardening

**Goal**: ensure the output is correct for zero-knowledge users

Tasks:

- rewrite success messaging in `scripts/install.sh`
- ensure the installer wrapper prints concise next steps
- remove repo-maintainer-only instructions from the default happy path
- align `README.md` quick start to the new default

Demo:

- `full --mcp project` ends with `cd`, `claude`, and health-check guidance only

## Sprint 4: Clean-Room Validation

**Goal**: prove that a first-time user can install and use Supermemory without repo knowledge

Tasks:

- add clean-room integration tests
- add project-scope MCP final-path assertions
- add regression tests for prior bootstrap temp-path class bugs
- document the manual fallback path for non-npm environments

Demo:

- a documented clean-room script runs install, opens health endpoint, and validates `.mcp.json`

## Risks and Mitigations

- **Risk**: runtime tarball misses required installer files.
  - Mitigation: explicit pack allowlist plus tarball inspection tests.
- **Risk**: installer and runtime package versions drift.
  - Mitigation: publish runtime first and embed expected runtime version in installer release config.
- **Risk**: private npm auth is missing.
  - Mitigation: fail fast with a clear npm-auth error and a fallback repo install path.
- **Risk**: Claude CLI is unavailable.
  - Mitigation: degrade gracefully and print one repair command.
- **Risk**: `full` still prints contributor-oriented guidance.
  - Mitigation: snapshot-test success output by mode and flag combination.

## Rollback Plan

If the `npx` installer is not production-ready:

1. keep `scripts/install.sh` canonical
2. keep `bootstrap.sh` as documented fallback
3. do not switch README quick start yet
4. gate npm installer release on clean-room smoke tests

## Definition of Done

This effort is done when:

1. `npx -y @twelvehart/supermemory@latest full --dir ./supermemory --mcp project` is the default recommended command.
2. That command works without repo knowledge.
3. The installed directory is not a git checkout by default.
4. Project-scope MCP registration points to the final install path.
5. The final success output tells the user only what they should do next.
6. A clean-room user can open Claude and successfully persist a memory.

## Checklist Reference

Implementation tracking lives in:

- [2026-03-05-npx-first-installer-checklist.json](/Users/ahmad.ragab/Dev/supermemory-clone/2026-03-05-npx-first-installer-checklist.json)
