import { homedir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { renderSuccessOutput } from '../../packages/install/src/output.ts'
import type { InstallerRunSummary, ParsedCliArgs } from '../../packages/install/src/types.ts'

describe('installer output rendering', () => {
  it('renders the zero-knowledge full install output for project MCP installs', () => {
    const args: ParsedCliArgs = {
      cwd: '/tmp',
      mode: 'full',
      mcpScope: 'project',
      runtimeVersion: 'latest',
      skipApiKeys: false,
      skipApiStart: false,
      skipDocker: false,
      targetDir: '/tmp/supermemory',
      update: false,
    }

    const summary: InstallerRunSummary = {
      action: 'install',
      installMode: 'full',
      installDir: '/tmp/supermemory',
      apiHostPort: '13000',
      apiStarted: true,
      connectivityOk: true,
      mcp: {
        scope: 'project',
        status: 'registered',
      },
      flags: {
        apiKeysWereSkipped: false,
        skipApiKeys: false,
        skipApiStart: false,
        skipDocker: false,
      },
    }

    expect(renderSuccessOutput(args, summary)).toBe(`Install complete.

Next:
  1. cd ./supermemory
  2. Open Claude in this directory
  3. Ask Claude to use supermemory_add

API health:
  curl http://localhost:13000/health
`)
  })

  it('renders the default home install path as ~/.supermemory', () => {
    const defaultTargetDir = `${homedir()}/.supermemory`
    const args: ParsedCliArgs = {
      cwd: '/tmp/workspace',
      mode: 'agent',
      mcpScope: 'project',
      runtimeVersion: 'latest',
      skipApiKeys: false,
      skipApiStart: false,
      skipDocker: false,
      targetDir: defaultTargetDir,
      update: false,
    }

    const summary: InstallerRunSummary = {
      action: 'install',
      installMode: 'agent',
      installDir: defaultTargetDir,
      apiStarted: false,
      connectivityOk: true,
      mcp: {
        scope: 'project',
        status: 'registered',
      },
      flags: {
        apiKeysWereSkipped: false,
        skipApiKeys: false,
        skipApiStart: false,
        skipDocker: false,
      },
    }

    expect(renderSuccessOutput(args, summary)).toContain('1. cd ~/.supermemory')
  })
})
